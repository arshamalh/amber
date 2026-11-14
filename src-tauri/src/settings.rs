//! App settings that belong to this device, not the vault (ADR 0002 and the
//! vault-vs-app rule in the plan): recent vaults and the last open chest.
//! Stored as JSON in the OS app-config folder.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const MAX_RECENT: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub recent_vaults: Vec<String>,
    /// Vault root → last open chest folder.
    pub last_chest: BTreeMap<String, String>,
    /// Open the most recent vault on launch instead of the start screen.
    pub reopen_last_vault: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            recent_vaults: Vec::new(),
            last_chest: BTreeMap::new(),
            reopen_last_vault: true,
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default())
    }

    pub fn touch_vault(&mut self, root: &str) {
        self.recent_vaults.retain(|r| r != root);
        self.recent_vaults.insert(0, root.to_owned());
        self.recent_vaults.truncate(MAX_RECENT);
    }

    pub fn forget_vault(&mut self, root: &str) {
        self.recent_vaults.retain(|r| r != root);
        self.last_chest.remove(root);
    }
}

pub fn path(config_dir: PathBuf) -> PathBuf {
    config_dir.join("settings.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_vaults_are_mru_and_capped() {
        let mut s = Settings::default();
        for i in 0..12 {
            s.touch_vault(&format!("/v{i}"));
        }
        s.touch_vault("/v5");
        assert_eq!(s.recent_vaults.len(), MAX_RECENT);
        assert_eq!(s.recent_vaults[0], "/v5");
        assert_eq!(s.recent_vaults.iter().filter(|v| *v == "/v5").count(), 1);
    }

    #[test]
    fn round_trips_and_tolerates_garbage() {
        let dir = tempfile::tempdir().unwrap();
        let p = path(dir.path().to_owned());
        assert!(Settings::load(&p).recent_vaults.is_empty());
        let mut s = Settings::default();
        s.touch_vault("/a");
        s.last_chest.insert("/a".into(), "Notes".into());
        s.save(&p).unwrap();
        assert_eq!(Settings::load(&p).last_chest["/a"], "Notes");
        assert!(Settings::load(&p).reopen_last_vault, "defaults on");
        fs::write(&p, "{not json").unwrap();
        assert!(Settings::load(&p).recent_vaults.is_empty());
    }
}
