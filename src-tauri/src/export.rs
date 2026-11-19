//! PDF export. Typst notes compile directly. Markdown notes are converted to
//! Typst first (ADR 0006) in a temporary folder in the app cache, never in
//! the vault: the converted note plus copies of the files it needs, at the
//! same vault-relative paths, so `/_shared/...` and image paths resolve.

use std::fs;
use std::path::{Path, PathBuf};

use crate::md2typst::{self, MathMode};
use crate::typst;
use crate::vault::{NoteFormat, Vault, SHARED_DIR};

pub struct Exported {
    /// Things the PDF could not include, for the user to see.
    pub warnings: Vec<String>,
}

pub async fn export_pdf(
    vault: &Vault,
    note: &str,
    output: &Path,
    cache_dir: &Path,
) -> Result<Exported, String> {
    match NoteFormat::from_path(note) {
        Some(NoteFormat::Typst) => {
            let input = vault.absolute(note).map_err(|e| e.to_string())?;
            typst::export_pdf(vault.root(), &input, output).await?;
            Ok(Exported {
                warnings: Vec::new(),
            })
        }
        Some(NoteFormat::Markdown) => export_markdown(vault, note, output, cache_dir).await,
        None => Err(format!("not a note: {note}")),
    }
}

async fn export_markdown(
    vault: &Vault,
    note: &str,
    output: &Path,
    cache_dir: &Path,
) -> Result<Exported, String> {
    let text = vault.read_note(note).map_err(|e| e.to_string())?;
    let work = TempDir::new(cache_dir).map_err(|e| format!("could not prepare export: {e}"))?;
    let first = build(vault, note, &text, &work.0, MathMode::Mitex)?;
    let main = work.0.join("main.typ");
    match typst::export_pdf(&work.0, &main, output).await {
        Ok(()) => Ok(Exported {
            warnings: first.warnings,
        }),
        // mitex comes from the Typst package registry; offline on first use
        // it can't be fetched, so show the maths as LaTeX source instead.
        Err(_) if first.uses_math => {
            let second = build(vault, note, &text, &work.0, MathMode::Source)?;
            typst::export_pdf(&work.0, &main, output).await?;
            let mut warnings = second.warnings;
            warnings.push(
                "Maths is shown as LaTeX source: the mitex package could not be loaded (offline?)."
                    .into(),
            );
            Ok(Exported { warnings })
        }
        Err(e) => Err(e),
    }
}

/// Writes `main.typ` and copies the files it needs into `dir`.
fn build(
    vault: &Vault,
    note: &str,
    text: &str,
    dir: &Path,
    math: MathMode,
) -> Result<md2typst::Converted, String> {
    let exists = |p: &str| vault.absolute(p).is_ok_and(|a| a.is_file());
    let helpers = format!("{SHARED_DIR}/amber.typ");
    let note_dir = note.rsplit_once('/').map_or("", |(d, _)| d);
    let converted = md2typst::convert(
        text,
        &md2typst::Options {
            note_dir,
            amber_helpers: exists(&helpers),
            math,
            exists: &exists,
        },
    );
    let mut files = converted.images.clone();
    if exists(&helpers) {
        files.push(helpers);
    }
    for rel in &files {
        let src = vault.absolute(rel).map_err(|e| e.to_string())?;
        let dst = dir.join(rel);
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(&src, &dst).map_err(|e| format!("{rel}: {e}"))?;
    }
    fs::write(dir.join("main.typ"), &converted.source).map_err(|e| e.to_string())?;
    Ok(converted)
}

/// A temporary folder under the cache dir, removed on drop.
struct TempDir(PathBuf);

impl TempDir {
    fn new(cache_dir: &Path) -> std::io::Result<Self> {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = cache_dir
            .join("export")
            .join(format!("{}-{stamp}", std::process::id()));
        fs::create_dir_all(&dir)?;
        Ok(Self(dir))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The sidecar fetched by `npm run fetch-tinymist`, if present.
    fn tinymist() -> Option<PathBuf> {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
        fs::read_dir(dir)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .find(|p| {
                let name = p.file_name().unwrap_or_default().to_string_lossy();
                name.starts_with("tinymist-") && !name.ends_with(".version")
            })
    }

    #[tokio::test]
    async fn markdown_note_compiles_to_pdf() {
        let Some(bin) = tinymist() else {
            eprintln!("skipped: no Tinymist sidecar (run npm run fetch-tinymist)");
            return;
        };
        std::env::set_var("AMBER_TINYMIST", bin);
        let dir = tempfile::tempdir().unwrap();
        let v = crate::vault::test_vault(dir.path());
        fs::create_dir_all(v.root().join("Notes/img")).unwrap();
        fs::write(v.root().join("Notes/img/dot.png"), PNG).unwrap();
        v.write_note(
            "Notes/sub/all.md",
            "---\ntitle: t\n---\n# Everything\n\nText with *em*, **strong**, ~~gone~~, `co`de`` and a [link](https://typst.app).\n\
             Escapes: $5 #tag = a_b * [x] @me 3.14 // x <tag>\n\n\
             - [[Welcome]] and [[Welcome|label]]\n- [ ] todo\n  1. nested\n  2. list\n\n\
             > Quote with **bold**\n\n```python\nprint(\"`\")\n```\n\n\
             | L | R |\n|:--|--:|\n| 1 | 2 |\n\n![dot](../img/dot.png) ![missing](none.png)\n\n\
             Footnote[^a]. Maths $e^{i\\pi} + 1 = 0$ and\n\n$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$\n\n[^a]: Here.\n\n---\n\n<div>html</div>\n",
        )
        .unwrap();
        let out = dir.path().join("out.pdf");
        let cache = dir.path().join("cache");
        let result = export_pdf(&v, "Notes/sub/all.md", &out, &cache).await;
        let exported = result.unwrap_or_else(|e| panic!("export failed: {e}"));
        if let Ok(dest) = std::env::var("AMBER_DUMP_EXPORT") {
            // Debug aid: keep the PDF to look at.
            let _ = fs::copy(&out, format!("{dest}/all.pdf"));
        }
        assert!(fs::read(&out).unwrap().starts_with(b"%PDF"));
        assert!(exported
            .warnings
            .iter()
            .any(|w| w.contains("Missing image")));
        // The temporary folder is gone and nothing was added to the vault.
        assert!(fs::read_dir(cache.join("export")).unwrap().next().is_none());
        assert!(!v.root().join("Notes/sub/main.typ").exists());
    }

    #[tokio::test]
    async fn offline_maths_fallback_compiles() {
        let Some(bin) = tinymist() else { return };
        std::env::set_var("AMBER_TINYMIST", bin);
        let dir = tempfile::tempdir().unwrap();
        let v = crate::vault::test_vault(dir.path());
        let text = "Inline $a_1 + \\beta$ and\n\n$$\\sum_{i=1}^n i$$\n";
        let work = dir.path().join("work");
        fs::create_dir_all(&work).unwrap();
        let c = build(&v, "Notes/m.md", text, &work, MathMode::Source).unwrap();
        assert!(c.uses_math && !c.source.contains("mitex"), "{}", c.source);
        let out = dir.path().join("m.pdf");
        typst::export_pdf(&work, &work.join("main.typ"), &out)
            .await
            .unwrap();
        assert!(fs::read(&out).unwrap().starts_with(b"%PDF"));
        if let Ok(dest) = std::env::var("AMBER_DUMP_EXPORT") {
            // Debug aid: keep a rendered page to look at.
            let _ = fs::copy(work.join("main.typ"), format!("{dest}/fallback.typ"));
        }
    }

    /// A 1×1 PNG.
    const PNG: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
        0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8,
        0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92, 0xef, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];
}
