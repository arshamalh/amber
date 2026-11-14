//! Optional git support through the system `git`, so the user's existing
//! SSH keys and credential helpers work. Never assume a vault is a repo.

use std::path::Path;
use std::process::Stdio;

use tokio::process::Command;

fn git() -> Command {
    let mut cmd = Command::new("git");
    // A GUI app has no terminal to type a password into: fail instead of
    // hanging, and tell the user to set up credentials.
    cmd.env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

async fn run(mut cmd: Command) -> Result<(), String> {
    let out = cmd
        .output()
        .await
        .map_err(|e| format!("could not run git: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(err.trim().lines().last().unwrap_or("git failed").to_owned())
    }
}

pub async fn available() -> bool {
    let mut cmd = git();
    cmd.arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.status().await.is_ok_and(|s| s.success())
}

pub async fn init(dir: &Path) -> Result<(), String> {
    let mut cmd = git();
    cmd.arg("init").arg("--quiet").current_dir(dir);
    run(cmd).await
}

/// Clones `url` into `dest`, which must not exist yet.
pub async fn clone(url: &str, dest: &Path) -> Result<(), String> {
    if url.starts_with('-') {
        return Err("invalid repository URL".into());
    }
    let mut cmd = git();
    cmd.args(["clone", "--quiet", "--", url]).arg(dest);
    run(cmd).await
}

/// A folder name for a clone, from the URL's last path segment.
pub fn name_from_url(url: &str) -> Option<String> {
    let last = url
        .trim_end_matches('/')
        .rsplit(['/', ':'])
        .next()?
        .trim_end_matches(".git");
    (!last.is_empty()).then(|| last.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_from_urls() {
        assert_eq!(
            name_from_url("https://github.com/a/notes.git").as_deref(),
            Some("notes")
        );
        assert_eq!(
            name_from_url("git@github.com:a/my-vault.git").as_deref(),
            Some("my-vault")
        );
        assert_eq!(
            name_from_url("https://host/x/vault/").as_deref(),
            Some("vault")
        );
        assert_eq!(name_from_url(""), None);
    }

    #[tokio::test]
    async fn init_and_clone_locally() {
        if !available().await {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src");
        std::fs::create_dir(&src).unwrap();
        init(&src).await.unwrap();
        assert!(src.join(".git").is_dir());
        let dest = dir.path().join("copy");
        clone(src.to_str().unwrap(), &dest).await.unwrap();
        assert!(dest.join(".git").is_dir());
        assert!(clone("--upload-pack=x", &dir.path().join("y"))
            .await
            .is_err());
    }
}
