# 0006. Markdown → PDF through Typst, and link updates after renames

Date: 2026-11-14 · Status: accepted

## Context

Markdown notes had no PDF export, and renaming a note left `[[links]]` to it broken. Two options for links were discussed: links that store a UUID, or readable links that Amber rewrites.

## Decision

**Markdown → PDF.** A Markdown note is parsed with comrak (the same options as the preview) and converted to Typst (`src-tauri/src/md2typst.rs`), then compiled with the bundled Tinymist.

- The conversion happens in a temporary folder in the app cache, holding `main.typ` plus copies of the files it uses (images, `_shared/amber.typ`) at their vault-relative paths. Nothing is written to the vault; the folder is deleted afterwards. (`tinymist compile` cannot read from stdin, and the entry file must be inside the Typst root.)
- `[[links]]` keep the vault's `_shared/amber.typ` styling, so both note types produce matching PDFs.
- LaTeX maths renders through the `@preview/mitex` package, pinned in `md2typst::MITEX`. Typst fetches it once and caches it. If it can't be loaded (offline on first use), the export retries with maths shown as LaTeX source and says so.
- Raw HTML is dropped, as in the preview. Missing images, web images and dropped HTML are reported to the user after export.

**Links after renames.** Links stay readable (`[[Name]]`). After a rename or folder move, Amber counts the links that pointed to the old note and no longer resolve to it, then asks "Update N links in M notes?". On yes it rewrites only the target part of each link, keeping `|label` and `#heading`. It re-reads each note from disk before writing (`links::RenameMap`). Links that still resolve, such as a note moved to another folder under the same name, are left alone. When a name becomes ambiguous, the chest-relative path is used.

## Alternatives

- **Markdown → PDF without Typst:** printing from the webview (system print dialog, little control over pages, output differs per OS), Pandoc (needs a LaTeX install), or a Rust PDF library (weak typography). Rejected: Typst is already bundled, gives the same look as Typst notes, and the chest-to-book export needs the same conversion for mixed chests.
- **UUID links:** survive any rename, but links become unreadable outside Amber, and the file-to-UUID map has no good home (cache: can be lost; hidden vault file: breaks "no hidden state"). Rejected in favour of readable links.

## Consequences

- Renames done outside Amber (Finder, `git mv`) are not detected yet. If that matters in practice, notes can carry their own id in the file (`id:` in Markdown frontmatter, `#metadata((id: "…")) <amber>` in Typst) so the watcher can pair a delete with a create. No separate map is needed.
- The first export with maths needs network access once; later exports work offline.
