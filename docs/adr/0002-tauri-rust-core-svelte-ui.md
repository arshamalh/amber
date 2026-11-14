# 0002. Tauri 2 with a Rust core and a Svelte 5 UI

Date: 2026-11-14 · Status: accepted

## Context

Amber is a desktop notes app for Linux, macOS and Windows. Typst and Tinymist are written in Rust. Notes are plain files, and the plan promises that nothing hidden is written into the vault.

## Decision

- **Shell:** Tauri 2.
- **Core:** Rust owns all file access, scoping, indexing and the Typst engine. The web UI calls Tauri commands and never reads or writes files itself. Every path from the UI is vault-relative and checked against the vault root (no `..`, no absolute paths, no symlinks out of the vault).
- **UI:** TypeScript and Svelte 5 with runes. CodeMirror 6 is the editor.
- **Tauri capabilities** stay minimal (`core:default`). The folder picker runs in Rust through `tauri-plugin-dialog`, so the UI gets no file-system or shell permissions.

## Alternatives

- **Electron:** heavier binaries and still needs a separate Tinymist process.
- **SolidJS:** comparable speed, but 2.0 is a release candidate with breaking changes from 1.x; see the comparison in `docs/PLAN.md`.
- **File logic in the webview:** slower indexing and no native git.

## Consequences

Two languages in one repo. Every new UI feature that touches data needs a Rust command, which is extra work but keeps the "files are the source of truth" rule enforceable in one place.
