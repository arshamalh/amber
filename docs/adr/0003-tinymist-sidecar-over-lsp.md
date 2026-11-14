# 0003. Tinymist as a pinned sidecar, reached only over LSP

Date: 2026-11-14 · Status: accepted

## Context

Amber needs Typst completion, diagnostics, formatting and a live preview. Tinymist provides all of these and is used by VS Code, Neovim and others. Its Rust crates are not a stable API, and its preview protocol can change between releases.

## Decision

- Bundle the Tinymist binary as a Tauri sidecar (`bundle.externalBin`). Pin the version in `src-tauri/tinymist.version`. `scripts/fetch-tinymist.mjs` downloads that release, checks its SHA-256 against the release's `sha256.sum`, and installs it as `src-tauri/binaries/tinymist-<target-triple>`. Binaries are not committed.
- The Rust module `src-tauri/src/typst/` is the only code that knows Tinymist exists. It spawns `tinymist lsp`, frames JSON-RPC messages, and streams them to the UI over a Tauri channel. Outgoing messages from the UI go through one command, in order.
- The UI uses `@codemirror/lsp-client` on that transport for completion, hover, signature help, diagnostics, formatting and rename.
- Live preview: the UI sends the `tinymist.doStartPreview` LSP command and shows the returned local server (`127.0.0.1:<port>`) in an iframe. The preview follows unsaved edits because Tinymist compiles from the LSP's in-memory documents.
- `$AMBER_TINYMIST` overrides the binary path for development.

## Alternatives

- **Embed Tinymist or Typst crates in-process:** fewer processes, but unstable APIs and a much larger rebuild on every upgrade.
- **Our own renderer with typst.ts:** full control over the preview, but a large project before Phase 1.
- **Ask users to install Tinymist:** breaks "works out of the box" and makes the version unpredictable.

## Consequences

- One extra process per open vault, killed when the app exits.
- Upgrading Tinymist is a one-line change plus a test of the preview arguments; the `tinymist.doStartPreview` arguments are the most likely thing to break.
- The preview iframe needs `frame-src http://127.0.0.1:*` in the CSP.
- A future mobile app can't run this binary. Only `src-tauri/src/typst/` and `src/lib/engine.ts` would need replacing.
