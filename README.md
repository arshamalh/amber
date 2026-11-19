# Amber

**Notes that belong to you, typeset with Typst.**

Amber is an open-source, local-first notes app for people who want real typesetting, not just Markdown. Every note is a plain `.typ` or `.md` file in a folder you choose. Every project lives in its own **chest**, so a large vault stays organized.

> **Status:** Phase 1 (MVP) in testing. Vaults and chests, Typst and Markdown notes with live preview, `[[links]]` and backlinks, search, templates and PDF export work today. Block toolbars, diagrams, books and Markdown export are still to come; see [`docs/PLAN.md`](docs/PLAN.md).

## Our promise

**Your notes belong to you.**

- **Plain files.** Notes are `.typ` or `.md` files you can open in any editor, today or in twenty years.
- **No hidden storage.** Settings live in readable TOML files next to your notes. The search index is a disposable cache outside your vault. Delete Amber and you lose nothing.
- **No ambiguous formatting.** Typst has one precise meaning for every piece of syntax, so a note looks the same in Amber, in the Typst CLI and in the exported PDF.
- **Offline, no account.** Amber works without a server, a login or a subscription.
- **Open source.** The code is public, and anyone can audit, fork or contribute.

## Features

- **Chests.** A vault is divided into chests: one per project, course or book. Open a chest and the file tree, search, links, tags and graph show only that chest. One vault is enough for everything you own.
- **Typst and Markdown.** Pick the format per note. Typst gives you real maths, layout and figures; Markdown stays available when you want it simple.
- **No Typst knowledge needed.** Toolbars and forms for headings, tables, images, maths, callouts and diagrams write the Typst for you. Power users can edit the source directly.
- **Live preview.** Powered by the [Tinymist](https://github.com/Myriad-Dreamin/tinymist) language server: completion, error checking and an incremental preview that jumps between source and output.
- **Wiki links and backlinks.** Write `[[Note]]` like in Obsidian. A small Amber Typst package renders the links in the preview and in PDFs.
- **Powerful diagrams.** Flowcharts, state machines and commutative diagrams with [fletcher](https://typst.app/universe/package/fletcher) and CeTZ, plus Mermaid through [merman](https://typst.app/universe/package/merman). Every diagram ends up in your PDF exactly as you see it.
- **Export.** Export a note as a PDF, a whole chest as a book (you map folders to chapters in `chest.toml`), or a note to Markdown for sharing elsewhere.
- **Optional git.** Turn on version history when you create a vault, or clone an existing vault from a remote.
- **Fast search.** Full-text search, scoped to the chest you have open.

## Why Amber

### Compared with Obsidian

| | Obsidian | Amber |
| --- | --- | --- |
| Source code | Closed source | Open source |
| Note format | Markdown with app-specific extensions | Typst or Markdown, one per note |
| Organization | One vault, or many separate vaults | One vault, isolated chests inside it |
| Maths and layout | Markdown + MathJax | Full typesetting with Typst |
| Diagrams | Mermaid in Markdown | Typst diagram packages, Mermaid included |
| PDF export | One note at a time | Notes, or a whole chest as a book |

Obsidian is excellent, but large vaults get messy: everything shares one tree, one search and one graph. The alternative, many separate vaults, scatters your notes across your disk. Chests keep everything in one vault and still isolate each project. And when you need a document rather than a note, Typst gets you there without leaving the app.

### Compared with Tolaria

[Tolaria](https://github.com/refactoringhq/tolaria) shares our values: files first, offline first, open source. We learned a lot from it. We differ in three places:

| | Tolaria | Amber |
| --- | --- | --- |
| Note format | Markdown with YAML frontmatter | Typst or Markdown |
| Structure | A flat vault; notes are grouped by a `type` field | Folders matter; chests isolate projects |
| Git | Every vault must be a git repository | Git is optional per vault |
| Interface | Sidebar always open | Chest picker and tree fold into a command palette |

If you live in Markdown and like type-based organization, Tolaria is a great choice. Amber is for people who think in projects and want real typesetting.

## Planned stack

Tauri 2 · Rust · Svelte 5 + TypeScript · CodeMirror 6 · Tinymist · Tantivy + SQLite · TOML config

Desktop first: Linux, macOS and Windows. An iPad app is planned separately later.

## Roadmap

1. **Spike:** prove the stack: Typst editing with completion and live preview.
2. **MVP:** vaults, chests, Markdown, links and backlinks, PDF export, optional git.
3. **Blocks:** toolbars and diagram blocks, so you don't need to know Typst.
4. **Books and v1.0:** chest-to-book export, Markdown export, a public release.
5. **Mobile:** a separately designed iPad app.

Parked for later: real-time collaboration, a hosted sync service, AI features, Markdown inside Typst, links between chests.

## Development

You need Rust (stable), Node.js 20+, and the [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
npm install
npm run fetch-tinymist   # downloads the pinned Tinymist and checks its SHA-256
npm run tauri dev        # or: AMBER_VAULT=/path/to/folder npm run tauri dev
```

Notes open in a writing view: markup is hidden until you put the cursor on it, and maths and blocks show their Typst output. Type `/` for blocks; press ⌘/Ctrl+Shift+T (or the Typst button) to see the plain source.

Shortcuts: ⌘/Ctrl+P go to note, ⌘/Ctrl+Shift+T show source, ⌘/Ctrl+Shift+P commands, ⌘/Ctrl+Shift+F search, ⌘/Ctrl+Shift+O switch chest, ⌘/Ctrl+N new note, ⌘/Ctrl+E export PDF, ⌘/Ctrl+, settings, ⌘/Ctrl+click a `[[link]]` to follow it.

Checks: `npm run check`, then in `src-tauri/`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`. Decisions are recorded in [`docs/adr/`](docs/adr/).

## Contributing

Amber is at the planning stage. Ideas and feedback are welcome in the issues. Read [`docs/PLAN.md`](docs/PLAN.md) and [`AGENTS.md`](AGENTS.md) first.

## License

AGPL-3.0 (proposed).
