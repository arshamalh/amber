# Amber — agent instructions

Amber is an open-source, local-first notes app (like Obsidian) built on Typst. Notes are plain `.typ` or `.md` files. A vault is divided into **chests**: first-level folders that the app opens in isolation.

The full plan, decisions and roadmap are in `docs/PLAN.md`. Read it before non-trivial work.

## Status

Current phase: **Phase 0 · Spike**. The skeleton exists: Tauri 2 + Rust core, Tinymist sidecar over LSP, CodeMirror with completion and diagnostics, live preview, ADRs, CI. Gate to Phase 1: edit a `.typ` note with completion and live preview.

## Layout

- `src-tauri/src/vault.rs`: all file access, confined to the vault root.
- `src-tauri/src/typst/`: the Typst engine adapter (spawns `tinymist lsp`, LSP framing). The only code that knows about Tinymist.
- `src-tauri/src/lib.rs`: Tauri commands. The UI calls these and nothing else.
- `src/lib/engine.ts`: LSP transport over Tauri IPC, `@codemirror/lsp-client`, preview start/stop.
- `src/App.svelte`, `src/lib/Editor.svelte`: the UI.
- `src-tauri/tinymist.version`: the pinned Tinymist release. `npm run fetch-tinymist` installs it.
- `docs/adr/`: decisions.

## Commands

- `npm install && npm run fetch-tinymist` once, then `npm run tauri dev`.
- `AMBER_VAULT=/path/to/vault npm run tauri dev` opens a vault on launch (a built binary also takes the path as its first argument).
- Checks: `npm run check`, and in `src-tauri/`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.
- Releases: `make release vX.Y.Z` (on a clean, up-to-date `main`) sets the version in all files, commits, tags and pushes. The tag runs `.github/workflows/release.yml`, which builds a draft GitHub release. CI on `main` and PRs runs checks only.

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
