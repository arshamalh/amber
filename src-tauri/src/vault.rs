//! Vault and chest file access. The UI never touches files directly; every
//! read and write goes through here and is confined to the vault root.
//!
//! Layout: a vault is a folder with `amber.toml`. Each first-level folder
//! with a `chest.toml` is a chest. `_shared/` holds templates and the Amber
//! Typst helpers. All paths crossing this API are vault-relative with `/`.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::config::{self, ChestConfig, ConfigError, VaultConfig, CHEST_FILE, VAULT_FILE};

pub const SHARED_DIR: &str = "_shared";

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("no vault is open")]
    NotOpen,
    #[error("no chest is open")]
    NoChest,
    #[error("path escapes the vault: {0}")]
    OutsideVault(String),
    #[error("path is outside the open chest: {0}")]
    OutsideChest(String),
    #[error("not a note (expected .typ or .md): {0}")]
    NotANote(String),
    #[error("invalid name: {0:?}")]
    InvalidName(String),
    #[error("already exists: {0}")]
    Exists(String),
    #[error("could not move to trash: {0}")]
    Trash(String),
    #[error(transparent)]
    Config(#[from] ConfigError),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, VaultError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteFormat {
    Typst,
    Markdown,
}

impl NoteFormat {
    pub fn from_path(path: impl AsRef<Path>) -> Option<Self> {
        match path.as_ref().extension()?.to_str()? {
            "typ" => Some(Self::Typst),
            "md" => Some(Self::Markdown),
            _ => None,
        }
    }

    pub fn ext(self) -> &'static str {
        match self {
            Self::Typst => "typ",
            Self::Markdown => "md",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChestInfo {
    /// The chest's folder name (first path component).
    pub folder: String,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub default_format: NoteFormat,
    pub template: Option<String>,
    /// False for first-level folders without a `chest.toml` yet.
    pub is_chest: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Dir,
    Note,
    File,
}

#[derive(Debug, Clone, Serialize)]
pub struct TreeEntry {
    pub path: String,
    pub kind: EntryKind,
    pub format: Option<NoteFormat>,
}

#[derive(Debug, Clone)]
pub struct Vault {
    root: PathBuf,
}

impl Vault {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = dunce::canonicalize(root)?;
        if !root.is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotADirectory,
                "vault root must be a folder",
            )
            .into());
        }
        Ok(Self { root })
    }

    /// Creates `parent/name` as a new vault with a starter chest.
    pub fn create(parent: impl AsRef<Path>, name: &str) -> Result<Self> {
        check_name(name)?;
        let dir = parent.as_ref().join(name);
        if dir.exists() {
            return Err(VaultError::Exists(dir.display().to_string()));
        }
        fs::create_dir_all(&dir)?;
        let vault = Self::open(&dir)?;
        vault.init(name)?;
        let chest = vault.create_chest("Notes")?;
        vault.create_note(&format!("{}/Welcome.typ", chest.folder), WELCOME_NOTE)?;
        Ok(vault)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn is_initialized(&self) -> bool {
        self.root.join(VAULT_FILE).is_file()
    }

    pub fn config(&self) -> Result<VaultConfig> {
        Ok(config::read(&self.root.join(VAULT_FILE))?)
    }

    pub fn display_name(&self) -> String {
        self.config()
            .ok()
            .and_then(|c| c.name)
            .unwrap_or_else(|| file_name(&self.root))
    }

    /// Makes the folder a vault: writes `amber.toml` and the `_shared/`
    /// helpers. Existing files are never overwritten.
    pub fn init(&self, name: &str) -> Result<()> {
        write_new(&self.root.join(VAULT_FILE), &config::new_vault_toml(name))?;
        let shared = self.root.join(SHARED_DIR);
        fs::create_dir_all(shared.join("templates"))?;
        write_new(&shared.join("amber.typ"), AMBER_TYP)?;
        write_new(&shared.join("templates/note.typ"), TEMPLATE_TYP)?;
        write_new(&shared.join("templates/note.md"), TEMPLATE_MD)?;
        Ok(())
    }

    // ---- chests -------------------------------------------------------

    /// First-level folders, chests first. Hidden (`.`) and system (`_`)
    /// folders are skipped.
    pub fn chests(&self) -> Result<Vec<ChestInfo>> {
        let mut out = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let folder = entry.file_name().to_string_lossy().into_owned();
            if folder.starts_with(['.', '_']) || !entry.file_type()?.is_dir() {
                continue;
            }
            out.push(self.chest_info(&folder)?);
        }
        out.sort_by(|a, b| {
            (!a.is_chest, a.name.to_lowercase()).cmp(&(!b.is_chest, b.name.to_lowercase()))
        });
        Ok(out)
    }

    pub fn chest_info(&self, folder: &str) -> Result<ChestInfo> {
        let toml = self.chest_dir(folder)?.join(CHEST_FILE);
        let is_chest = toml.is_file();
        let cfg: ChestConfig = config::read(&toml)?;
        Ok(ChestInfo {
            folder: folder.to_owned(),
            name: cfg.name.unwrap_or_else(|| folder.to_owned()),
            icon: cfg.icon,
            color: cfg.color,
            default_format: cfg.default_format,
            template: cfg.template,
            is_chest,
        })
    }

    pub fn chest_config(&self, folder: &str) -> Result<ChestConfig> {
        Ok(config::read(&self.chest_dir(folder)?.join(CHEST_FILE))?)
    }

    pub fn edit_chest(&self, folder: &str, edits: &[config::Edit]) -> Result<ChestInfo> {
        config::edit(&self.chest_dir(folder)?.join(CHEST_FILE), edits)?;
        self.chest_info(folder)
    }

    pub fn create_chest(&self, name: &str) -> Result<ChestInfo> {
        check_name(name)?;
        if name.starts_with('_') {
            return Err(VaultError::InvalidName(name.to_owned()));
        }
        let dir = self.root.join(name);
        if dir.exists() {
            return Err(VaultError::Exists(name.to_owned()));
        }
        fs::create_dir(&dir)?;
        self.make_chest(name)
    }

    /// Adds a `chest.toml` to an existing first-level folder.
    pub fn make_chest(&self, folder: &str) -> Result<ChestInfo> {
        let dir = self.chest_dir(folder)?;
        let template = self
            .root
            .join(SHARED_DIR)
            .join("templates/note.typ")
            .is_file()
            .then_some("_shared/templates/note.typ");
        write_new(
            &dir.join(CHEST_FILE),
            &config::new_chest_toml(folder, template),
        )?;
        self.chest_info(folder)
    }

    fn chest_dir(&self, folder: &str) -> Result<PathBuf> {
        if folder.contains(['/', '\\']) || folder.starts_with('.') {
            return Err(VaultError::OutsideVault(folder.to_owned()));
        }
        let dir = self.resolve(folder)?;
        if !dir.is_dir() {
            return Err(
                std::io::Error::new(std::io::ErrorKind::NotFound, folder.to_owned()).into(),
            );
        }
        Ok(dir)
    }

    // ---- tree and notes ------------------------------------------------

    /// Everything visible inside a chest, sorted by path. Skips hidden
    /// entries and the chest's own `chest.toml`.
    pub fn tree(&self, chest: &str) -> Result<Vec<TreeEntry>> {
        let dir = self.chest_dir(chest)?;
        let mut out = Vec::new();
        walk(&self.root, &dir, &mut |rel, kind| {
            if rel != format!("{chest}/{CHEST_FILE}") {
                out.push(TreeEntry {
                    format: NoteFormat::from_path(&rel),
                    kind,
                    path: rel,
                });
            }
        })?;
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    /// Vault-relative paths of all notes in a chest.
    pub fn notes_in(&self, chest: &str) -> Result<Vec<String>> {
        Ok(self
            .tree(chest)?
            .into_iter()
            .filter(|e| e.kind == EntryKind::Note)
            .map(|e| e.path)
            .collect())
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
        let tmp = path.with_file_name(format!(".{}.amber-tmp", file_name(&path)));
        fs::write(&tmp, content)?;
        fs::rename(&tmp, &path).inspect_err(|_| {
            let _ = fs::remove_file(&tmp);
        })?;
        Ok(())
    }

    /// Creates a note; fails if it already exists.
    pub fn create_note(&self, rel: &str, content: &str) -> Result<()> {
        let path = self.resolve_note(rel)?;
        check_name(&file_name(&path))?;
        if path.exists() {
            return Err(VaultError::Exists(rel.to_owned()));
        }
        self.write_note(rel, content)
    }

    pub fn create_folder(&self, rel: &str) -> Result<()> {
        let path = self.resolve(rel)?;
        check_name(&file_name(&path))?;
        if path.exists() {
            return Err(VaultError::Exists(rel.to_owned()));
        }
        Ok(fs::create_dir_all(path)?)
    }

    /// Renames or moves a file or folder. Never overwrites.
    pub fn rename(&self, from: &str, to: &str) -> Result<()> {
        let src = self.resolve(from)?;
        let dst = self.resolve(to)?;
        check_name(&file_name(&dst))?;
        if !src.exists() {
            return Err(std::io::Error::new(std::io::ErrorKind::NotFound, from.to_owned()).into());
        }
        // Allow case-only renames on case-insensitive file systems.
        let same_file = dunce::canonicalize(&dst).ok() == dunce::canonicalize(&src).ok();
        if dst.exists() && !same_file {
            return Err(VaultError::Exists(to.to_owned()));
        }
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        Ok(fs::rename(src, dst)?)
    }

    /// Moves a file or folder to the system trash.
    pub fn trash(&self, rel: &str) -> Result<()> {
        let path = self.resolve(rel)?;
        trash::delete(&path).map_err(|e| VaultError::Trash(e.to_string()))
    }

    /// Raw bytes of any file in the vault (images and other attachments).
    pub fn read_file(&self, rel: &str) -> Result<Vec<u8>> {
        Ok(fs::read(self.resolve(rel)?)?)
    }

    /// Absolute path of a vault path, for handing to the Typst engine.
    pub fn absolute(&self, rel: &str) -> Result<PathBuf> {
        self.resolve(rel)
    }

    /// The text for a new note: the chest's template if its format
    /// matches, else `_shared/templates/note.<ext>`, else a heading.
    /// `{{title}}` and `{{date}}` are filled in.
    pub fn new_note_text(&self, rel: &str, template: Option<&str>) -> Result<String> {
        let format = NoteFormat::from_path(rel).ok_or_else(|| VaultError::NotANote(rel.into()))?;
        let chest = chest_of(rel);
        let configured = match template {
            Some(t) => Some(t.to_owned()),
            None => self.chest_config(chest)?.template,
        };
        let shared = format!("{SHARED_DIR}/templates/note.{}", format.ext());
        let text = [configured, Some(shared)]
            .into_iter()
            .flatten()
            .filter(|t| NoteFormat::from_path(t) == Some(format))
            .find_map(|t| self.read_note(&t).ok())
            .unwrap_or_else(|| match format {
                NoteFormat::Typst => "= {{title}}\n\n".to_owned(),
                NoteFormat::Markdown => "# {{title}}\n\n".to_owned(),
            });
        let title = Path::new(rel)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        Ok(text
            .replace("{{title}}", &title)
            .replace("{{date}}", &today()))
    }

    /// Template files in `_shared/templates/`.
    pub fn templates(&self) -> Result<Vec<String>> {
        let dir = self.root.join(SHARED_DIR).join("templates");
        if !dir.is_dir() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        walk(&self.root, &dir, &mut |rel, kind| {
            if kind == EntryKind::Note {
                out.push(rel);
            }
        })?;
        out.sort();
        Ok(out)
    }

    // ---- path checks ----------------------------------------------------

    fn resolve_note(&self, rel: &str) -> Result<PathBuf> {
        let path = self.resolve(rel)?;
        if NoteFormat::from_path(rel).is_none() {
            return Err(VaultError::NotANote(rel.to_owned()));
        }
        Ok(path)
    }

    /// Resolves a vault-relative path. Rejects absolute paths, `..`, `.`,
    /// and paths that leave the vault through a symlink.
    fn resolve(&self, rel: &str) -> Result<PathBuf> {
        let rel_path = Path::new(rel);
        if rel.is_empty()
            || rel.contains('\\')
            || rel_path
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(VaultError::OutsideVault(rel.to_owned()));
        }
        let full = self.root.join(rel_path);
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

/// The chest folder a vault-relative path belongs to.
pub fn chest_of(rel: &str) -> &str {
    rel.split('/').next().unwrap_or("")
}

/// Fails unless `rel` lies inside `chest` (and is not the chest itself).
pub fn ensure_in_chest(rel: &str, chest: &str) -> Result<()> {
    match rel.strip_prefix(chest).and_then(|r| r.strip_prefix('/')) {
        Some(rest) if !rest.is_empty() => Ok(()),
        _ => Err(VaultError::OutsideChest(rel.to_owned())),
    }
}

fn check_name(name: &str) -> Result<()> {
    let bad = name.trim().is_empty()
        || name != name.trim()
        || name.starts_with('.')
        || name.contains(['/', '\\', '<', '>', ':', '"', '|', '?', '*'])
        || name.chars().any(char::is_control);
    if bad {
        Err(VaultError::InvalidName(name.to_owned()))
    } else {
        Ok(())
    }
}

fn file_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn write_new(path: &Path, content: &str) -> Result<()> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(fs::write(path, content)?)
}

fn walk(root: &Path, dir: &Path, f: &mut dyn FnMut(String, EntryKind)) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .expect("walk stays under root")
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        let ty = entry.file_type()?;
        if ty.is_dir() {
            f(rel, EntryKind::Dir);
            walk(root, &path, f)?;
        } else if ty.is_file() {
            let kind = if NoteFormat::from_path(&path).is_some() {
                EntryKind::Note
            } else {
                EntryKind::File
            };
            f(rel, kind);
        }
    }
    Ok(())
}

/// Today's date as YYYY-MM-DD (UTC), without a date library.
fn today() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    format!("{y:04}-{m:02}-{d:02}")
}

/// Howard Hinnant's days-to-civil algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

const AMBER_TYP: &str = r##"// Amber's Typst helpers. Templates import this file:
//
//   #import "/_shared/amber.typ": *
//   #show: amber
//
// It styles [[Wiki links]] in the preview and in PDFs. It is a plain file in
// your vault: edit it, or drop the two lines above from a note to turn the
// styling off there. In Typst notes, link to a heading as [[Note\#Heading]].

#let amber-link-color = rgb("#c96a0b")

#let amber(body) = {
  show regex("\[\[[^\[\]\n]+\]\]"): it => {
    let inner = it.text.slice(2, -2)
    let label = inner.split("|").last().split("#").first().trim()
    text(fill: amber-link-color, underline(offset: 2pt, stroke: 0.5pt + amber-link-color, label))
  }
  body
}
"##;

const TEMPLATE_TYP: &str = r#"#import "/_shared/amber.typ": *
#show: amber

= {{title}}

"#;

const TEMPLATE_MD: &str = "# {{title}}\n\n";

const WELCOME_NOTE: &str = r#"#import "/_shared/amber.typ": *
#show: amber

= Welcome to Amber

This chest is a plain folder, and this note is a plain `.typ` file.

- Link to another note with [[Second note]]. Cmd/Ctrl+click it to open it; it is created if it does not exist.
- Press Cmd/Ctrl+P to jump to a note, or Cmd/Ctrl+Shift+F to search this chest.
- Maths works out of the box: $e^(i pi) + 1 = 0$.
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::create(dir.path(), "MyVault").unwrap();
        (dir, v)
    }

    #[test]
    fn create_sets_up_vault_and_starter_chest() {
        let (_d, v) = vault();
        assert!(v.is_initialized());
        assert_eq!(v.display_name(), "MyVault");
        let chests = v.chests().unwrap();
        assert_eq!(chests.len(), 1);
        assert!(chests[0].is_chest);
        assert_eq!(chests[0].folder, "Notes");
        assert_eq!(v.notes_in("Notes").unwrap(), ["Notes/Welcome.typ"]);
        assert!(v.root().join("_shared/amber.typ").is_file());
    }

    #[test]
    fn plain_folders_are_offered_as_chests() {
        let (_d, v) = vault();
        fs::create_dir(v.root().join("drafts")).unwrap();
        fs::create_dir(v.root().join(".git")).unwrap();
        let chests = v.chests().unwrap();
        let names: Vec<_> = chests
            .iter()
            .map(|c| (c.folder.as_str(), c.is_chest))
            .collect();
        assert_eq!(names, [("Notes", true), ("drafts", false)]);
        assert!(v.make_chest("drafts").unwrap().is_chest);
    }

    #[test]
    fn tree_hides_chest_toml_and_dotfiles() {
        let (_d, v) = vault();
        v.create_folder("Notes/sub").unwrap();
        v.create_note("Notes/sub/a.md", "# A").unwrap();
        fs::write(v.root().join("Notes/sub/pic.png"), b"x").unwrap();
        fs::write(v.root().join("Notes/.hidden.typ"), "").unwrap();
        let tree: Vec<_> = v
            .tree("Notes")
            .unwrap()
            .into_iter()
            .map(|e| (e.path, e.kind))
            .collect();
        assert_eq!(
            tree,
            [
                ("Notes/Welcome.typ".into(), EntryKind::Note),
                ("Notes/sub".into(), EntryKind::Dir),
                ("Notes/sub/a.md".into(), EntryKind::Note),
                ("Notes/sub/pic.png".into(), EntryKind::File),
            ]
        );
    }

    #[test]
    fn reads_and_writes_inside_the_vault() {
        let (_d, v) = vault();
        v.write_note("Notes/new/c.typ", "hello").unwrap();
        assert_eq!(v.read_note("Notes/new/c.typ").unwrap(), "hello");
        v.write_note("Notes/new/c.typ", "again").unwrap();
        assert_eq!(v.read_note("Notes/new/c.typ").unwrap(), "again");
        let leftovers: Vec<_> = fs::read_dir(v.root().join("Notes/new")).unwrap().collect();
        assert_eq!(leftovers.len(), 1);
    }

    #[test]
    fn create_and_rename_never_overwrite() {
        let (_d, v) = vault();
        v.create_note("Notes/a.typ", "a").unwrap();
        assert!(matches!(
            v.create_note("Notes/a.typ", "b"),
            Err(VaultError::Exists(_))
        ));
        assert!(matches!(
            v.rename("Notes/a.typ", "Notes/Welcome.typ"),
            Err(VaultError::Exists(_))
        ));
        v.rename("Notes/a.typ", "Notes/moved/b.typ").unwrap();
        assert_eq!(v.read_note("Notes/moved/b.typ").unwrap(), "a");
        // Case-only rename is allowed.
        v.rename("Notes/moved/b.typ", "Notes/moved/B.typ").unwrap();
        assert_eq!(v.read_note("Notes/moved/B.typ").unwrap(), "a");
    }

    #[test]
    fn rejects_escapes_bad_names_and_non_notes() {
        let (_d, v) = vault();
        for bad in [
            "../x.typ",
            "/etc/x.typ",
            "Notes/../../x.typ",
            "",
            "./a.typ",
            "a\\..\\b.typ",
        ] {
            assert!(
                matches!(v.read_note(bad), Err(VaultError::OutsideVault(_))),
                "{bad}"
            );
        }
        assert!(matches!(
            v.read_note("Notes/chest.toml"),
            Err(VaultError::NotANote(_))
        ));
        for bad in ["", " x", "a:b", ".hidden", "_system"] {
            assert!(v.create_chest(bad).is_err(), "{bad}");
        }
        assert!(matches!(
            v.create_note("Notes/a?.typ", ""),
            Err(VaultError::InvalidName(_))
        ));
    }

    #[test]
    fn chest_scope_check() {
        assert!(ensure_in_chest("Notes/a.typ", "Notes").is_ok());
        assert!(ensure_in_chest("Notes", "Notes").is_err());
        assert!(ensure_in_chest("Notes2/a.typ", "Notes").is_err());
        assert!(ensure_in_chest("Other/a.typ", "Notes").is_err());
    }

    #[test]
    fn new_notes_use_templates() {
        let (_d, v) = vault();
        let typ = v.new_note_text("Notes/Idea.typ", None).unwrap();
        assert!(
            typ.contains("#show: amber") && typ.contains("= Idea"),
            "{typ}"
        );
        assert_eq!(
            v.new_note_text("Notes/x/Idea.md", None).unwrap(),
            "# Idea\n\n"
        );
        v.write_note("_shared/templates/daily.md", "# {{date}}\n")
            .unwrap();
        let daily = v
            .new_note_text("Notes/d.md", Some("_shared/templates/daily.md"))
            .unwrap();
        assert!(daily.starts_with("# 20") && daily.len() == 13, "{daily}");
        assert_eq!(v.templates().unwrap().len(), 3);
    }

    #[test]
    fn civil_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_771), (2026, 11, 14));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_out_of_the_vault() {
        let (_d, v) = vault();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.typ"), "s").unwrap();
        std::os::unix::fs::symlink(outside.path(), v.root().join("Notes/link")).unwrap();
        assert!(matches!(
            v.read_note("Notes/link/secret.typ"),
            Err(VaultError::OutsideVault(_))
        ));
    }
}
