//! Amber's Rust core. The web UI calls the commands in `commands.rs`; it
//! never reads or writes files on its own.

mod commands;
mod config;
mod export;
mod git;
mod index;
mod links;
mod markdown;
mod md2typst;
mod settings;
mod typst;
mod uri;
mod vault;
mod watcher;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::http::{header, Response, StatusCode};
use tauri::{Manager, RunEvent};

use index::ChestIndex;
use settings::Settings;
use vault::{Vault, VaultError};

pub struct AppState {
    vault: Mutex<Option<Vault>>,
    /// Folder of the open chest. Everything chest-scoped checks against it.
    chest: Mutex<Option<String>>,
    index: Mutex<Option<ChestIndex>>,
    watcher: Mutex<Option<watcher::VaultWatcher>>,
    engine: tokio::sync::Mutex<Option<typst::Engine>>,
    /// Serializes fragment renders (they share one scratch folder).
    render_lock: tokio::sync::Mutex<()>,
    settings: Mutex<Settings>,
    settings_path: PathBuf,
    /// An update found by `check_update`, waiting for `install_update`.
    pending_update: Mutex<Option<tauri_plugin_updater::Update>>,
}

impl AppState {
    fn new(settings_path: PathBuf) -> Self {
        Self {
            vault: Mutex::default(),
            chest: Mutex::default(),
            index: Mutex::default(),
            watcher: Mutex::default(),
            engine: tokio::sync::Mutex::default(),
            render_lock: tokio::sync::Mutex::default(),
            settings: Mutex::new(Settings::load(&settings_path)),
            settings_path,
            pending_update: Mutex::default(),
        }
    }

    fn vault(&self) -> Result<Vault, VaultError> {
        self.vault
            .lock()
            .unwrap()
            .clone()
            .ok_or(VaultError::NotOpen)
    }

    fn chest(&self) -> Result<String, VaultError> {
        self.chest
            .lock()
            .unwrap()
            .clone()
            .ok_or(VaultError::NoChest)
    }

    /// The vault plus a check that `rel` is inside the open chest.
    fn scoped(&self, rel: &str) -> Result<Vault, VaultError> {
        vault::ensure_in_chest(rel, &self.chest()?)?;
        self.vault()
    }

    fn with_settings(&self, f: impl FnOnce(&mut Settings)) {
        let mut s = self.settings.lock().unwrap();
        f(&mut s);
        if let Err(e) = s.save(&self.settings_path) {
            eprintln!("[amber] could not save settings: {e}");
        }
    }
}

/// Serves vault files to the UI at `amberfile://localhost/<encoded path>`
/// (`http://amberfile.localhost/...` on Windows), read-only, for images in
/// Markdown previews.
fn serve_vault_file(app: &tauri::AppHandle, uri_path: &str) -> Response<Vec<u8>> {
    let rel = uri::percent_decode(uri_path.trim_start_matches('/'));
    let result = app
        .state::<AppState>()
        .vault()
        .and_then(|v| v.read_file(&rel));
    match result {
        Ok(bytes) => Response::builder()
            .header(header::CONTENT_TYPE, uri::mime_for(&rel))
            .header("X-Content-Type-Options", "nosniff")
            .body(bytes)
            .unwrap(),
        Err(_) => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            app.manage(AppState::new(settings::path(dir)));
            Ok(())
        })
        .register_uri_scheme_protocol("amberfile", |ctx, req| {
            serve_vault_file(ctx.app_handle(), req.uri().path())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::pick_folder,
            commands::open_vault,
            commands::init_vault,
            commands::create_vault,
            commands::clone_vault,
            commands::forget_vault,
            commands::set_reopen_last_vault,
            commands::set_auto_check_updates,
            commands::check_update,
            commands::install_update,
            commands::list_chests,
            commands::create_chest,
            commands::make_chest,
            commands::pick_chest_folder,
            commands::rename_chest,
            commands::delete_chest,
            commands::update_chest,
            commands::open_chest,
            commands::tree,
            commands::note_list,
            commands::open_note,
            commands::write_note,
            commands::create_note,
            commands::create_folder,
            commands::rename_path,
            commands::update_links,
            commands::trash_path,
            commands::resolve_link,
            commands::backlinks,
            commands::outgoing_links,
            commands::search,
            commands::render_markdown,
            commands::templates,
            commands::export_pdf,
            commands::reveal_path,
            commands::reveal_vault_path,
            commands::open_external,
            commands::engine_start,
            commands::engine_send,
            commands::render_fragments,
            commands::import_asset,
            commands::paste_asset,
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
