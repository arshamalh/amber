//! `[[Wiki links]]`: parsing and resolution inside one chest.
//!
//! Syntax: `[[Target]]`, `[[Target|Label]]`, `[[Target#Heading]]`. In Typst
//! notes `#` starts code, so the heading form is written `[[Target\#Heading]]`.
//! Links inside code spans, fenced/raw blocks and comments are ignored.

use serde::Serialize;

use crate::vault::NoteFormat;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WikiLink {
    pub target: String,
    pub heading: Option<String>,
    pub label: Option<String>,
    /// Byte range of the whole `[[...]]` in the source.
    pub start: usize,
    pub end: usize,
}

pub fn parse(text: &str, format: NoteFormat) -> Vec<WikiLink> {
    let mut out = Vec::new();
    let mut fence: Option<&str> = None;
    let mut block_comment = false;
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let start_of_line = offset;
        offset += line.len();
        // Fenced code (Markdown) and raw blocks (Typst) both use ``` fences.
        if let Some(f) = fence {
            if trimmed.starts_with(f) {
                fence = None;
            }
            continue;
        }
        if trimmed.starts_with("```")
            || (format == NoteFormat::Markdown && trimmed.starts_with("~~~"))
        {
            fence = Some(&trimmed[..3]);
            continue;
        }
        scan_line(line, start_of_line, format, &mut block_comment, &mut out);
    }
    out
}

fn scan_line(
    line: &str,
    base: usize,
    format: NoteFormat,
    block_comment: &mut bool,
    out: &mut Vec<WikiLink>,
) {
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if format == NoteFormat::Typst {
            if *block_comment {
                if b[i..].starts_with(b"*/") {
                    *block_comment = false;
                    i += 2;
                } else {
                    i += 1;
                }
                continue;
            }
            if b[i..].starts_with(b"//") {
                return;
            }
            if b[i..].starts_with(b"/*") {
                *block_comment = true;
                i += 2;
                continue;
            }
            if b[i] == b'\\' {
                // Skip the escaped character, which may be multi-byte.
                i += 1 + line[i + 1..].chars().next().map_or(0, char::len_utf8);
                continue;
            }
        }
        if b[i] == b'`' {
            // Skip an inline code span / raw span.
            match line[i + 1..].find('`') {
                Some(close) => i += close + 2,
                None => return,
            }
            continue;
        }
        if b[i..].starts_with(b"[[") {
            if let Some(close) = line[i + 2..].find("]]") {
                let inner = &line[i + 2..i + 2 + close];
                if !inner.is_empty() && !inner.contains(['[', ']', '\n']) {
                    if let Some(link) = split_inner(inner, format) {
                        out.push(WikiLink {
                            start: base + i,
                            end: base + i + close + 4,
                            ..link
                        });
                    }
                    i += close + 4;
                    continue;
                }
            }
        }
        i += line[i..].chars().next().map_or(1, char::len_utf8);
    }
}

fn split_inner(inner: &str, format: NoteFormat) -> Option<WikiLink> {
    let (dest, label) = match inner.split_once('|') {
        Some((d, l)) => (d, Some(l.trim().to_owned()).filter(|l| !l.is_empty())),
        None => (inner, None),
    };
    let hash = if format == NoteFormat::Typst {
        "\\#"
    } else {
        "#"
    };
    let (target, heading) = match dest.split_once(hash) {
        Some((t, h)) => (t, Some(h.trim().to_owned()).filter(|h| !h.is_empty())),
        None => (dest, None),
    };
    let target = target.trim();
    if target.is_empty() {
        return None;
    }
    Some(WikiLink {
        target: target.to_owned(),
        heading,
        label,
        start: 0,
        end: 0,
    })
}

/// Resolves a link target to one of `notes` (vault-relative paths inside the
/// chest `chest`). Matching ignores case and the `.typ`/`.md` extension.
///
/// - `[[Name]]` matches any note named `Name`. Ties prefer the linking
///   note's folder, then the shortest path, then alphabetical order.
/// - `[[folder/Name]]` matches a note whose chest-relative path ends with it.
pub fn resolve<'a>(target: &str, from: &str, chest: &str, notes: &'a [String]) -> Option<&'a str> {
    let want = strip_ext(target.trim().trim_start_matches('/')).to_lowercase();
    if want.is_empty() {
        return None;
    }
    let from_dir = parent(from);
    let prefix = format!("{chest}/");
    notes
        .iter()
        .filter(|path| {
            let Some(rel) = path.strip_prefix(&prefix) else {
                return false;
            };
            let rel = strip_ext(rel).to_lowercase();
            if want.contains('/') {
                rel == want || rel.ends_with(&format!("/{want}"))
            } else {
                rel.rsplit('/').next() == Some(want.as_str())
            }
        })
        .min_by_key(|path| (parent(path) != from_dir, path.len(), path.as_str()))
        .map(String::as_str)
}

fn strip_ext(p: &str) -> &str {
    p.strip_suffix(".typ")
        .or_else(|| p.strip_suffix(".md"))
        .unwrap_or(p)
}

fn parent(p: &str) -> &str {
    p.rsplit_once('/').map_or("", |(d, _)| d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn targets(text: &str, f: NoteFormat) -> Vec<String> {
        parse(text, f).into_iter().map(|l| l.target).collect()
    }

    #[test]
    fn parses_forms() {
        let l = parse("a [[Note|Shown]] b [[Other#Part]]", NoteFormat::Markdown);
        assert_eq!(l[0].target, "Note");
        assert_eq!(l[0].label.as_deref(), Some("Shown"));
        assert_eq!(l[1].heading.as_deref(), Some("Part"));
        assert_eq!(
            &"a [[Note|Shown]] b"[l[0].start..l[0].end],
            "[[Note|Shown]]"
        );
    }

    #[test]
    fn typst_heading_uses_escaped_hash() {
        let l = parse(r"see [[Waves\#Speed]]", NoteFormat::Typst);
        assert_eq!(l[0].target, "Waves");
        assert_eq!(l[0].heading.as_deref(), Some("Speed"));
    }

    #[test]
    fn skips_code_comments_and_fences() {
        let md = "x [[A]] `[[B]]`\n```\n[[C]]\n```\n[[D]]\n";
        assert_eq!(targets(md, NoteFormat::Markdown), ["A", "D"]);
        let typ = "[[A]] // [[B]]\n/* [[C]]\n [[D]] */ [[E]]\n`[[F]]` \\[[G]]\n";
        assert_eq!(targets(typ, NoteFormat::Typst), ["A", "E"]);
    }

    #[test]
    fn byte_offsets_survive_unicode() {
        let text = "été [[Ünïcode]]";
        let l = &parse(text, NoteFormat::Markdown)[0];
        assert_eq!(&text[l.start..l.end], "[[Ünïcode]]");
    }

    #[test]
    fn ignores_empty_and_nested() {
        assert!(targets("[[]] [[ ]] [[a[b]]", NoteFormat::Markdown).is_empty());
    }

    #[test]
    fn resolves_within_chest() {
        let notes: Vec<String> = [
            "phys/waves.typ",
            "phys/old/Waves.md",
            "phys/optics/lens.typ",
            "other/waves.typ",
        ]
        .map(String::from)
        .to_vec();
        let r = |t, from| resolve(t, from, "phys", &notes);
        assert_eq!(r("Waves", "phys/a.typ"), Some("phys/waves.typ"));
        assert_eq!(r("waves", "phys/old/x.md"), Some("phys/old/Waves.md"));
        assert_eq!(r("old/waves", "phys/a.typ"), Some("phys/old/Waves.md"));
        assert_eq!(r("lens.typ", "phys/a.typ"), Some("phys/optics/lens.typ"));
        assert_eq!(r("missing", "phys/a.typ"), None);
        // Never resolves into another chest.
        assert_eq!(resolve("waves", "other/a.typ", "phys", &notes[2..]), None);
    }
}
