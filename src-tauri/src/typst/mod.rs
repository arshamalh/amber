//! The Typst engine adapter. Amber talks to Typst only through this module,
//! and only over LSP (plus Tinymist's preview, started via an LSP command).
//! Swapping the engine later means replacing this module, nothing else.
//!
//! Tinymist ships as a Tauri sidecar. Its version is pinned in
//! `src-tauri/tinymist.version` and fetched by `scripts/fetch-tinymist.mjs`.

mod framing;

use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::io::BufReader;
use tokio::process::{Child, ChildStdin, Command};

pub use framing::{read_message, write_message};

/// The Tinymist version this build of Amber expects.
pub const PINNED_VERSION: &str = include_str!("../../tinymist.version");

/// Where to find the Tinymist binary: `$AMBER_TINYMIST` if set, otherwise
/// the bundled sidecar next to the Amber executable.
pub fn binary_path() -> PathBuf {
    if let Some(p) = std::env::var_os("AMBER_TINYMIST") {
        return PathBuf::from(p);
    }
    let name = format!("tinymist{}", std::env::consts::EXE_SUFFIX);
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.join(&name)))
        .unwrap_or_else(|| PathBuf::from(name))
}

/// Compiles `input` to a PDF at `output` with the bundled Tinymist.
/// `root` is the Typst project root (the vault), so `/_shared/...` imports
/// resolve the same way as in the preview.
pub async fn export_pdf(root: &Path, input: &Path, output: &Path) -> Result<(), String> {
    let mut cmd = Command::new(binary_path());
    cmd.arg("compile")
        .arg("--root")
        .arg(root)
        .arg(input)
        .arg(output)
        .current_dir(root)
        .stdin(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let out = cmd
        .output()
        .await
        .map_err(|e| format!("could not run Tinymist: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        let mut msg = String::from_utf8_lossy(&out.stderr).trim().to_owned();
        if msg.is_empty() {
            msg = String::from_utf8_lossy(&out.stdout).trim().to_owned();
        }
        Err(if msg.is_empty() {
            "PDF export failed".into()
        } else {
            msg
        })
    }
}

/// A running `tinymist lsp` process.
pub struct Engine {
    stdin: ChildStdin,
    child: Child,
}

impl Engine {
    /// Starts `tinymist lsp` in `cwd`. Every message from the server is
    /// passed to `on_message`; `on_exit` runs once the server's stdout closes.
    pub fn spawn(
        cwd: &Path,
        on_message: impl Fn(String) + Send + 'static,
        on_exit: impl FnOnce() + Send + 'static,
    ) -> std::io::Result<Self> {
        let bin = binary_path();
        let mut cmd = Command::new(&bin);
        cmd.arg("lsp")
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let mut child = cmd.spawn().map_err(|e| {
            std::io::Error::new(
                e.kind(),
                format!(
                    "could not start Tinymist at {}: {e}. Run `npm run fetch-tinymist`.",
                    bin.display()
                ),
            )
        })?;
        let stdin = child.stdin.take().expect("stdin is piped");
        let stdout = child.stdout.take().expect("stdout is piped");

        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_message(&mut reader).await {
                    Ok(Some(msg)) => on_message(msg),
                    Ok(None) => break,
                    Err(e) => {
                        eprintln!("[amber] tinymist stream error: {e}");
                        break;
                    }
                }
            }
            on_exit();
        });

        Ok(Self { stdin, child })
    }

    pub async fn send(&mut self, message: &str) -> std::io::Result<()> {
        write_message(&mut self.stdin, message).await
    }

    pub async fn kill(mut self) {
        let _ = self.child.kill().await;
    }
}
