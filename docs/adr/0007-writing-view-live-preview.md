# 0007. Writing view: live preview over the source, with a "Show Typst" switch

Date: 2026-11-19 · Status: accepted. Supersedes the plan's editing model ("source editor + live preview + block toolbars").

## Context

Amber promises that people who don't know Typst can write styled notes. A source editor with a preview beside it asks them to read Typst. A true block editor (ProseMirror/Tiptap, as in Notion) would have to convert Typst into blocks and back. Typst is a programming language, so that conversion loses or reformats code, and it was the reason the plan rejected that design.

## Decision

- **The text stays the only source of truth.** The default *writing view* is CodeMirror with markup hidden away from the cursor, as Obsidian's live preview does:
  - `= Title` shows as a heading, `*bold*` bold, lists get bullets and numbers;
  - `[[Note|label]]` shows only its label;
  - leading `#import`/`#set`/`#show`/`#let` lines fold into a "Typst setup" chip;
  - maths and `#function(...)` calls show their Typst output.

  Wherever the cursor is, the source appears for editing. Display maths and block calls show a live render under the source while being edited.
- **"Show Typst" / "Show Markdown"** (⌘⇧T, a header toggle) turns the hiding off for the open note. It swaps one CodeMirror compartment: no conversion, and the document and undo history are untouched. The choice is remembered per note on this device (UI storage, not the vault).
- **Markdown notes** get the same treatment over `@lezer/markdown` (GFM): headings, emphasis, links, images from the vault, clickable to-do checkboxes, quotes, front matter folded into a "Properties" chip.
- **The `/` menu** inserts ~20 blocks (headings, lists, quote, callout, maths, code, table, image, link to note, footnote, divider, page break, outline) as plain Typst or Markdown, with snippet placeholders. Images outside the chest are copied into `<chest>/assets/`.
- **Parser:** `codemirror-lang-typst` (Apache-2.0). Its native Lezer parser for Typst 0.15 uses `typst-syntax`'s node names and needs no WASM. Its completion and linter are not used; Tinymist stays the single source for completion and diagnostics. The package's Typst version must follow Tinymist's.
- **Rendering fragments** (maths, calls): Rust batches them into one Typst document, one page each, and compiles to SVG with the bundled Tinymist (`--ignore-system-fonts`: about 25 ms for one fragment, about 40 ms for 30). On failure it compiles them one by one, so one broken fragment doesn't blank the rest. Fragments get the note's setup lines, except `#show: template` rules, which could add title pages. Work happens in a scratch folder in the app cache with copies of `_shared/` and the referenced files, never in the vault (ADR 0003 still holds: Typst runs only through Tinymist). The UI caches results by content hash.
- The Tinymist page preview becomes an optional **Page view**, closed by default. Its server only runs while it is open.

## Alternatives

- **ProseMirror/Tiptap block editor:** most Notion-like, but needs a lossy Typst ↔ blocks conversion; rejected again.
- **typst.ts (Typst compiled to WASM) in the webview for fragments:** no process per render, but a large download plus bundled fonts, and a second Typst version to keep in step with Tinymist.
- **Embedding the `typst` crate in the Rust core:** fastest, but breaks ADR 0003 and adds a large dependency.
- **Our own `typst-syntax` WASM build for the parser:** exact, but adds a wasm toolchain to every build; the Lezer port gives the same node names without it.

## Consequences

- Fragments render without system fonts, so text inside rendered blocks uses Typst's bundled fonts even if the note sets another font. The PDF and the page view use system fonts as before.
- Inline styling calls (`#strong[...]`, `#emph[...]`, `#footnote[...]` and similar) show as styled text. Other calls render as images until clicked.
- Diagrams (fletcher, Mermaid via merman), a visual diagram editor, forms for editing existing blocks, and saved views are the rest of Phase 2.
