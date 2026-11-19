//! Renders small Typst fragments (maths, `#function(...)` blocks) to SVG for
//! the live-preview editor (ADR 0007).
//!
//! All fragments of a request are compiled in one Tinymist run, one page
//! each. If that fails (one broken fragment breaks the whole document), each
//! fragment is compiled on its own so the others still render.
//!
//! Work happens in a scratch folder in the app cache, never the vault: it
//! holds copies of `_shared/` and of the files the fragments reference, at
//! their vault-relative paths, so imports and image paths resolve as they
//! do in the note.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::vault::{Vault, SHARED_DIR};

/// Width of block fragments, close to the editor's text column.
const BLOCK_WIDTH_PT: u32 = 500;
/// 15px editor text = 11.25pt, so 1pt in the SVG = 4/3 px on screen.
const TEXT_SIZE_PT: f32 = 11.25;
/// Upper bound on fragments rendered one by one after a failed batch.
const MAX_SINGLE_RETRIES: usize = 60;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// Inline maths or an inline call: sized to its content.
    Inline,
    /// A display equation or a block-level call: the width of the column.
    Block,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Fragment {
    pub kind: Kind,
    /// Typst markup, e.g. `$x^2$` or `#figure(...)`.
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Rendered {
    pub svg: Option<String>,
    pub width_pt: f32,
    pub height_pt: f32,
    pub error: Option<String>,
}

pub struct Request<'a> {
    pub vault: &'a Vault,
    /// Vault-relative folder of the note (relative paths resolve from here).
    pub note_dir: &'a str,
    /// `#import`/`#set`/`#show`/`#let` lines from the note.
    pub preamble: &'a str,
    pub fragments: &'a [Fragment],
    /// Vault-relative files the fragments use (images, data).
    pub files: &'a [String],
    /// Scratch folder (in the app cache).
    pub workspace: &'a Path,
}

pub async fn render(req: Request<'_>) -> Result<Vec<Rendered>, String> {
    if req.fragments.is_empty() {
        return Ok(Vec::new());
    }
    prepare(&req).map_err(|e| format!("could not prepare render folder: {e}"))?;
    let main = req
        .workspace
        .join(req.note_dir)
        .join("__amber_render__.typ");
    let out_dir = req.workspace.join("__out__");

    // One run for everything.
    let source = document(req.preamble, req.fragments);
    if let Ok(pages) = run(req.workspace, &main, &out_dir, &source).await {
        if pages.len() == req.fragments.len() {
            return Ok(pages);
        }
    }
    // Isolate failures: one run per fragment.
    let mut results = Vec::with_capacity(req.fragments.len());
    for (i, frag) in req.fragments.iter().enumerate() {
        if i >= MAX_SINGLE_RETRIES {
            results.push(Rendered {
                error: Some("not rendered (too many fragments failed)".into()),
                ..Default::default()
            });
            continue;
        }
        let source = document(req.preamble, std::slice::from_ref(frag));
        results.push(match run(req.workspace, &main, &out_dir, &source).await {
            Ok(mut pages) if pages.len() == 1 => pages.remove(0),
            Ok(_) => Rendered {
                error: Some("the fragment produced more than one page".into()),
                ..Default::default()
            },
            Err(e) => Rendered {
                error: Some(e),
                ..Default::default()
            },
        });
    }
    Ok(results)
}

/// The Typst document: the note's preamble, then one page per fragment.
fn document(preamble: &str, fragments: &[Fragment]) -> String {
    let mut src = String::from(preamble);
    src.push_str(&format!(
        "\n#set text(size: {TEXT_SIZE_PT}pt)\n#set par(justify: false)\n"
    ));
    for f in fragments {
        let width = match f.kind {
            Kind::Inline => "auto".to_owned(),
            Kind::Block => format!("{BLOCK_WIDTH_PT}pt"),
        };
        src.push_str(&format!(
            "#page(width: {width}, height: auto, margin: (x: 1pt, y: 3pt), fill: none, \
             header: none, footer: none, numbering: none, background: none, foreground: none)[\n{}\n]\n",
            f.code
        ));
    }
    src
}

async fn run(
    root: &Path,
    main: &Path,
    out_dir: &Path,
    source: &str,
) -> Result<Vec<Rendered>, String> {
    let _ = fs::remove_dir_all(out_dir);
    fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    fs::write(main, source).map_err(|e| e.to_string())?;
    let pattern = out_dir.join("{0p}.svg");
    super::compile(root, main, &pattern, &["--ignore-system-fonts"])
        .await
        .map_err(|e| first_error(&e))?;
    let mut pages: Vec<PathBuf> = fs::read_dir(out_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "svg"))
        .collect();
    pages.sort();
    pages
        .iter()
        .map(|p| {
            let svg = fs::read_to_string(p).map_err(|e| e.to_string())?;
            let (width_pt, height_pt) = size_of(&svg);
            Ok(Rendered {
                svg: Some(svg),
                width_pt,
                height_pt,
                error: None,
            })
        })
        .collect()
}

/// Copies `_shared/` and the referenced files into the workspace.
fn prepare(req: &Request) -> std::io::Result<()> {
    fs::create_dir_all(req.workspace.join(req.note_dir))?;
    let shared = req.vault.root().join(SHARED_DIR);
    if shared.is_dir() {
        sync_dir(&shared, &req.workspace.join(SHARED_DIR))?;
    }
    for rel in req.files {
        // Only files inside the vault; anything else is ignored.
        let Ok(src) = req.vault.absolute(rel) else {
            continue;
        };
        if src.is_file() {
            copy_if_changed(&src, &req.workspace.join(rel))?;
        }
    }
    Ok(())
}

fn sync_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let ty = entry.file_type()?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            sync_dir(&entry.path(), &to)?;
        } else if ty.is_file() {
            copy_if_changed(&entry.path(), &to)?;
        }
    }
    Ok(())
}

fn copy_if_changed(src: &Path, dst: &Path) -> std::io::Result<()> {
    let (a, b) = (fs::metadata(src)?, fs::metadata(dst).ok());
    let same = b.is_some_and(|b| b.len() == a.len() && b.modified().ok() >= a.modified().ok());
    if !same {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(src, dst)?;
    }
    Ok(())
}

/// Reads `width="..pt" height="..pt"` from the root `<svg>` element.
fn size_of(svg: &str) -> (f32, f32) {
    let head = &svg[..svg.find('>').unwrap_or(svg.len())];
    let attr = |name: &str| {
        let key = format!("{name}=\"");
        let start = head.find(&key)? + key.len();
        let end = head[start..].find('"')? + start;
        head[start..end].trim_end_matches("pt").parse::<f32>().ok()
    };
    (attr("width").unwrap_or(0.0), attr("height").unwrap_or(0.0))
}

/// The first error message from compiler output, without paths and ANSI codes.
fn first_error(out: &str) -> String {
    let clean: String = strip_ansi(out);
    clean
        .lines()
        .map(str::trim)
        .find_map(|l| l.strip_prefix("error:").map(|m| m.trim().to_owned()))
        .unwrap_or_else(|| clean.lines().next().unwrap_or("render failed").to_owned())
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn reads_svg_size_and_errors() {
        assert_eq!(
            size_of(r#"<svg viewBox="0 0 1 2" width="104.5pt" height="39.75pt" xmlns="x">"#),
            (104.5, 39.75)
        );
        assert_eq!(
            first_error("\u{1b}[33mwarning\u{1b}[0m: noise\n\u{1b}[31merror\u{1b}[0m: unknown variable: foo\n  ┌─ x"),
            "unknown variable: foo"
        );
    }

    #[tokio::test]
    async fn renders_batches_and_isolates_failures() {
        let Some(bin) = tinymist() else {
            eprintln!("skipped: no Tinymist sidecar");
            return;
        };
        std::env::set_var("AMBER_TINYMIST", bin);
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::create(dir.path(), "V").unwrap();
        fs::create_dir_all(v.root().join("Notes/img")).unwrap();
        fs::write(v.root().join("Notes/img/dot.svg"), r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>"#).unwrap();
        let ws = dir.path().join("cache/render");
        let preamble = "#import \"/_shared/amber.typ\": *\n#show: amber\n#let twice(x) = x + x\n";
        let frags = vec![
            Fragment {
                kind: Kind::Inline,
                code: "$x^2$".into(),
            },
            Fragment {
                kind: Kind::Block,
                code: "$ sum_(i=1)^n i $".into(),
            },
            Fragment {
                kind: Kind::Block,
                code: "#figure(image(\"img/dot.svg\", width: 1cm), caption: [Dot #twice(1)])"
                    .into(),
            },
        ];
        let files = vec!["Notes/img/dot.svg".to_owned()];
        fn req<'a>(
            v: &'a Vault,
            p: &'a str,
            f: &'a [Fragment],
            files: &'a [String],
            ws: &'a Path,
        ) -> Request<'a> {
            Request {
                vault: v,
                note_dir: "Notes",
                preamble: p,
                fragments: f,
                files,
                workspace: ws,
            }
        }
        let ok = render(req(&v, preamble, &frags, &files, &ws))
            .await
            .unwrap();
        assert_eq!(ok.len(), 3);
        for r in &ok {
            assert!(
                r.svg.as_deref().is_some_and(|s| s.starts_with("<svg")),
                "{:?}",
                r.error
            );
            assert!(r.width_pt > 0.0 && r.height_pt > 0.0);
        }
        assert!(
            ok[0].width_pt < 50.0,
            "inline maths is narrow: {}",
            ok[0].width_pt
        );
        assert!((ok[1].width_pt - BLOCK_WIDTH_PT as f32).abs() < 1.0);

        // One broken fragment: the others still render.
        let mut broken = frags.clone();
        broken.insert(
            1,
            Fragment {
                kind: Kind::Inline,
                code: "#nope()".into(),
            },
        );
        let mixed = render(req(&v, preamble, &broken, &files, &ws))
            .await
            .unwrap();
        assert!(mixed[0].svg.is_some() && mixed[2].svg.is_some() && mixed[3].svg.is_some());
        assert!(
            mixed[1]
                .error
                .as_deref()
                .unwrap_or("")
                .contains("unknown variable"),
            "{:?}",
            mixed[1].error
        );
        // Nothing was written into the vault.
        assert!(!v.root().join("Notes/__amber_render__.typ").exists());
    }
}
