# 0010. In-app PDF viewer and links to files

Date: 2026-11-19 · Status: accepted

## Context

Notes often cite papers and books kept as PDFs in the chest. Opening them in another app breaks the flow, and a link should be able to point to a page. Each platform's system web view handles PDFs differently: WebKit on macOS shows them, WebView2 on Windows uses Edge's viewer, and WebKitGTK on Linux shows nothing at all.

## Decision

- **PDF.js** (`pdfjs-dist` 4.x, Apache-2.0) with its viewer component renders PDFs in the side panel, next to the note, on every platform. It provides lazy page rendering, selectable text, search, zoom and in-PDF links. It is loaded on first use. Web links inside a PDF open in the browser. Its character maps and standard fonts are served from `/pdfjs/` (a small plugin in `vite.config.ts`).
- PDF bytes come through a `read_file` command (raw IPC response), scoped to the open chest. No extra file access or protocol is needed.
- **Links to files** use the existing syntax with the extension: `[[paper.pdf]]`, `[[paper.pdf#page=12]]` (`\#` in Typst notes, as for headings), the same as Obsidian. The chest index keeps every non-note file as a link target, so files resolve, get backlinks, and links follow renames ("Update links?"). `[[paper]]` without the extension still means a note.
- The viewer's **Copy link** button copies a link to the current page in the open note's syntax. The Writing view shows such a link as "paper.pdf, p. 12". So does `amber.typ` (for new vaults) in the page view and in PDF export, where it is styled text and not clickable, like note links.
- Clicking a link to any other kind of file only shows it in the file manager. Amber never opens or runs it, because vaults can come from other people.
- The viewer remembers the last page read per PDF on this device (localStorage, never the vault).

## Alternatives

- **System web view (`<iframe>`/`<embed>`):** no extra code, but broken on Linux and different on each platform, and Amber can't control the page.
- **Rendering pages in Rust (pdfium):** a large native dependency per platform for what PDF.js already does.
- **Annotations and highlights:** left out. They need a storage decision (inside the PDF or in a note) first.

## Consequences

- About 2 MB more in the app (library and worker) plus 2.4 MB of font and character-map data. None of it loads until a PDF is opened.
- PDF.js 4.x needs `Promise.withResolvers`, which is polyfilled for older system web views. Moving to 5.x needs a check of the oldest supported macOS and WebKitGTK.
- Existing vaults keep their `amber.typ`, so the page view shows a PDF link as `paper.pdf` without the page there unless the file is updated.
