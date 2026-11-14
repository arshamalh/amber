//! Watches the vault for changes made outside Amber (another editor, git,
//! a sync tool) and reports them as vault-relative paths.

use std::path::{Path, PathBuf};
use std::time::Duration;

use notify_debouncer_full::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};

pub type VaultWatcher = Debouncer<RecommendedWatcher, RecommendedCache>;

pub fn watch(
    root: &Path,
    on_change: impl Fn(Vec<String>) + Send + 'static,
) -> notify_debouncer_full::notify::Result<VaultWatcher> {
    let root_owned = root.to_owned();
    let mut debouncer = new_debouncer(
        Duration::from_millis(250),
        None,
        move |res: DebounceEventResult| {
            let Ok(events) = res else { return };
            let mut paths: Vec<String> = events
                .iter()
                .flat_map(|e| e.paths.iter())
                .filter_map(|p| relative(&root_owned, p))
                .collect();
            paths.sort();
            paths.dedup();
            if !paths.is_empty() {
                on_change(paths);
            }
        },
    )?;
    debouncer.watch(root, RecursiveMode::Recursive)?;
    Ok(debouncer)
}

/// Vault-relative `/` path, or `None` for paths outside the vault or under
/// hidden entries (`.git`, temp files from atomic writes).
fn relative(root: &Path, path: &Path) -> Option<String> {
    let rel = path
        .strip_prefix(root)
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            // Some platforms report non-canonical paths (e.g. /var vs /private/var).
            let parent = dunce::canonicalize(path.parent()?).ok()?;
            Some(parent.strip_prefix(root).ok()?.join(path.file_name()?))
        })?;
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    if parts.is_empty() || parts.iter().any(|p| p.starts_with('.')) {
        return None;
    }
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths_skip_hidden() {
        let root = Path::new("/v");
        assert_eq!(
            relative(root, Path::new("/v/a/b.typ")).as_deref(),
            Some("a/b.typ")
        );
        assert_eq!(relative(root, Path::new("/v/.git/HEAD")), None);
        assert_eq!(relative(root, Path::new("/v/a/.b.typ.amber-tmp")), None);
        assert_eq!(relative(root, Path::new("/v")), None);
    }

    #[test]
    fn reports_external_writes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let _w = watch(&root, move |p| {
            let _ = tx.send(p);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        std::fs::write(root.join("x.typ"), "hi").unwrap();
        let mut seen = Vec::new();
        while let Ok(batch) = rx.recv_timeout(Duration::from_secs(5)) {
            seen.extend(batch);
            if seen.iter().any(|p| p == "x.typ") {
                break;
            }
        }
        assert!(seen.iter().any(|p| p == "x.typ"), "{seen:?}");
    }
}
