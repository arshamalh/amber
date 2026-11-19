//! Tauri commands: the only way the UI reaches files, the index and the
//! Typst engine. Chest-scoped commands check paths against the open chest.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::index::{Backlink, ChestIndex, NoteSummary, OutLink, SearchHit};
use crate::vault::{self, ChestInfo, NoteFormat, TreeEntry, Vault};
use crate::{export, git, markdown, typst, uri, watcher, AppState};

type CmdResult<T> = Result<T, String>;

fn err(e: impl ToString) -> String {
    e.to_string()
}

/// Runs blocking work (file walks, index builds) off the main thread.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> CmdResult<T> + Send + 'static,
) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(err)?
}

// ---- app and vaults ---------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    git_available: bool,
    recent_vaults: Vec<String>,
    reopen_last_vault: bool,
    /// A vault to open on launch: the first CLI argument, else `$AMBER_VAULT`.
    startup_vault: Option<String>,
    tinymist_version: String,
}

#[tauri::command]
pub async fn app_info(state: State<'_, AppState>) -> CmdResult<AppInfo> {
    let startup_vault = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("AMBER_VAULT").ok())
        .filter(|p| Path::new(p).is_dir());
    let (recent_vaults, reopen_last_vault) = {
        let s = state.settings.lock().unwrap();
        (s.recent_vaults.clone(), s.reopen_last_vault)
    };
    Ok(AppInfo {
        git_available: git::available().await,
        recent_vaults,
        reopen_last_vault,
        startup_vault,
        tinymist_version: typst::PINNED_VERSION.trim().to_owned(),
    })
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle, title: Option<String>) -> CmdResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file();
    if let Some(t) = title {
        dialog = dialog.set_title(t);
    }
    dialog.pick_folder(move |p| {
        let _ = tx.send(p);
    });
    let picked = rx.await.map_err(err)?;
    Ok(picked
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultView {
    name: String,
    root: String,
    root_uri: String,
    /// False when the folder has no `amber.toml` yet.
    initialized: bool,
    chests: Vec<ChestInfo>,
    last_chest: Option<String>,
}

fn vault_view(state: &AppState, v: &Vault) -> CmdResult<VaultView> {
    let root = v.root().to_string_lossy().into_owned();
    Ok(VaultView {
        name: v.display_name(),
        root_uri: uri::file_uri(v.root()),
        initialized: v.is_initialized(),
        chests: v.chests().map_err(err)?,
        last_chest: state
            .settings
            .lock()
            .unwrap()
            .last_chest
            .get(&root)
            .cloned(),
        root,
    })
}

/// Event sent to the UI when files change on disk.
#[derive(Clone, Serialize)]
pub struct VaultChanged {
    paths: Vec<String>,
}

#[tauri::command]
pub async fn open_vault(app: AppHandle, path: String) -> CmdResult<VaultView> {
    let v = Vault::open(&path).map_err(err)?;
    let state = app.state::<AppState>();
    *state.index.lock().unwrap() = None;
    *state.chest.lock().unwrap() = None;
    let handle = app.clone();
    let w = watcher::watch(v.root(), move |paths| on_vault_changed(&handle, paths))
        .map_err(|e| format!("could not watch the vault: {e}"))?;
    *state.watcher.lock().unwrap() = Some(w);
    *state.vault.lock().unwrap() = Some(v.clone());
    let root = v.root().to_string_lossy().into_owned();
    state.with_settings(|s| s.touch_vault(&root));
    vault_view(&state, &v)
}

/// Keeps the index in step with external edits, then tells the UI.
fn on_vault_changed(app: &AppHandle, paths: Vec<String>) {
    let state = app.state::<AppState>();
    let (Ok(v), Ok(chest)) = (state.vault(), state.chest()) else {
        let _ = app.emit("vault-changed", VaultChanged { paths });
        return;
    };
    let mut rebuild = false;
    {
        let mut guard = state.index.lock().unwrap();
        if let Some(idx) = guard.as_mut().filter(|i| i.chest() == chest) {
            for p in paths.iter().filter(|p| vault::chest_of(p) == chest) {
                if NoteFormat::from_path(p).is_none() {
                    // A folder (or something else) moved: re-scan everything.
                    rebuild |= !v.absolute(p).is_ok_and(|a| a.is_file());
                    continue;
                }
                let result = match v.read_note(p) {
                    Ok(text) => idx.upsert(p, &text),
                    Err(_) => idx.remove(p),
                };
                if let Err(e) = result {
                    eprintln!("[amber] index update failed for {p}: {e}");
                }
            }
        }
    }
    if rebuild {
        match ChestIndex::build(&v, &chest) {
            Ok(idx) => *state.index.lock().unwrap() = Some(idx),
            Err(e) => eprintln!("[amber] index rebuild failed: {e}"),
        }
    }
    let _ = app.emit("vault-changed", VaultChanged { paths });
}

/// Turns the open folder into a vault (writes `amber.toml` and `_shared/`).
#[tauri::command]
pub async fn init_vault(state: State<'_, AppState>) -> CmdResult<VaultView> {
    let v = state.vault().map_err(err)?;
    v.init(&v.display_name()).map_err(err)?;
    vault_view(&state, &v)
}

#[tauri::command]
pub async fn create_vault(parent: String, name: String, git: bool) -> CmdResult<String> {
    let v = blocking(move || Vault::create(&parent, &name).map_err(err)).await?;
    if git {
        git::init(v.root()).await?;
    }
    Ok(v.root().to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn clone_vault(url: String, parent: String) -> CmdResult<String> {
    let url = url.trim().to_owned();
    let name = git::name_from_url(&url).ok_or("could not tell the folder name from the URL")?;
    let dest = PathBuf::from(parent).join(name);
    if dest.exists() {
        return Err(format!("{} already exists", dest.display()));
    }
    git::clone(&url, &dest).await?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn set_reopen_last_vault(enabled: bool, state: State<'_, AppState>) {
    state.with_settings(|s| s.reopen_last_vault = enabled);
}

#[tauri::command]
pub fn forget_vault(path: String, state: State<'_, AppState>) {
    state.with_settings(|s| s.forget_vault(&path));
}

// ---- chests -------------------------------------------------------------

#[tauri::command]
pub async fn list_chests(state: State<'_, AppState>) -> CmdResult<Vec<ChestInfo>> {
    state.vault().and_then(|v| v.chests()).map_err(err)
}

#[tauri::command]
pub async fn create_chest(
    name: String,
    format: NoteFormat,
    state: State<'_, AppState>,
) -> CmdResult<ChestInfo> {
    state
        .vault()
        .and_then(|v| v.create_chest(name.trim(), format))
        .map_err(err)
}

#[tauri::command]
pub async fn make_chest(folder: String, state: State<'_, AppState>) -> CmdResult<ChestInfo> {
    state
        .vault()
        .and_then(|v| v.make_chest(&folder))
        .map_err(err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChestUpdate {
    name: String,
    default_format: NoteFormat,
    template: Option<String>,
}

#[tauri::command]
pub async fn update_chest(
    folder: String,
    update: ChestUpdate,
    state: State<'_, AppState>,
) -> CmdResult<ChestInfo> {
    let v = state.vault().map_err(err)?;
    let format = match update.default_format {
        NoteFormat::Typst => "typst",
        NoteFormat::Markdown => "markdown",
    };
    let template = update.template.as_deref().filter(|t| !t.is_empty());
    v.edit_chest(
        &folder,
        &[
            ("name", Some(update.name.trim())),
            ("default_format", Some(format)),
            ("template", template),
        ],
    )
    .map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChestView {
    info: ChestInfo,
    tree: Vec<TreeEntry>,
    notes: Vec<NoteSummary>,
}

/// Opens a chest: builds its index and scopes everything else to it.
#[tauri::command]
pub async fn open_chest(folder: String, state: State<'_, AppState>) -> CmdResult<ChestView> {
    let v = state.vault().map_err(err)?;
    let info = v.chest_info(&folder).map_err(err)?;
    if !info.is_chest {
        return Err(format!("{folder} is not a chest yet"));
    }
    let (v2, f2) = (v.clone(), folder.clone());
    let idx = blocking(move || ChestIndex::build(&v2, &f2).map_err(err)).await?;
    let notes = idx.notes();
    *state.index.lock().unwrap() = Some(idx);
    *state.chest.lock().unwrap() = Some(folder.clone());
    let root = v.root().to_string_lossy().into_owned();
    state.with_settings(|s| {
        s.last_chest.insert(root, folder.clone());
    });
    Ok(ChestView {
        tree: v.tree(&folder).map_err(err)?,
        info,
        notes,
    })
}

#[tauri::command]
pub async fn tree(state: State<'_, AppState>) -> CmdResult<Vec<TreeEntry>> {
    let (v, chest) = (state.vault().map_err(err)?, state.chest().map_err(err)?);
    blocking(move || v.tree(&chest).map_err(err)).await
}

fn with_index<T>(state: &AppState, f: impl FnOnce(&mut ChestIndex) -> T) -> CmdResult<T> {
    let mut guard = state.index.lock().unwrap();
    guard
        .as_mut()
        .map(f)
        .ok_or_else(|| "no chest is open".into())
}

#[tauri::command]
pub async fn note_list(state: State<'_, AppState>) -> CmdResult<Vec<NoteSummary>> {
    with_index(&state, |i| i.notes())
}

// ---- notes and files ------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedNote {
    path: String,
    format: NoteFormat,
    text: String,
    /// LSP document URI.
    uri: String,
    /// Absolute path, only for handing to the Typst engine (preview).
    engine_path: String,
}

#[tauri::command]
pub async fn open_note(path: String, state: State<'_, AppState>) -> CmdResult<OpenedNote> {
    let v = state.scoped(&path).map_err(err)?;
    let text = v.read_note(&path).map_err(err)?;
    let abs = v.absolute(&path).map_err(err)?;
    Ok(OpenedNote {
        format: NoteFormat::from_path(&path).ok_or("not a note")?,
        uri: uri::file_uri(&abs),
        engine_path: abs.to_string_lossy().into_owned(),
        text,
        path,
    })
}

#[tauri::command]
pub async fn write_note(
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let v = state.scoped(&path).map_err(err)?;
    v.write_note(&path, &content).map_err(err)?;
    with_index(&state, |i| i.upsert(&path, &content))?.map_err(err)
}

/// Creates a note from a template (the chest's, or `template` if given)
/// and returns its path.
#[tauri::command]
pub async fn create_note(
    path: String,
    template: Option<String>,
    state: State<'_, AppState>,
) -> CmdResult<String> {
    let v = state.scoped(&path).map_err(err)?;
    let text = v.new_note_text(&path, template.as_deref()).map_err(err)?;
    v.create_note(&path, &text).map_err(err)?;
    with_index(&state, |i| i.upsert(&path, &text))?.map_err(err)?;
    Ok(path)
}

#[tauri::command]
pub async fn create_folder(path: String, state: State<'_, AppState>) -> CmdResult<()> {
    state
        .scoped(&path)
        .and_then(|v| v.create_folder(&path))
        .map_err(err)
}

/// What a rename did, and which links could follow it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    /// Every note that moved: (old path, new path).
    moves: Vec<(String, String)>,
    /// Links that point to the old names and could be updated.
    links: usize,
    /// Notes containing those links.
    notes: usize,
}

#[tauri::command]
pub async fn rename_path(
    from: String,
    to: String,
    state: State<'_, AppState>,
) -> CmdResult<RenameResult> {
    let v = state.scoped(&from).map_err(err)?;
    state.scoped(&to).map_err(err)?;
    let src = v.absolute(&from).map_err(err)?;
    let was_note = NoteFormat::from_path(&from).is_some() && src.is_file();
    let was_dir = src.is_dir();
    v.rename(&from, &to).map_err(err)?;
    reindex_after_move(&state, &v, &from, &to, was_note)?;

    let moves: Vec<(String, String)> = if was_note && NoteFormat::from_path(&to).is_some() {
        vec![(from, to)]
    } else if was_dir {
        let chest = state.chest().map_err(err)?;
        let prefix = format!("{to}/");
        v.notes_in(&chest)
            .map_err(err)?
            .into_iter()
            .filter_map(|p| {
                let rest = p.strip_prefix(&prefix)?.to_owned();
                Some((format!("{from}/{rest}"), p))
            })
            .collect()
    } else {
        Vec::new()
    };
    let updates = with_index(&state, |i| i.link_updates(&moves))?;
    Ok(RenameResult {
        links: updates.iter().map(|(_, n)| n).sum(),
        notes: updates.len(),
        moves,
    })
}

/// Rewrites `[[links]]` that pointed to renamed notes. Reads each note from
/// disk so edits made since the rename are kept. Returns the changed notes.
#[tauri::command]
pub async fn update_links(
    moves: Vec<(String, String)>,
    state: State<'_, AppState>,
) -> CmdResult<Vec<String>> {
    let v = state.vault().map_err(err)?;
    let chest = state.chest().map_err(err)?;
    for (old, new) in &moves {
        vault::ensure_in_chest(old, &chest).map_err(err)?;
        vault::ensure_in_chest(new, &chest).map_err(err)?;
    }
    let paths = with_index(&state, |i| i.paths().to_vec())?;
    let map = crate::links::RenameMap::new(&chest, &moves, &paths);
    let mut changed = Vec::new();
    for path in &paths {
        let Some(format) = NoteFormat::from_path(path) else {
            continue;
        };
        let Ok(text) = v.read_note(path) else {
            continue;
        };
        let edits = map.edits(path, &text, format);
        if edits.is_empty() {
            continue;
        }
        let updated = crate::links::apply(&text, &edits);
        v.write_note(path, &updated).map_err(err)?;
        with_index(&state, |i| i.upsert(path, &updated))?.map_err(err)?;
        changed.push(path.clone());
    }
    Ok(changed)
}

#[tauri::command]
pub async fn trash_path(path: String, state: State<'_, AppState>) -> CmdResult<()> {
    let v = state.scoped(&path).map_err(err)?;
    let was_note = NoteFormat::from_path(&path).is_some();
    v.trash(&path).map_err(err)?;
    if was_note {
        with_index(&state, |i| i.remove(&path))?.map_err(err)
    } else {
        rebuild_index(&state, &v)
    }
}

fn reindex_after_move(
    state: &AppState,
    v: &Vault,
    from: &str,
    to: &str,
    was_note: bool,
) -> CmdResult<()> {
    if was_note && NoteFormat::from_path(to).is_some() {
        let text = v.read_note(to).map_err(err)?;
        with_index(state, |i| i.remove(from).and_then(|_| i.upsert(to, &text)))?.map_err(err)
    } else {
        rebuild_index(state, v)
    }
}

fn rebuild_index(state: &AppState, v: &Vault) -> CmdResult<()> {
    let chest = state.chest().map_err(err)?;
    let idx = ChestIndex::build(v, &chest).map_err(err)?;
    *state.index.lock().unwrap() = Some(idx);
    Ok(())
}

// ---- links and search -------------------------------------------------------

#[tauri::command]
pub async fn resolve_link(
    target: String,
    from: String,
    state: State<'_, AppState>,
) -> CmdResult<Option<String>> {
    with_index(&state, |i| i.resolve(&target, &from))
}

#[tauri::command]
pub async fn backlinks(path: String, state: State<'_, AppState>) -> CmdResult<Vec<Backlink>> {
    with_index(&state, |i| i.backlinks(&path))
}

#[tauri::command]
pub async fn outgoing_links(path: String, state: State<'_, AppState>) -> CmdResult<Vec<OutLink>> {
    with_index(&state, |i| i.outgoing(&path))
}

#[tauri::command]
pub async fn search(query: String, state: State<'_, AppState>) -> CmdResult<Vec<SearchHit>> {
    with_index(&state, |i| i.search(&query, 50))?.map_err(err)
}

#[tauri::command]
pub async fn render_markdown(text: String) -> String {
    markdown::render(&text)
}

#[tauri::command]
pub async fn templates(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    state.vault().and_then(|v| v.templates()).map_err(err)
}

// ---- export -------------------------------------------------------------------

#[derive(Serialize)]
pub struct ExportResult {
    path: String,
    /// Parts the PDF could not include (missing images, raw HTML, …).
    warnings: Vec<String>,
}

/// Asks where to save, then exports a note to PDF: Typst notes compile
/// directly, Markdown notes go through a Typst conversion (ADR 0006).
/// Returns `None` if the user cancelled.
#[tauri::command]
pub async fn export_pdf(app: AppHandle, path: String) -> CmdResult<Option<ExportResult>> {
    let state = app.state::<AppState>();
    let v = state.scoped(&path).map_err(err)?;
    let input = v.absolute(&path).map_err(err)?;
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "note".into());
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .set_file_name(format!("{stem}.pdf"));
    if let Some(dir) = input.parent() {
        dialog = dialog.set_directory(dir);
    }
    dialog.save_file(move |p| {
        let _ = tx.send(p);
    });
    let Some(output) = rx.await.map_err(err)?.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let cache = app.path().app_cache_dir().map_err(err)?;
    let done = export::export_pdf(&v, &path, &output, &cache).await?;
    Ok(Some(ExportResult {
        path: output.to_string_lossy().into_owned(),
        warnings: done.warnings,
    }))
}

/// Shows a vault file or folder in the system file manager.
#[tauri::command]
pub async fn reveal_vault_path(app: AppHandle, path: String) -> CmdResult<()> {
    let abs = app
        .state::<AppState>()
        .vault()
        .and_then(|v| v.absolute(&path))
        .map_err(err)?;
    app.opener().reveal_item_in_dir(abs).map_err(err)
}

/// Opens a web or mail link in the default app. Other schemes are refused.
#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> CmdResult<()> {
    let lower = url.to_ascii_lowercase();
    if !["https://", "http://", "mailto:"]
        .iter()
        .any(|p| lower.starts_with(p))
    {
        return Err(format!("refusing to open {url}"));
    }
    app.opener().open_url(url, None::<&str>).map_err(err)
}

/// Shows a file in the system file manager.
#[tauri::command]
pub async fn reveal_path(app: AppHandle, path: String) -> CmdResult<()> {
    app.opener().reveal_item_in_dir(path).map_err(err)
}

// ---- live preview ---------------------------------------------------------

/// Renders Typst fragments of a note to SVG for the writing view (ADR 0007).
#[tauri::command]
pub async fn render_fragments(
    app: AppHandle,
    note: String,
    preamble: String,
    fragments: Vec<typst::render::Fragment>,
    files: Vec<String>,
) -> CmdResult<Vec<typst::render::Rendered>> {
    let state = app.state::<AppState>();
    let v = state.scoped(&note).map_err(err)?;
    let chest = state.chest().map_err(err)?;
    // Referenced files must come from the open chest or `_shared/`.
    let files: Vec<String> = files
        .into_iter()
        .filter(|f| {
            vault::ensure_in_chest(f, &chest).is_ok()
                || f.starts_with(&format!("{}/", vault::SHARED_DIR))
        })
        .collect();
    let workspace = app
        .path()
        .app_cache_dir()
        .map_err(err)?
        .join("render")
        .join(std::process::id().to_string());
    let note_dir = note.rsplit_once('/').map_or("", |(d, _)| d).to_owned();
    let _guard = state.render_lock.lock().await;
    typst::render::render(typst::render::Request {
        vault: &v,
        note_dir: &note_dir,
        preamble: &preamble,
        fragments: &fragments,
        files: &files,
        workspace: &workspace,
    })
    .await
}

/// Asks for an image and returns its path relative to the note's folder.
/// Files outside the vault are copied into `<chest>/assets/` first.
#[tauri::command]
pub async fn import_asset(app: AppHandle, note: String) -> CmdResult<Option<String>> {
    let state = app.state::<AppState>();
    let v = state.scoped(&note).map_err(err)?;
    let chest = state.chest().map_err(err)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter(
            "Images",
            &["png", "jpg", "jpeg", "gif", "svg", "webp", "pdf"],
        )
        .pick_file(move |p| {
            let _ = tx.send(p);
        });
    let Some(picked) = rx.await.map_err(err)?.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let picked = dunce::canonicalize(&picked).map_err(err)?;
    let in_chest = picked.strip_prefix(v.root().join(&chest)).ok().map(|rel| {
        let rel = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        format!("{chest}/{rel}")
    });
    let target = match in_chest {
        Some(p) => p,
        None => vault::import_into_assets(&v, &chest, &picked).map_err(err)?,
    };
    let note_dir = note.rsplit_once('/').map_or("", |(d, _)| d);
    Ok(Some(vault::relative_to(note_dir, &target)))
}

// ---- Typst engine -----------------------------------------------------------------

/// What the engine channel carries to the UI.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "lowercase")]
pub enum EngineEvent {
    /// One JSON-RPC message from the language server.
    Message(String),
    /// The server process ended.
    Exit,
}

/// Starts (or restarts) the Typst engine for the open vault. LSP messages
/// from the server stream back through `channel`.
#[tauri::command]
pub async fn engine_start(
    channel: Channel<EngineEvent>,
    state: State<'_, AppState>,
) -> CmdResult<String> {
    let v = state.vault().map_err(err)?;
    let mut slot = state.engine.lock().await;
    if let Some(old) = slot.take() {
        old.kill().await;
    }
    let exit_channel = channel.clone();
    let engine = typst::Engine::spawn(
        v.root(),
        move |msg| {
            let _ = channel.send(EngineEvent::Message(msg));
        },
        move || {
            let _ = exit_channel.send(EngineEvent::Exit);
        },
    )
    .map_err(err)?;
    *slot = Some(engine);
    Ok(typst::PINNED_VERSION.trim().to_owned())
}

#[tauri::command]
pub async fn engine_send(message: String, state: State<'_, AppState>) -> CmdResult<()> {
    let mut slot = state.engine.lock().await;
    let engine = slot.as_mut().ok_or("the Typst engine is not running")?;
    engine.send(&message).await.map_err(err)
}
