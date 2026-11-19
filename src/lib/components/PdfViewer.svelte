<script lang="ts">
  // The in-app PDF viewer (PDF.js). Shows `app.pdf` in the side panel:
  // pages render lazily, text is selectable, and links to a page
  // (`[[paper.pdf#page=12]]`) scroll here.
  import { onDestroy, onMount } from "svelte";
  import { app } from "../app.svelte";
  import * as api from "../backend";
  import type { Backlink } from "../backend";
  import { loadPdfjs, PDF_DATA } from "../pdf";

  type Viewer = InstanceType<Awaited<ReturnType<typeof loadPdfjs>>["viewer"]["PDFViewer"]>;
  type Bus = InstanceType<Awaited<ReturnType<typeof loadPdfjs>>["viewer"]["EventBus"]>;
  type Doc = Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfjs>>["lib"]["getDocument"]>["promise"]>;

  let scroller: HTMLDivElement;
  let viewer: Viewer | null = null;
  let bus: Bus | null = null;
  let linkService: { setDocument(d: Doc | null): void } | null = null;
  let doc: Doc | null = null;
  let loadedKey = "";
  let ready = $state(false);

  let page = $state(1);
  let pages = $state(0);
  /** True once PDF.js has laid out the pages; setting a page earlier crashes it. */
  let pagesReady = $state(false);
  let pageInput = $state("1");
  let scale = $state(1);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let query = $state("");
  let matches = $state<{ current: number; total: number } | null>(null);
  let back = $state<Backlink[]>([]);
  let backOpen = $state(false);
  let searchInput: HTMLInputElement | undefined = $state();

  const lastPageKey = (path: string) => `amber:pdf-page:${app.vault?.root}:${path}`;

  onMount(async () => {
    try {
      const { viewer: v } = await loadPdfjs();
      bus = new v.EventBus();
      const links = new v.PDFLinkService({ eventBus: bus });
      const find = new v.PDFFindController({ eventBus: bus, linkService: links });
      viewer = new v.PDFViewer({
        container: scroller,
        eventBus: bus,
        linkService: links,
        findController: find,
        removePageBorders: false,
      });
      links.setViewer(viewer);
      linkService = links;
      bus.on("pagesinit", () => {
        if (!viewer) return;
        pagesReady = true;
        viewer.currentScaleValue = "page-width";
        goTo(wantedPage());
      });
      bus.on("pagechanging", (e: { pageNumber: number }) => {
        page = e.pageNumber;
        pageInput = String(e.pageNumber);
        if (app.pdf) try { localStorage.setItem(lastPageKey(app.pdf.path), String(e.pageNumber)); } catch { /* ignore */ }
      });
      bus.on("scalechanging", (e: { scale: number }) => (scale = e.scale));
      bus.on("updatefindmatchescount", (e: { matchesCount: { current: number; total: number } }) => (matches = e.matchesCount));
      bus.on("updatefindcontrolstate", (e: { matchesCount: { current: number; total: number } }) => (matches = e.matchesCount));
      ready = true;
    } catch (e) {
      error = `Could not start the PDF viewer: ${e instanceof Error ? e.message : e}`;
    }
  });

  onDestroy(() => {
    void doc?.destroy();
    doc = null;
  });

  /** The page a link asked for, else where the reader left off. */
  function wantedPage(): number {
    if (app.pdf?.page) return app.pdf.page;
    try {
      return Number(localStorage.getItem(lastPageKey(app.pdf?.path ?? ""))) || 1;
    } catch {
      return 1;
    }
  }

  function goTo(n: number) {
    if (!viewer || !pages || !pagesReady) return;
    viewer.currentPageNumber = Math.min(Math.max(1, Math.round(n)), pages);
  }

  // Load the document when the path changes (or the file changed on disk).
  $effect(() => {
    const pdf = app.pdf;
    if (!ready || !pdf) return;
    const key = `${pdf.path}:${pdf.reload}`;
    if (key === loadedKey) return;
    loadedKey = key;
    void load(pdf.path);
  });

  // Scroll to the page a followed link asks for.
  $effect(() => {
    const pdf = app.pdf;
    if (!pdf) return;
    void pdf.jump;
    if (pdf.page && pagesReady && `${pdf.path}:${pdf.reload}` === loadedKey) goTo(pdf.page);
  });

  async function load(path: string) {
    loading = true;
    error = null;
    matches = null;
    pagesReady = false;
    try {
      const { lib } = await loadPdfjs();
      const data = await api.readFile(path);
      const next = await lib.getDocument({ data: new Uint8Array(data), isEvalSupported: false, ...PDF_DATA }).promise;
      if (app.pdf?.path !== path) return void next.destroy();
      const old = doc;
      doc = next;
      pages = next.numPages;
      viewer!.setDocument(next);
      linkService!.setDocument(next);
      void old?.destroy();
    } catch (e) {
      error = `Could not open ${api.baseName(path)}: ${e instanceof Error ? e.message : e}`;
      pages = 0;
    } finally {
      loading = false;
    }
  }

  // Notes that link to this PDF.
  $effect(() => {
    const path = app.pdf?.path;
    void app.linksVersion;
    if (!path) return;
    void api.backlinks(path).then((b) => app.pdf?.path === path && (back = b), () => (back = []));
  });

  function zoom(factor: number) {
    if (viewer) viewer.currentScale = Math.min(5, Math.max(0.25, viewer.currentScale * factor));
  }

  function find(again = false, previous = false) {
    bus?.dispatch("find", {
      source: null,
      type: again ? "again" : "",
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
    if (!query) matches = null;
  }

  /** `[[paper.pdf#page=12]]` in the syntax of the open note. */
  function pageLink(): string {
    const path = app.pdf!.path;
    const name = api.baseName(path);
    const same = app.tree.filter((e) => api.baseName(e.path).toLowerCase() === name.toLowerCase()).length;
    const target = same > 1 && app.chest ? path.slice(app.chest.folder.length + 1) : name;
    const hash = app.note?.format === "markdown" ? "#" : "\\#";
    return `[[${target}${hash}page=${page}]]`;
  }

  async function copyLink() {
    const link = pageLink();
    try {
      await navigator.clipboard.writeText(link);
      app.toast(`Copied ${link}`);
    } catch {
      app.toast(`Copy this link: ${link}`);
    }
  }

  // External links in the PDF open in the browser, never inside Amber.
  function onclick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) {
      e.preventDefault();
      e.stopPropagation();
      void api.openExternal(href).catch(app.fail);
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      searchInput?.focus();
      searchInput?.select();
    }
  }

  const rel = (p: string) => p.slice((app.chest?.folder.length ?? 0) + 1);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pdf" {onkeydown}>
  <div class="toolbar">
    <button class="icon" onclick={() => goTo(page - 1)} disabled={page <= 1} title="Previous page" aria-label="Previous page">‹</button>
    <input
      class="page"
      bind:value={pageInput}
      onchange={() => goTo(Number(pageInput) || page)}
      onfocus={(e) => e.currentTarget.select()}
      aria-label="Page"
    />
    <span class="muted">/ {pages || "–"}</span>
    <button class="icon" onclick={() => goTo(page + 1)} disabled={page >= pages} title="Next page" aria-label="Next page">›</button>
    <span class="sep"></span>
    <button class="icon" onclick={() => zoom(1 / 1.2)} title="Zoom out" aria-label="Zoom out">−</button>
    <button class="zoom" onclick={() => viewer && (viewer.currentScaleValue = "page-width")} title="Fit width">
      {Math.round(scale * 100)}%
    </button>
    <button class="icon" onclick={() => zoom(1.2)} title="Zoom in" aria-label="Zoom in">+</button>
    <span class="sep"></span>
    <input
      class="search"
      type="search"
      placeholder="Find in PDF"
      bind:this={searchInput}
      bind:value={query}
      oninput={() => find()}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          find(true, e.shiftKey);
        }
      }}
      aria-label="Find in PDF"
    />
    {#if query && matches}
      <span class="muted count">{matches.total ? `${matches.current}/${matches.total}` : "none"}</span>
    {/if}
    <span class="spacer"></span>
    <button onclick={copyLink} disabled={!pages} title="Copy a [[link]] to this page, to paste into a note">Copy link</button>
    <div class="back-wrap">
      <button onclick={() => (backOpen = !backOpen)} title="Notes that link to this PDF" aria-expanded={backOpen}>
        Linked from {back.length}
      </button>
      {#if backOpen}
        <div class="back" role="menu">
          {#if !back.length}
            <p class="muted">No notes link here yet. Use <strong>Copy link</strong> and paste it into a note.</p>
          {/if}
          {#each back as b, i (b.path + i)}
            <button role="menuitem" onclick={() => { backOpen = false; void app.openNote(b.path); }}>
              <span class="title">{b.title} <span class="muted">{rel(b.path)}</span></span>
              <span class="context">{b.context}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#if error}
    <p class="message error">{error}</p>
  {:else if loading && !pages}
    <p class="message muted">Opening {api.baseName(app.pdf?.path ?? "")}…</p>
  {/if}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="body">
    <div class="scroller" bind:this={scroller} {onclick}>
      <div class="pdfViewer"></div>
    </div>
  </div>
</div>

<style>
  .pdf {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--line);
    font-size: 12px;
  }
  .toolbar button {
    border: none;
    background: none;
    padding: 3px 7px;
    border-radius: 5px;
    font-size: 12px;
  }
  .toolbar button:hover:not(:disabled) {
    background: var(--hover);
  }
  .toolbar button:disabled {
    color: var(--muted);
    cursor: default;
  }
  .icon {
    font-size: 15px !important;
    line-height: 1;
  }
  .zoom {
    min-width: 46px;
    font-variant-numeric: tabular-nums;
  }
  .page {
    width: 38px;
    padding: 2px 4px;
    text-align: right;
    font-size: 12px;
  }
  .search {
    width: 130px;
    padding: 2px 6px;
    font-size: 12px;
  }
  .count {
    font-variant-numeric: tabular-nums;
  }
  .sep {
    width: 1px;
    height: 16px;
    margin: 0 3px;
    background: var(--line);
  }
  .spacer {
    flex: 1;
  }
  .muted {
    color: var(--muted);
  }
  .back-wrap {
    position: relative;
  }
  .back {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 30;
    width: 320px;
    max-height: 50vh;
    overflow: auto;
    padding: 4px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
  }
  .back p {
    margin: 6px 8px;
  }
  .back button {
    display: grid;
    gap: 2px;
    width: 100%;
    text-align: left;
    padding: 6px 8px !important;
  }
  .back .context {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .message {
    margin: 12px;
    font-size: 13px;
  }
  .error {
    color: var(--bad);
  }
  .body {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  /* PDF.js needs an absolutely positioned scroll container. */
  .scroller {
    position: absolute;
    inset: 0;
    overflow: auto;
    background: color-mix(in srgb, var(--line) 45%, var(--bg));
  }
  .scroller :global(.pdfViewer) {
    padding: 8px 0;
  }
  .scroller :global(.pdfViewer .page) {
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.18);
  }
</style>
