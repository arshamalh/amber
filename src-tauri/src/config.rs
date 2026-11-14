//! `amber.toml` (vault) and `chest.toml` (chest). Read with `toml` + serde,
//! written with `toml_edit` so the user's comments and layout survive.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::vault::NoteFormat;

pub const VAULT_FILE: &str = "amber.toml";
pub const CHEST_FILE: &str = "chest.toml";

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("{file}: {source}")]
    Parse {
        file: String,
        source: toml::de::Error,
    },
    #[error("{file}: {source}")]
    Edit {
        file: String,
        source: toml_edit::TomlError,
    },
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct VaultConfig {
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct ChestConfig {
    pub name: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub default_format: NoteFormat,
    /// Vault-relative path of the template for new notes.
    pub template: Option<String>,
}

impl Default for ChestConfig {
    fn default() -> Self {
        Self {
            name: None,
            icon: None,
            color: None,
            default_format: NoteFormat::Typst,
            template: None,
        }
    }
}

pub fn read<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> Result<T, ConfigError> {
    match fs::read_to_string(path) {
        Ok(text) => toml::from_str(&text).map_err(|source| ConfigError::Parse {
            file: path.display().to_string(),
            source,
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(e.into()),
    }
}

/// A value to write into a TOML file. `None` removes the key.
pub type Edit<'a> = (&'a str, Option<&'a str>);

/// Sets or removes top-level string keys, keeping everything else in the
/// file (comments, ordering, other tables) as it was.
pub fn edit(path: &Path, edits: &[Edit]) -> Result<(), ConfigError> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.into()),
    };
    let mut doc: toml_edit::DocumentMut = text.parse().map_err(|source| ConfigError::Edit {
        file: path.display().to_string(),
        source,
    })?;
    for (key, value) in edits {
        match value {
            Some(v) => {
                // Keep the existing decor (inline comment) when replacing.
                match doc.get_mut(key).and_then(|i| i.as_value_mut()) {
                    Some(existing) => {
                        let decor = existing.decor().clone();
                        *existing = toml_edit::Value::from(*v);
                        *existing.decor_mut() = decor;
                    }
                    None => {
                        doc.insert(key, toml_edit::value(*v));
                    }
                }
            }
            None => {
                doc.remove(key);
            }
        }
    }
    fs::write(path, doc.to_string())?;
    Ok(())
}

pub fn new_vault_toml(name: &str) -> String {
    format!(
        r#"# Amber vault settings. Settings here travel with the vault.
# Each first-level folder with a chest.toml is a chest.
name = {name}
"#,
        name = toml_edit::Value::from(name)
    )
}

pub fn new_chest_toml(name: &str, template: Option<&str>) -> String {
    let template = match template {
        Some(t) => format!("template = {}", toml_edit::Value::from(t)),
        None => "# template = \"_shared/templates/note.typ\"".to_owned(),
    };
    format!(
        r#"# Amber chest settings. Opening this chest scopes the file tree,
# search and [[links]] to this folder.
name = {name}
default_format = "typst"   # "typst" | "markdown"
{template}
"#,
        name = toml_edit::Value::from(name)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_chest_with_unknown_sections() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(CHEST_FILE);
        fs::write(
            &p,
            r#"
name = "Thesis"
default_format = "markdown"
[[views]]
name = "Drafts"
[book]
title = "QEC"
"#,
        )
        .unwrap();
        let c: ChestConfig = read(&p).unwrap();
        assert_eq!(c.name.as_deref(), Some("Thesis"));
        assert_eq!(c.default_format, NoteFormat::Markdown);
    }

    #[test]
    fn missing_file_reads_as_default() {
        let dir = tempfile::tempdir().unwrap();
        let c: ChestConfig = read(&dir.path().join(CHEST_FILE)).unwrap();
        assert_eq!(c.default_format, NoteFormat::Typst);
    }

    #[test]
    fn edit_keeps_comments_and_other_keys() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(CHEST_FILE);
        fs::write(
            &p,
            "# my chest\nname = \"Old\"   # shown in the picker\nicon = \"book\"\n\n[book]\ntitle = \"T\"\n",
        )
        .unwrap();
        edit(
            &p,
            &[
                ("name", Some("New")),
                ("icon", None),
                ("color", Some("amber")),
            ],
        )
        .unwrap();
        let text = fs::read_to_string(&p).unwrap();
        assert!(text.starts_with("# my chest\n"), "{text}");
        assert!(
            text.contains("name = \"New\"   # shown in the picker"),
            "{text}"
        );
        assert!(!text.contains("icon"), "{text}");
        assert!(text.contains("[book]\ntitle = \"T\""), "{text}");
        let c: ChestConfig = read(&p).unwrap();
        assert_eq!(c.color.as_deref(), Some("amber"));
    }

    #[test]
    fn generated_files_parse() {
        let v: VaultConfig = toml::from_str(&new_vault_toml("My \"Vault\"")).unwrap();
        assert_eq!(v.name.as_deref(), Some("My \"Vault\""));
        let c: ChestConfig =
            toml::from_str(&new_chest_toml("Notes", Some("_shared/t.typ"))).unwrap();
        assert_eq!(c.template.as_deref(), Some("_shared/t.typ"));
        let c: ChestConfig = toml::from_str(&new_chest_toml("Notes", None)).unwrap();
        assert!(c.template.is_none());
    }
}
