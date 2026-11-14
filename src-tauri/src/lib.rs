//! Amber's Rust core. The web UI calls the commands below; it never reads or
//! writes files on its own.

mod typst;
mod uri;
mod vault;

use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{Manager, RunEvent, State};
use tauri_plugin_dialog::DialogExt;

use vault::{NoteFormat, Vault, VaultError};

#[derive(Default)]
struct AppState {
    vault: Mutex<Option<Vault>>,
    engine: tokio::sync::Mutex<Option<typst::Engine>>,
}

impl AppState {
    fn vault(&self) -> Result<Vault, VaultError> {
        self.vault
            .lock()
            .unwrap()
            .clone()
            .ok_or(VaultError::NotOpen)
    }
}

type CmdResult<T> = Result<T, String>;

fn err(e: impl ToString) -> String {
    e.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultInfo {
    name: String,
    root_uri: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Note {
    path: String,
    format: NoteFormat,
    /// LSP document URI.
    uri: String,
    /// Absolute path, only for handing to the Typst engine (preview).
    engine_path: String,
}

#[tauri::command]
async fn pick_vault(app: tauri::AppHandle) -> CmdResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |p| {
        let _ = tx.send(p);
    });
    let picked = rx.await.map_err(err)?;
    Ok(picked
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned()))
}

/// A vault to open on launch: the first CLI argument, else `$AMBER_VAULT`.
#[tauri::command]
fn startup_vault() -> Option<String> {
    std::env::args()
        .nth(1)
        .or_else(|| std::env::var("AMBER_VAULT").ok())
        .filter(|p| std::path::Path::new(p).is_dir())
}

#[tauri::command]
async fn open_vault(path: String, state: State<'_, AppState>) -> CmdResult<VaultInfo> {
    let v = Vault::open(&path).map_err(err)?;
    let info = VaultInfo {
        name: v
            .root()
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        root_uri: uri::file_uri(v.root()),
    };
    *state.vault.lock().unwrap() = Some(v);
    Ok(info)
}

#[tauri::command]
fn list_notes(state: State<'_, AppState>) -> CmdResult<Vec<Note>> {
    let v = state.vault().map_err(err)?;
    v.list_notes()
        .map_err(err)?
        .into_iter()
        .map(|n| {
            let abs = v.absolute(&n.path).map_err(err)?;
            Ok(Note {
                uri: uri::file_uri(&abs),
                engine_path: abs.to_string_lossy().into_owned(),
                path: n.path,
                format: n.format,
            })
        })
        .collect()
}

#[tauri::command]
fn read_note(path: String, state: State<'_, AppState>) -> CmdResult<String> {
    state.vault().and_then(|v| v.read_note(&path)).map_err(err)
}

#[tauri::command]
fn write_note(path: String, content: String, state: State<'_, AppState>) -> CmdResult<()> {
    state
        .vault()
        .and_then(|v| v.write_note(&path, &content))
        .map_err(err)
}

/// What the engine channel carries to the UI.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "lowercase")]
enum EngineEvent {
    /// One JSON-RPC message from the language server.
    Message(String),
    /// The server process ended.
    Exit,
}

/// Starts (or restarts) the Typst engine for the open vault. LSP messages
/// from the server stream back through `channel`.
#[tauri::command]
async fn engine_start(
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
async fn engine_send(message: String, state: State<'_, AppState>) -> CmdResult<()> {
    let mut slot = state.engine.lock().await;
    let engine = slot.as_mut().ok_or("the Typst engine is not running")?;
    engine.send(&message).await.map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            pick_vault,
            startup_vault,
            open_vault,
            list_notes,
            read_note,
            write_note,
            engine_start,
            engine_send,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Amber");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            let state = handle.state::<AppState>();
            tauri::async_runtime::block_on(async {
                if let Some(engine) = state.engine.lock().await.take() {
                    engine.kill().await;
                }
            });
        }
    });
}
