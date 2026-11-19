# Amber — agent instructions

Amber is an open-source, local-first notes app (like Obsidian) built on Typst. Notes are plain `.typ` or `.md` files. A vault is divided into **chests**: first-level folders that the app opens in isolation.

The full plan, decisions and roadmap are in `docs/PLAN.md`. Read it before non-trivial work.

## Status

Current phase: **Phase 1 · MVP**. Built: vaults (create with optional git, clone, open, init), chests with `chest.toml`, a chest-scoped file tree, Markdown notes with a preview, `[[links]]` with completion and backlinks, chest-scoped search, templates, PDF export of Typst notes, a command palette. Gate to Phase 2: the owner uses Amber daily for one real chest.

Also built: PDF export for Markdown notes through a Typst conversion, and "Update links?" after renames (ADR 0006); a vault menu and Settings (⌘,).

Phase 2 started (ADR 0007): the default **writing view** hides markup away from the cursor and shows maths and `#function(...)` blocks rendered by Typst; the header's **Writing | Source** switch (⌘⇧T) shows the plain source; a `/` menu inserts blocks. Each chest's `default_format` (chosen at creation, Typst by default, auto-detected for existing folders) sets the format of new notes (ADR 0008). The Tinymist page preview is an optional "Page" view. Still to do in Phase 2: forms for editing blocks, diagram blocks (fletcher, Mermaid), a visual diagram editor, saved views.

Known gaps: renames outside Amber are not detected (note ids are the planned fix); no Typst → Markdown export or format switch yet; links in the Tinymist page view are not clickable.

## Layout

Rust core (`src-tauri/src/`):

- `vault.rs`: all file access, confined to the vault root. Vault/chest creation, tree, note and folder operations, templates.
- `config.rs`: `amber.toml` / `chest.toml`, read with `toml`, written with `toml_edit` (comments survive).
- `links.rs`: `[[link]]` parsing and chest-scoped resolution.
- `index.rs`: the open chest's in-memory index (Tantivy in RAM + link graph). ADR 0004.
- `watcher.rs`: file watcher; external edits update the index and reach the UI as `vault-changed`.
- `typst/`: the Typst engine adapter (Tinymist LSP, PDF compile, `render.rs` for writing-view fragments). The only code that runs Tinymist.
- `export.rs`, `md2typst.rs`: PDF export; Markdown notes are converted to Typst in a temp folder in the app cache, never the vault.
- `git.rs`: system `git` for init and clone. `markdown.rs`: comrak rendering. `settings.rs`: per-device app settings (recent vaults), outside the vault.
- `commands.rs`: Tauri commands, the UI's only way in. Chest-scoped commands check paths against the open chest.

UI (`src/`):

- `lib/app.svelte.ts`: app state and flows (open vault/chest/note, autosave, external changes, links).
- `lib/ui.svelte.ts`: dialogs, palette, panels. `lib/actions.ts`: shared actions and the command list.
- `lib/engine.ts`: LSP transport over Tauri IPC, `@codemirror/lsp-client`, preview start/stop.
- `lib/wiki.ts`: `[[link]]` highlighting, Cmd/Ctrl+click, completion in CodeMirror.
- `lib/typst-lang.ts`: Typst language from `codemirror-lang-typst`'s Lezer parser (no completion/linter from it; Tinymist provides those).
- `lib/live/`: the writing view (ADR 0007). `typst.ts` / `markdown.ts` turn syntax trees into decorations (`context.ts` holds the builder), `widgets.ts`, `render.ts` (fragment cache, batched `render_fragments` calls), `slash.ts` (the `/` menu). Lezer nodes are fresh objects on every access: compare positions, never identity.
- `lib/components/`: Welcome, FileTree, SearchPanel, LinksPanel, MarkdownPreview, CommandPalette, Dialogs.

Other: `src-tauri/tinymist.version` (pinned Tinymist; `npm run fetch-tinymist` installs it), `docs/adr/` (decisions).

## Commands

- `npm install && npm run fetch-tinymist` once, then `npm run tauri dev`.
- `AMBER_VAULT=/path/to/vault npm run tauri dev` opens a vault on launch (a built binary also takes the path as its first argument).
- Checks: `npm run check`, and in `src-tauri/`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.
- Releases: `make release vX.Y.Z` (on a clean, up-to-date `main`) sets the version in all files, commits, tags and pushes. The tag runs `.github/workflows/release.yml`, which builds every platform with signed update files and publishes the release once all succeed; that delivers it to installed copies through the built-in updater (ADR 0009, `docs/RELEASING.md`). CI on `main` and PRs runs checks only.
- When asked to release: write `docs/releases/vX.Y.Z.md` first (user-facing, short, one line per change, each starting with an emoji; format in `docs/RELEASING.md`; base it on the commits since the last tag), then `make release vX.Y.Z`.
- Distribution is free by design: macOS builds are ad-hoc signed (no paid Developer ID), updates come from GitHub Releases. Never commit `~/.tauri/amber.key`.

## Stack (decided)

- Desktop shell: Tauri 2. Core logic in Rust; the UI never touches files directly.
- UI: TypeScript + Svelte 5 (runes). Not React. (ADR 0002)
- Editor: CodeMirror 6, talking to Tinymist over LSP.
- Typst: Tinymist as a bundled sidecar (`tinymist lsp`, preview). Pin its version and keep it behind one adapter. (ADR 0003)
- Search/index: Tantivy + SQLite in the app cache dir, never inside the vault.
- Config: TOML (`amber.toml` per vault, `chest.toml` per chest), edited with `toml_edit` so user comments survive.
- Mobile is out of scope for the desktop app. Don't add code paths or constraints for it.

## Rules

- **Files are the source of truth.** Never store user data or state in hidden files inside the vault. Anything rebuildable lives in the app cache.
- **One format per file.** No mixing Typst and Markdown inside one note.
- **Chests are isolated.** `[[Note]]` links resolve inside the current chest only.
- **Git is optional** per vault (a checkbox at creation, or clone from a remote). Never assume a vault is a git repo.
- Parked features (real-time collaboration, hosted sync, AI features, Markdown-in-Typst, cross-chest links) are not to be built until the plan says so.
- Record significant decisions as short ADRs in `docs/adr/NNNN-title.md` (context, decision, alternatives, consequences).

## Git

- Commit messages: no AI attribution. No `Co-Authored-By` or `Claude-Session` trailers.
- License: AGPL-3.0 (proposed). Tolaria (AGPL-3.0) may be used for ideas and, with attribution, code.
