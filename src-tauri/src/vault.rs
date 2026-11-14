//! Vault file access. The UI never touches files directly; every read and
//! write goes through here and is confined to the open vault's root.
//!
//! Phase 0 treats the opened folder as a flat set of notes. Chests
//! (`chest.toml`, scoping) arrive in Phase 1 and will build on this.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("no vault is open")]
    NotOpen,
    #[error("path escapes the vault: {0}")]
    OutsideVault(String),
    #[error("not a note (expected .typ or .md): {0}")]
    NotANote(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, VaultError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteFormat {
    Typst,
    Markdown,
}

impl NoteFormat {
    pub fn from_path(path: &Path) -> Option<Self> {
        match path.extension()?.to_str()? {
            "typ" => Some(Self::Typst),
            "md" => Some(Self::Markdown),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteEntry {
    /// Path relative to the vault root, always with `/` separators.
    pub path: String,
    pub format: NoteFormat,
}

#[derive(Debug, Clone)]
pub struct Vault {
    root: PathBuf,
}

impl Vault {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = dunce::canonicalize(root)?;
        if !root.is_dir() {
            return Err(VaultError::Io(std::io::Error::new(
                std::io::ErrorKind::NotADirectory,
                "vault root must be a folder",
            )));
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// All `.typ` and `.md` files, sorted by path. Hidden entries (dot
    /// files, `.git`) are skipped.
    pub fn list_notes(&self) -> Result<Vec<NoteEntry>> {
        let mut out = Vec::new();
        walk(&self.root, &self.root, &mut out)?;
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    pub fn read_note(&self, rel: &str) -> Result<String> {
        Ok(fs::read_to_string(self.resolve_note(rel)?)?)
    }

    /// Writes atomically (temp file + rename) so a crash never leaves a
    /// half-written note.
    pub fn write_note(&self, rel: &str, content: &str) -> Result<()> {
        let path = self.resolve_note(rel)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let tmp = path.with_file_name(format!(".{file_name}.amber-tmp"));
        fs::write(&tmp, content)?;
        fs::rename(&tmp, &path).inspect_err(|_| {
            let _ = fs::remove_file(&tmp);
        })?;
        Ok(())
    }

    /// Absolute path of a note, for handing to the Typst engine.
    pub fn absolute(&self, rel: &str) -> Result<PathBuf> {
        self.resolve_note(rel)
    }

    /// Resolves a vault-relative note path. Rejects absolute paths, `..`,
    /// and anything that is not a `.typ` or `.md` file. Symlinks that
    /// point outside the vault are rejected too.
    fn resolve_note(&self, rel: &str) -> Result<PathBuf> {
        let rel_path = Path::new(rel);
        if rel.is_empty()
            || rel_path
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(VaultError::OutsideVault(rel.to_owned()));
        }
        if NoteFormat::from_path(rel_path).is_none() {
            return Err(VaultError::NotANote(rel.to_owned()));
        }
        let full = self.root.join(rel_path);
        // If the file (or its nearest existing ancestor) resolves through a
        // symlink, make sure it still lands inside the vault.
        let mut probe = full.as_path();
        while !probe.exists() {
            match probe.parent() {
                Some(p) => probe = p,
                None => break,
            }
        }
        if !dunce::canonicalize(probe)?.starts_with(&self.root) {
            return Err(VaultError::OutsideVault(rel.to_owned()));
        }
        Ok(full)
    }
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<NoteEntry>) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        let ty = entry.file_type()?;
        if ty.is_dir() {
            walk(root, &path, out)?;
        } else if ty.is_file() {
            if let Some(format) = NoteFormat::from_path(&path) {
                let rel = path.strip_prefix(root).expect("walk stays under root");
                let rel = rel
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("/");
                out.push(NoteEntry { path: rel, format });
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("thesis/01-intro")).unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join("thesis/01-intro/a.typ"), "= A").unwrap();
        fs::write(dir.path().join("thesis/b.md"), "# B").unwrap();
        fs::write(dir.path().join("thesis/chest.toml"), "name = \"T\"").unwrap();
        fs::write(dir.path().join(".git/HEAD.typ"), "").unwrap();
        let v = Vault::open(dir.path()).unwrap();
        (dir, v)
    }

    #[test]
    fn lists_only_visible_notes() {
        let (_d, v) = vault();
        let paths: Vec<_> = v
            .list_notes()
            .unwrap()
            .into_iter()
            .map(|n| n.path)
            .collect();
        assert_eq!(paths, ["thesis/01-intro/a.typ", "thesis/b.md"]);
    }

    #[test]
    fn reads_and_writes_inside_the_vault() {
        let (_d, v) = vault();
        v.write_note("thesis/new/c.typ", "hello").unwrap();
        assert_eq!(v.read_note("thesis/new/c.typ").unwrap(), "hello");
        v.write_note("thesis/new/c.typ", "again").unwrap();
        assert_eq!(v.read_note("thesis/new/c.typ").unwrap(), "again");
        // No temp file left behind.
        let leftovers: Vec<_> = fs::read_dir(v.root().join("thesis/new")).unwrap().collect();
        assert_eq!(leftovers.len(), 1);
    }

    #[test]
    fn rejects_escapes_and_non_notes() {
        let (_d, v) = vault();
        for bad in [
            "../x.typ",
            "/etc/x.typ",
            "thesis/../../x.typ",
            "",
            "./a.typ",
        ] {
            assert!(
                matches!(v.read_note(bad), Err(VaultError::OutsideVault(_))),
                "{bad}"
            );
        }
        assert!(matches!(
            v.read_note("thesis/chest.toml"),
            Err(VaultError::NotANote(_))
        ));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_out_of_the_vault() {
        let (_d, v) = vault();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.typ"), "s").unwrap();
        std::os::unix::fs::symlink(outside.path(), v.root().join("link")).unwrap();
        assert!(matches!(
            v.read_note("link/secret.typ"),
            Err(VaultError::OutsideVault(_))
        ));
    }
}
