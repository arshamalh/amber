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

/// One text replacement inside a note.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edit {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

/// The world before and after renaming notes, for rewriting links.
pub struct RenameMap<'a> {
    pub chest: &'a str,
    /// Old path → new path, for every renamed note.
    pub moves: &'a [(String, String)],
    /// Note paths after the rename.
    pub paths_new: &'a [String],
    /// The same notes with their paths before the rename.
    pub paths_old: Vec<String>,
}

impl<'a> RenameMap<'a> {
    pub fn new(chest: &'a str, moves: &'a [(String, String)], paths_new: &'a [String]) -> Self {
        let paths_old = paths_new
            .iter()
            .map(|p| {
                moves
                    .iter()
                    .find(|(_, new)| new == p)
                    .map_or_else(|| p.clone(), |(old, _)| old.clone())
            })
            .collect();
        Self {
            chest,
            moves,
            paths_new,
            paths_old,
        }
    }

    fn old_path_of(&self, new: &str) -> String {
        self.moves
            .iter()
            .find(|(_, n)| n == new)
            .map_or_else(|| new.to_owned(), |(o, _)| o.clone())
    }

    /// Edits for the note now at `path`, so links that pointed to a renamed
    /// note point to it again. Links that still resolve correctly (e.g. a
    /// note moved to another folder under the same name) are left alone.
    pub fn edits(&self, path: &str, text: &str, format: NoteFormat) -> Vec<Edit> {
        let from_old = self.old_path_of(path);
        let mut out = Vec::new();
        for link in parse(text, format) {
            let Some(old_target) = resolve(&link.target, &from_old, self.chest, &self.paths_old)
            else {
                continue;
            };
            let Some((_, new_target)) = self.moves.iter().find(|(o, _)| o == old_target) else {
                continue;
            };
            if resolve(&link.target, path, self.chest, self.paths_new) == Some(new_target.as_str())
            {
                continue;
            }
            let name = self.link_name(new_target, path);
            // Replace only the target part; keep `|label` and `#heading`.
            let inner = &text[link.start + 2..link.end - 2];
            let hash = if format == NoteFormat::Typst {
                "\\#"
            } else {
                "#"
            };
            let cut = [inner.find('|'), inner.find(hash)]
                .into_iter()
                .flatten()
                .min()
                .unwrap_or(inner.len());
            out.push(Edit {
                start: link.start,
                end: link.end,
                text: format!("[[{name}{}]]", &inner[cut..]),
            });
        }
        out
    }

    /// The shortest link text that resolves to `target` from `from`.
    fn link_name(&self, target: &str, from: &str) -> String {
        let file = target.rsplit('/').next().unwrap_or(target);
        let stem = strip_ext(file);
        if resolve(stem, from, self.chest, self.paths_new) == Some(target) {
            return stem.to_owned();
        }
        let rel = target
            .strip_prefix(&format!("{}/", self.chest))
            .unwrap_or(target);
        strip_ext(rel).to_owned()
    }
}

/// Applies non-overlapping edits to `text`.
pub fn apply(text: &str, edits: &[Edit]) -> String {
    let mut sorted: Vec<&Edit> = edits.iter().collect();
    sorted.sort_by_key(|e| e.start);
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    for e in sorted {
        out.push_str(&text[at..e.start]);
        out.push_str(&e.text);
        at = e.end;
    }
    out.push_str(&text[at..]);
    out
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

    fn moves(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect()
    }

    #[test]
    fn rename_rewrites_only_affected_links() {
        let paths: Vec<String> = ["c/New name.typ", "c/a.md", "c/other.typ"]
            .map(String::from)
            .to_vec();
        let m = moves(&[("c/waves.typ", "c/New name.typ")]);
        let map = RenameMap::new("c", &m, &paths);
        let text = "See [[waves]], [[Waves|the waves]], [[waves#Speed]] and [[other]].";
        let out = apply(text, &map.edits("c/a.md", text, NoteFormat::Markdown));
        assert_eq!(
            out,
            "See [[New name]], [[New name|the waves]], [[New name#Speed]] and [[other]]."
        );
        let typ = r"[[waves\#Speed|s]]";
        let out = apply(typ, &map.edits("c/other.typ", typ, NoteFormat::Typst));
        assert_eq!(out, r"[[New name\#Speed|s]]");
    }

    #[test]
    fn folder_move_keeps_name_links_and_fixes_path_links() {
        let paths: Vec<String> = ["c/new/waves.typ", "c/a.md"].map(String::from).to_vec();
        let m = moves(&[("c/old/waves.typ", "c/new/waves.typ")]);
        let map = RenameMap::new("c", &m, &paths);
        let text = "[[waves]] and [[old/waves]]";
        let out = apply(text, &map.edits("c/a.md", text, NoteFormat::Markdown));
        assert_eq!(out, "[[waves]] and [[waves]]");
    }

    #[test]
    fn ambiguous_names_get_a_path() {
        let paths: Vec<String> = ["c/x/note.md", "c/y/note.md", "c/a.md"]
            .map(String::from)
            .to_vec();
        let m = moves(&[("c/y/old.md", "c/y/note.md")]);
        let map = RenameMap::new("c", &m, &paths);
        let text = "[[old]]";
        assert_eq!(
            apply(text, &map.edits("c/a.md", text, NoteFormat::Markdown)),
            "[[y/note]]"
        );
    }

    #[test]
    fn renamed_note_links_from_itself() {
        // The renamed note links to a sibling it found by folder preference.
        let paths: Vec<String> = ["c/b/me2.md", "c/b/t.md", "c/t.md"]
            .map(String::from)
            .to_vec();
        let m = moves(&[("c/b/me.md", "c/b/me2.md")]);
        let map = RenameMap::new("c", &m, &paths);
        let text = "[[t]] [[me]]";
        assert_eq!(
            apply(text, &map.edits("c/b/me2.md", text, NoteFormat::Markdown)),
            "[[t]] [[me2]]"
        );
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
