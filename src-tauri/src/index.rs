//! The index of one open chest: note titles, the `[[link]]` graph for
//! backlinks, and a Tantivy full-text index. It lives in memory only and is
//! rebuilt from the files whenever a chest opens (see ADR 0004).

use std::collections::BTreeMap;

use serde::Serialize;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{Field, Schema, Value, STORED, STRING, TEXT};
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term};

use crate::links::{self, WikiLink};
use crate::vault::{NoteFormat, Vault};

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error("search index: {0}")]
    Tantivy(#[from] tantivy::TantivyError),
    #[error(transparent)]
    Vault(#[from] crate::vault::VaultError),
}

pub type Result<T> = std::result::Result<T, IndexError>;

struct NoteRecord {
    title: String,
    body: String,
    links: Vec<WikiLink>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteSummary {
    pub path: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    /// A plain-text excerpt around the first match.
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Backlink {
    pub path: String,
    pub title: String,
    /// The line containing the link, trimmed.
    pub context: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OutLink {
    pub target: String,
    pub resolved: Option<String>,
}

struct Fields {
    path: Field,
    title: Field,
    body: Field,
}

pub struct ChestIndex {
    chest: String,
    notes: BTreeMap<String, NoteRecord>,
    /// Sorted paths, kept in sync with `notes`, for link resolution.
    paths: Vec<String>,
    fields: Fields,
    index: Index,
    writer: IndexWriter,
    reader: IndexReader,
}

impl ChestIndex {
    pub fn build(vault: &Vault, chest: &str) -> Result<Self> {
        let mut schema = Schema::builder();
        let fields = Fields {
            path: schema.add_text_field("path", STRING | STORED),
            title: schema.add_text_field("title", TEXT | STORED),
            body: schema.add_text_field("body", TEXT),
        };
        let index = Index::create_in_ram(schema.build());
        let writer = index.writer_with_num_threads(1, 30_000_000)?;
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        let mut me = Self {
            chest: chest.to_owned(),
            notes: BTreeMap::new(),
            paths: Vec::new(),
            fields,
            index,
            writer,
            reader,
        };
        for path in vault.notes_in(chest)? {
            if let Ok(text) = vault.read_note(&path) {
                me.insert(&path, &text)?;
            }
        }
        me.commit()?;
        Ok(me)
    }

    pub fn chest(&self) -> &str {
        &self.chest
    }

    /// Adds or replaces one note.
    pub fn upsert(&mut self, path: &str, text: &str) -> Result<()> {
        self.insert(path, text)?;
        self.commit()
    }

    pub fn remove(&mut self, path: &str) -> Result<()> {
        if self.notes.remove(path).is_some() {
            self.paths.retain(|p| p != path);
            self.writer
                .delete_term(Term::from_field_text(self.fields.path, path));
            self.commit()?;
        }
        Ok(())
    }

    fn insert(&mut self, path: &str, text: &str) -> Result<()> {
        let format = NoteFormat::from_path(path).unwrap_or(NoteFormat::Typst);
        let record = NoteRecord {
            title: title_of(path, text, format),
            links: links::parse(text, format),
            body: text.to_owned(),
        };
        self.writer
            .delete_term(Term::from_field_text(self.fields.path, path));
        self.writer.add_document(doc!(
            self.fields.path => path,
            self.fields.title => record.title.clone(),
            self.fields.body => text,
        ))?;
        if self.notes.insert(path.to_owned(), record).is_none() {
            let at = self
                .paths
                .binary_search(&path.to_owned())
                .unwrap_or_else(|i| i);
            self.paths.insert(at, path.to_owned());
        }
        Ok(())
    }

    fn commit(&mut self) -> Result<()> {
        self.writer.commit()?;
        self.reader.reload()?;
        Ok(())
    }

    pub fn notes(&self) -> Vec<NoteSummary> {
        self.notes
            .iter()
            .map(|(path, r)| NoteSummary {
                path: path.clone(),
                title: r.title.clone(),
            })
            .collect()
    }

    /// Notes whose links would change after `moves` (old → new paths),
    /// with the number of links in each. Uses the indexed text.
    pub fn link_updates(&self, moves: &[(String, String)]) -> Vec<(String, usize)> {
        let map = links::RenameMap::new(&self.chest, moves, &self.paths);
        self.notes
            .iter()
            .filter_map(|(path, rec)| {
                let format = NoteFormat::from_path(path)?;
                let n = map.edits(path, &rec.body, format).len();
                (n > 0).then(|| (path.clone(), n))
            })
            .collect()
    }

    pub fn paths(&self) -> &[String] {
        &self.paths
    }

    pub fn resolve(&self, target: &str, from: &str) -> Option<String> {
        links::resolve(target, from, &self.chest, &self.paths).map(str::to_owned)
    }

    pub fn outgoing(&self, path: &str) -> Vec<OutLink> {
        let Some(rec) = self.notes.get(path) else {
            return Vec::new();
        };
        rec.links
            .iter()
            .map(|l| OutLink {
                target: l.target.clone(),
                resolved: self.resolve(&l.target, path),
            })
            .collect()
    }

    /// Notes that link to `path`, one entry per linking line.
    pub fn backlinks(&self, path: &str) -> Vec<Backlink> {
        let mut out = Vec::new();
        for (from, rec) in &self.notes {
            if from == path {
                continue;
            }
            let mut last_line = None;
            for l in &rec.links {
                if self.resolve(&l.target, from).as_deref() != Some(path) {
                    continue;
                }
                let line_start = rec.body[..l.start].rfind('\n').map_or(0, |i| i + 1);
                if last_line == Some(line_start) {
                    continue;
                }
                last_line = Some(line_start);
                let line_end = rec.body[l.end..]
                    .find('\n')
                    .map_or(rec.body.len(), |i| l.end + i);
                out.push(Backlink {
                    path: from.clone(),
                    title: rec.title.clone(),
                    context: shorten(rec.body[line_start..line_end].trim(), 200),
                });
            }
        }
        out
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let mut parser =
            QueryParser::for_index(&self.index, vec![self.fields.title, self.fields.body]);
        parser.set_conjunction_by_default();
        parser.set_field_boost(self.fields.title, 3.0);
        // Prefix matching so results appear while typing.
        parser.set_field_fuzzy(self.fields.title, true, 0, true);
        parser.set_field_fuzzy(self.fields.body, true, 0, true);
        let (parsed, _errors) = parser.parse_query_lenient(query);
        let searcher = self.reader.searcher();
        let words: Vec<String> = query
            .split_whitespace()
            .map(|w| {
                w.trim_matches(|c: char| !c.is_alphanumeric())
                    .to_lowercase()
            })
            .filter(|w| !w.is_empty())
            .collect();
        let mut hits = Vec::new();
        for (_score, addr) in
            searcher.search(&parsed, &TopDocs::with_limit(limit).order_by_score())?
        {
            let doc: TantivyDocument = searcher.doc(addr)?;
            let Some(path) = doc.get_first(self.fields.path).and_then(|v| v.as_str()) else {
                continue;
            };
            let Some(rec) = self.notes.get(path) else {
                continue;
            };
            hits.push(SearchHit {
                path: path.to_owned(),
                title: rec.title.clone(),
                snippet: snippet(&rec.body, &words),
            });
        }
        Ok(hits)
    }
}

/// First heading, else the file name without extension.
fn title_of(path: &str, text: &str, format: NoteFormat) -> String {
    let heading = text.lines().find_map(|line| {
        let line = line.trim_start();
        let rest = match format {
            NoteFormat::Typst => line.strip_prefix('=')?.trim_start_matches('='),
            NoteFormat::Markdown => line.strip_prefix('#')?.trim_start_matches('#'),
        };
        rest.starts_with(' ').then(|| rest.trim().to_owned())
    });
    heading.filter(|h| !h.is_empty()).unwrap_or_else(|| {
        let name = path.rsplit('/').next().unwrap_or(path);
        name.rsplit_once('.')
            .map_or(name, |(stem, _)| stem)
            .to_owned()
    })
}

fn snippet(body: &str, words: &[String]) -> String {
    let lower = body.to_lowercase();
    // Lowercasing can change byte lengths for some scripts; only use the
    // position when it is a valid boundary in the original text.
    let pos = words
        .iter()
        .filter_map(|w| lower.find(w.as_str()))
        .min()
        .filter(|&p| body.is_char_boundary(p))
        .unwrap_or(0);
    let mut start = pos.saturating_sub(60);
    while !body.is_char_boundary(start) {
        start -= 1;
    }
    let tail = &body[start..];
    let excerpt: String = tail.chars().take(180).collect();
    let mut out = excerpt.split_whitespace().collect::<Vec<_>>().join(" ");
    if start > 0 {
        out.insert_str(0, "… ");
    }
    if tail.chars().count() > 180 {
        out.push_str(" …");
    }
    out
}

fn shorten(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_owned()
    } else {
        s.chars().take(max).collect::<String>() + "…"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, Vault, ChestIndex) {
        let dir = tempfile::tempdir().unwrap();
        let v = crate::vault::test_vault(dir.path());
        v.write_note(
            "Notes/waves.typ",
            "= Wave Equation\n\nThe speed of light. See [[Optics]].\n",
        )
        .unwrap();
        v.write_note(
            "Notes/optics.md",
            "# Optics\n\nLenses bend light. Back to [[waves]] and [[Missing]].\n",
        )
        .unwrap();
        v.write_note("Notes/sub/lab.typ", "Lab notes about [[optics|lenses]].\n")
            .unwrap();
        v.create_chest("Other", crate::vault::NoteFormat::Typst)
            .unwrap();
        v.write_note("Other/optics.typ", "= Elsewhere\n[[waves]]\n")
            .unwrap();
        let idx = ChestIndex::build(&v, "Notes").unwrap();
        (dir, v, idx)
    }

    #[test]
    fn titles_and_scope() {
        let (_d, _v, idx) = setup();
        let notes = idx.notes();
        let titles: Vec<_> = notes
            .iter()
            .map(|n| (n.path.as_str(), n.title.as_str()))
            .collect();
        assert_eq!(
            titles,
            [
                ("Notes/Welcome.typ", "Welcome to Amber"),
                ("Notes/optics.md", "Optics"),
                ("Notes/sub/lab.typ", "lab"),
                ("Notes/waves.typ", "Wave Equation"),
            ]
        );
    }

    #[test]
    fn backlinks_and_outgoing() {
        let (_d, _v, idx) = setup();
        let back: Vec<_> = idx
            .backlinks("Notes/optics.md")
            .into_iter()
            .map(|b| b.path)
            .collect();
        assert_eq!(back, ["Notes/sub/lab.typ", "Notes/waves.typ"]);
        let ctx = &idx.backlinks("Notes/waves.typ")[0];
        assert_eq!(
            ctx.context,
            "Lenses bend light. Back to [[waves]] and [[Missing]]."
        );
        let out = idx.outgoing("Notes/optics.md");
        assert_eq!(out[0].resolved.as_deref(), Some("Notes/waves.typ"));
        assert_eq!(out[1].resolved, None);
    }

    #[test]
    fn search_ranks_and_prefixes() {
        let (_d, _v, mut idx) = setup();
        let hits = idx.search("light", 10).unwrap();
        assert_eq!(hits.len(), 2);
        let hits = idx.search("wav", 10).unwrap();
        assert_eq!(hits[0].path, "Notes/waves.typ");
        assert!(
            idx.search("elsewhere", 10).unwrap().is_empty(),
            "other chest leaked"
        );
        assert!(idx.search("((( \"", 10).is_ok());

        idx.upsert("Notes/new.md", "# Fresh\nquantum stuff")
            .unwrap();
        assert_eq!(idx.search("quantum", 10).unwrap()[0].title, "Fresh");
        idx.remove("Notes/new.md").unwrap();
        assert!(idx.search("quantum", 10).unwrap().is_empty());
    }

    #[test]
    fn link_updates_after_rename() {
        let (_d, v, _idx) = setup();
        v.rename("Notes/optics.md", "Notes/lenses.md").unwrap();
        let idx = ChestIndex::build(&v, "Notes").unwrap();
        let moves = vec![("Notes/optics.md".to_owned(), "Notes/lenses.md".to_owned())];
        let updates = idx.link_updates(&moves);
        assert_eq!(
            updates,
            [
                ("Notes/sub/lab.typ".to_owned(), 1),
                ("Notes/waves.typ".to_owned(), 1)
            ]
        );
    }

    #[test]
    fn snippets_are_centred_and_safe() {
        let body = format!("{}needle and more", "ü".repeat(100));
        let s = snippet(&body, &["needle".into()]);
        assert!(s.starts_with("… ") && s.contains("needle"), "{s}");
    }
}
