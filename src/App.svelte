<script lang="ts">
  import { app } from "./lib/app.svelte";
  import { ui } from "./lib/ui.svelte";
  import * as actions from "./lib/actions";
  import * as api from "./lib/backend";
  import { wikiLinks } from "./lib/wiki";
  import { livePreview } from "./lib/live";
  import { slashMenu } from "./lib/live/slash";
  import { pasteImages } from "./lib/paste";
  import Editor from "./lib/Editor.svelte";
  import Welcome from "./lib/components/Welcome.svelte";
  import FileTree from "./lib/components/FileTree.svelte";
  import SearchPanel from "./lib/components/SearchPanel.svelte";
  import LinksPanel from "./lib/components/LinksPanel.svelte";
  import PdfViewer from "./lib/components/PdfViewer.svelte";
  import MarkdownPreview from "./lib/components/MarkdownPreview.svelte";
  import CommandPalette from "./lib/components/CommandPalette.svelte";
  import Dialogs from "./lib/components/Dialogs.svelte";

  $effect(() => {
    app.boot().catch(app.fail);
  });

  // Save before the window closes.
  $effect(() => {
    const handler = () => void app.flushSave();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  });

  function onkeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    const hit = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (key === "s") return hit(() => void app.flushSave());
    if (key === "p" && e.shiftKey) return hit(() => (ui.palette = "commands"));
    if (key === "k" || (key === "p" && !e.shiftKey)) return hit(() => app.chest && (ui.palette = "notes"));
    if (key === "o" && e.shiftKey) return hit(() => app.vault?.initialized && (ui.palette = "chests"));
    if (key === "f" && e.shiftKey) return hit(() => app.chest && ui.showSearch());
    if (key === "n" && !e.shiftKey) return hit(() => actions.newNote());
    if (key === "e" && !e.shiftKey) return hit(() => void app.exportPdf());
    if (key === "\\") return hit(() => (ui.sidebarOpen = !ui.sidebarOpen));
    if (key === ",") return hit(() => ui.open({ kind: "settings" }));
    if (key === "t" && e.shiftKey) return hit(() => app.toggleSource());
  }

  // Built once per opened note (app.note is replaced on open, not on edits).
  const wiki = $derived(
    app.note && app.chest
      ? [
          wikiLinks({
            format: app.note.format,
            chest: app.chest.folder,
            notes: () => app.notes,
            pdfs: () => app.tree.filter((e) => e.kind === "file" && /\.pdf$/i.test(e.path)).map((e) => e.path),
            follow: (t) => void app.follow(t),
          }),
          slashMenu({
            format: app.note.format,
            pickImage: () => api.importAsset(app.note!.path).catch((e) => (app.fail(e), null)),
          }),
          pasteImages({
            format: app.note.format,
            save: (bytes, ext, stamp) => api.pasteAsset(app.note!.path, bytes, ext, stamp),
            fail: (e) => app.fail(e),
          }),
        ]
      : [],
  );

  const writing = $derived(
    app.note
      ? livePreview({
          format: app.note.format,
          notePath: app.note.path,
          follow: (t) => void app.follow(t),
          openUrl: (u) => void api.openExternal(u).catch(app.fail),
        })
      : [],
  );

  // Tinymist's page preview runs only while the page view is open.
  $effect(() => {
    void app.setPreviewWanted((ui.rightOpen && ui.rightTab === "preview") || app.rendered);
  });

  /** Drags a pane divider; the width is remembered on this device. */
  function resize(e: PointerEvent, pane: "sidebar" | "right") {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId); // keeps events while over the PDF or page view
    const startX = e.clientX;
    const start = pane === "sidebar" ? ui.sidebarWidth : (handle.parentElement?.offsetWidth ?? 400);
    const move = (m: PointerEvent) => {
      const dx = m.clientX - startX;
      if (pane === "sidebar") ui.sidebarWidth = Math.round(Math.min(520, Math.max(160, start + dx)));
      else ui.rightWidth = Math.round(Math.min(window.innerWidth - (ui.sidebarOpen ? ui.sidebarWidth : 0) - 300, Math.max(260, start - dx)));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      ui.saveWidths();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", up, { once: true });
  }

  let vaultMenu = $state(false);
  const otherRecents = $derived((app.info?.recentVaults ?? []).filter((p) => p !== app.vault?.root).slice(0, 6));

  function menu(fn: () => void) {
    vaultMenu = false;
    fn();
  }

  const noteTitle = $derived(app.note ? app.notes.find((n) => n.path === app.note!.path)?.title : null);
  const otherFolders = $derived(app.vault?.chests.filter((c) => !c.isChest) ?? []);
</script>

<svelte:window {onkeydown} onclick={() => (vaultMenu = false)} />

{#snippet renderedNote()}
  {#if app.note?.format === "markdown"}
    <MarkdownPreview />
  {:else if app.previewUrl}
    <iframe src={app.previewUrl} title="Rendered note"></iframe>
  {:else if app.note}
    <p class="hint pad">
      {app.engineStatus === "running" ? "Rendering…" : `Typst engine is ${app.engineStatus}.`}
    </p>
  {/if}
{/snippet}

<div class="app">
  {#if app.booting}
    <main class="center"><p class="hint">Opening…</p></main>
  {:else if !app.vault}
    <Welcome />
  {:else if !app.vault.initialized}
    <main class="center">
      <div class="card">
        <h2>{app.vault.name} is not a vault yet</h2>
        <p>
          Amber will add an <code>amber.toml</code> and a <code>_shared/</code> folder for templates. Your files are not
          changed.
        </p>
        <div class="row">
          <button class="primary" onclick={() => app.initVault()}>Make it a vault</button>
          <button onclick={() => app.closeVault()}>Back</button>
        </div>
      </div>
    </main>
  {:else}
    <header>
      <button
        class="ghost sidebar-toggle"
        class:on={ui.sidebarOpen}
        onclick={() => (ui.sidebarOpen = !ui.sidebarOpen)}
        title="{ui.sidebarOpen ? 'Hide' : 'Show'} sidebar (⌘\)"
        aria-label="Toggle sidebar"
        aria-pressed={ui.sidebarOpen}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" /><path d="M6 2.5v11" /></svg>
      </button>
      <div class="vault-wrap">
        <button
          class="crumb"
          onclick={(e) => { e.stopPropagation(); vaultMenu = !vaultMenu; }}
          title="Vault: switch, create, open"
          aria-haspopup="menu"
          aria-expanded={vaultMenu}
        >
          <span class="vault-name">{app.vault.name}</span>
          <span class="caret">▾</span>
        </button>
        {#if vaultMenu}
          <div class="menu" role="menu">
            {#if otherRecents.length}
              <p class="menu-label">Recent vaults</p>
              {#each otherRecents as path (path)}
                <button role="menuitem" onclick={() => menu(() => void app.openVault(path))} title={path}>
                  {api.baseName(path.replaceAll("\\", "/"))}
                </button>
              {/each}
              <hr />
            {/if}
            <button role="menuitem" onclick={() => menu(actions.openVault)}>Open a folder…</button>
            <button role="menuitem" onclick={() => menu(() => ui.open({ kind: "create-vault" }))}>Create a vault…</button>
            <button role="menuitem" disabled={!app.info?.gitAvailable} onclick={() => menu(() => ui.open({ kind: "clone-vault" }))}>Clone with git…</button>
            <hr />
            <button role="menuitem" onclick={() => menu(() => void api.revealPath(app.vault!.root).catch(app.fail))}>Show vault in file manager</button>
            <button role="menuitem" onclick={() => menu(() => void app.switchVault())}>Close vault</button>
          </div>
        {/if}
      </div>
      <span class="sep">/</span>
      <button class="crumb" onclick={() => (ui.palette = "chests")} title="Switch chest (⌘⇧O)">
        <strong>{app.chest?.name ?? "No chest"}</strong>
        <span class="caret">▾</span>
      </button>
      <span class="note-title" title={app.note?.path}>{noteTitle ?? ""}</span>
      <span class="spacer"></span>
      {#if app.busy}<span class="busy">{app.busy}</span>{/if}
      {#if app.updateStatus === "available" && app.update && app.info?.canSelfUpdate}
        <button class="ghost update" onclick={() => void app.installUpdate()} title="Download, install and restart">
          Update to {app.update.version}
        </button>
      {/if}
      {#if app.chest}
        <button class="ghost" onclick={() => (ui.palette = "notes")} title="Go to note (⌘P)">Go to…</button>
        <button class="ghost" onclick={() => ui.showSearch()} title="Search (⌘⇧F)">Search</button>
      {/if}
      {#if app.note}
        <div class="segmented" role="group" aria-label="View mode (⌘⇧T switches Writing and Source)">
          <button
            class:on={!app.rendered && !app.sourceMode}
            aria-pressed={!app.rendered && !app.sourceMode}
            onclick={() => app.setMode("writing")}
            title="Writing: formatted, markup hidden until you click into it (⌘⇧T)"
          >
            Writing
          </button>
          <button
            class:on={!app.rendered && app.sourceMode}
            aria-pressed={!app.rendered && app.sourceMode}
            onclick={() => app.setMode("source")}
            title="Source: the plain {app.note.format === 'typst' ? 'Typst' : 'Markdown'} text (⌘⇧T)"
          >
            Source
          </button>
          <button
            class:on={app.rendered}
            aria-pressed={app.rendered}
            onclick={() => app.setMode("rendered")}
            title="Rendered: the note as it prints, read-only"
          >
            Rendered
          </button>
        </div>
        <button class="ghost" onclick={() => app.exportPdf()} title="Export PDF (⌘E)">PDF</button>
      {/if}
      <button class="ghost" onclick={() => (ui.palette = "commands")} title="All commands (⌘⇧P)">⋯</button>
      <button class="ghost gear" onclick={() => ui.open({ kind: "settings" })} title="Settings (⌘,)" aria-label="Settings">⚙</button>
      <span class="engine {app.engineStatus}" title="Typst engine (Tinymist {app.info?.tinymistVersion}): {app.engineStatus}">●</span>
      {#if app.engineStatus === "failed"}
        <button class="ghost" onclick={() => app.startEngine()}>Restart engine</button>
      {/if}
    </header>

    {#if !app.chest}
      <main class="center">
        <div class="card">
          <h2>Pick a chest</h2>
          <p>A chest is a first-level folder of your vault. Opening it scopes the files, search and links to it.</p>
          <ul class="chests">
            {#each app.vault.chests.filter((c) => c.isChest) as c (c.folder)}
              <li><button onclick={() => app.openChest(c.folder)}>{c.name}</button></li>
            {/each}
          </ul>
          <div class="row">
            <button class="primary" onclick={actions.newChest}>New chest…</button>
            <button onclick={actions.openFolderAsChest}>Open folder as chest…</button>
          </div>
          {#if otherFolders.length}
            <p class="hint">These folders are not chests yet:</p>
            <ul class="chests">
              {#each otherFolders as c (c.folder)}
                <li>
                  <span>{c.folder}</span>
                  <button onclick={() => app.makeChest(c.folder).catch(app.fail)}>Make it a chest</button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </main>
    {:else}
      <main
        class="panes"
        style:grid-template-columns="{ui.sidebarOpen ? `${ui.sidebarWidth}px` : ''} minmax(0, 1fr) {ui.rightOpen ? (ui.rightWidth ? `${ui.rightWidth}px` : 'minmax(0, 1fr)') : ''}"
      >
        {#if ui.sidebarOpen}
          <aside class="sidebar">
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="resizer right" onpointerdown={(e) => resize(e, "sidebar")} title="Drag to resize"></div>
            <div class="tabs">
              <button class:on={ui.sidebar === "files"} onclick={() => (ui.sidebar = "files")}>Files</button>
              <button class:on={ui.sidebar === "search"} onclick={() => ui.showSearch()}>Search</button>
              <span class="spacer"></span>
              {#if ui.sidebar === "files"}
                <button class="icon" onclick={() => actions.newNote()} title="New note (⌘N)">+</button>
                <button class="icon" onclick={() => actions.newFolder()} title="New folder">⊞</button>
              {/if}
            </div>
            <div class="sidebar-body">
              {#if ui.sidebar === "files"}<FileTree />{:else}<SearchPanel />{/if}
            </div>
          </aside>
        {/if}

        <section class="editor-pane">
          {#if app.note && app.rendered}
            <div class="rendered-full">{@render renderedNote()}</div>
          {/if}
          {#if app.note}
            <!-- Hidden, not removed, in Rendered mode: undo history and scroll survive. -->
            {#key `${app.note.path}:${app.editorKey}`}
              <div class="editor-host" class:hidden={app.rendered}><Editor
                note={{ ...app.note, text: app.liveText }}
                client={app.engineStatus === "running" ? (app.engine?.client ?? null) : null}
                extensions={wiki}
                {writing}
                source={app.sourceMode}
                onchange={app.onEdit}
              /></div>
            {/key}
          {:else}
            <div class="center">
              <div class="card">
                <p class="hint">No note open.</p>
                <div class="row">
                  <button class="primary" onclick={() => actions.newNote()}>New note</button>
                  <button onclick={() => (ui.palette = "notes")}>Go to note…</button>
                </div>
              </div>
            </div>
          {/if}
        </section>

        {#if ui.rightOpen}
          <section class="right-pane">
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="resizer left" onpointerdown={(e) => resize(e, "right")} title="Drag to resize"></div>
            <div class="tabs">
              <button class:on={ui.rightTab === "preview"} onclick={() => (ui.rightTab = "preview")}>Rendered</button>
              <button class:on={ui.rightTab === "links"} onclick={() => (ui.rightTab = "links")}>Links</button>
              {#if app.pdf}
                <button class="pdf-tab" class:on={ui.rightTab === "pdf"} onclick={() => (ui.rightTab = "pdf")} title={app.pdf.path}>
                  {api.baseName(app.pdf.path)}
                </button>
                <button class="icon" onclick={() => { app.pdf = null; if (ui.rightTab === "pdf") ui.rightTab = "links"; }} title="Close PDF" aria-label="Close PDF">×</button>
              {/if}
              <span class="spacer"></span>
              <button class="icon" onclick={() => (ui.rightOpen = false)} title="Hide panel">×</button>
            </div>
            <div class="right-body">
              {#if app.pdf}
                <!-- Kept alive while other tabs show, so the PDF stays where it was. -->
                <div class="pdf-host" class:hidden={ui.rightTab !== "pdf"}><PdfViewer /></div>
              {/if}
              {#if ui.rightTab === "pdf"}
                <!-- the PDF above -->
              {:else if ui.rightTab === "links"}
                <LinksPanel />
              {:else}
                {@render renderedNote()}
              {/if}
            </div>
          </section>
        {/if}
      </main>
    {/if}
  {/if}
</div>

<CommandPalette />
<Dialogs />

<div class="toasts" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <div class="toast {t.kind}">
      <span>{t.text}</span>
      {#if t.action}
        <button onclick={() => { t.action!.run(); app.dismiss(t.id); }}>{t.action.label}</button>
      {/if}
      <button class="x" onclick={() => app.dismiss(t.id)} aria-label="Dismiss">×</button>
    </div>
  {/each}
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100vh;
  }
  .app > :global(main:only-child) {
    grid-row: 1 / -1;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }
  .crumb {
    display: flex;
    align-items: baseline;
    gap: 6px;
    border: none;
    background: none;
    padding: 4px 8px;
    white-space: nowrap;
  }
  .crumb:hover {
    background: var(--hover);
  }
  .vault-wrap {
    position: relative;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 40;
    min-width: 220px;
    padding: 4px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
  }
  .menu button {
    display: block;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    padding: 6px 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .menu button:hover:not(:disabled) {
    background: var(--hover);
  }
  .menu button:disabled {
    color: var(--muted);
    cursor: default;
  }
  .menu-label {
    margin: 4px 10px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .menu hr {
    border: none;
    border-top: 1px solid var(--line);
    margin: 4px 0;
  }
  .gear {
    font-size: 15px;
  }
  .segmented {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    border-radius: 7px;
    background: var(--hover);
  }
  .segmented button {
    border: none;
    background: none;
    padding: 3px 10px;
    border-radius: 5px;
    color: var(--muted);
    font-size: 13px;
  }
  .segmented button.on {
    background: var(--bg);
    color: var(--fg);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
  }
  .update {
    color: var(--accent);
  }
  .toggle.on {
    color: var(--accent);
    border-color: var(--accent-bg);
    background: var(--accent-bg);
  }
  .vault-name,
  .sep,
  .caret {
    color: var(--muted);
  }
  .note-title {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .spacer {
    flex: 1;
  }
  .ghost {
    border-color: transparent;
    background: none;
    color: var(--muted);
  }
  .ghost:hover {
    color: var(--fg);
  }
  .busy {
    font-size: 12px;
    color: var(--muted);
  }
  .engine {
    font-size: 10px;
    color: var(--muted);
    padding: 0 4px;
  }
  .engine.running {
    color: var(--ok);
  }
  .engine.starting {
    color: var(--accent);
  }
  .engine.failed {
    color: var(--bad);
  }
  .panes {
    display: grid;
    min-height: 0;
  }
  .sidebar {
    position: relative;
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 0;
    min-width: 0;
    border-right: 1px solid var(--line);
  }
  /* Pane dividers: a wide, invisible grab area over the border line. */
  .resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 7px;
    z-index: 5;
    cursor: col-resize;
    touch-action: none;
  }
  .resizer.right {
    right: -4px;
  }
  .resizer.left {
    left: -4px;
  }
  .resizer:hover,
  .resizer:active {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .sidebar-toggle {
    display: grid;
    place-items: center;
    padding: 4px 6px;
  }
  .sidebar-toggle svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
  }
  .sidebar-body {
    overflow: auto;
    padding: 6px;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 6px 0;
  }
  .tabs button {
    border: none;
    background: none;
    color: var(--muted);
    padding: 4px 8px;
  }
  .tabs button.on {
    color: var(--fg);
    background: var(--hover);
  }
  .tabs .icon {
    font-size: 15px;
    line-height: 1;
  }
  .editor-pane {
    min-width: 0;
    min-height: 0;
  }
  .editor-host {
    height: 100%;
  }
  .editor-host.hidden {
    display: none;
  }
  .rendered-full {
    height: 100%;
    overflow: auto;
    background: var(--preview-bg);
  }
  .right-pane {
    position: relative;
    display: grid;
    grid-template-rows: auto 1fr;
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--line);
  }
  .right-body {
    position: relative;
    min-height: 0;
    background: var(--preview-bg);
  }
  .pdf-host {
    position: absolute;
    inset: 0;
    background: var(--bg);
  }
  /* Hidden, not removed: the PDF keeps its place while another tab shows. */
  .pdf-host.hidden {
    visibility: hidden;
    pointer-events: none;
  }
  .tabs .pdf-tab {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }
  .center {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 24px;
    box-sizing: border-box;
    overflow: auto;
  }
  .card {
    max-width: 460px;
  }
  .card h2 {
    margin: 0 0 8px;
  }
  .card p {
    color: var(--muted);
    line-height: 1.5;
  }
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .chests {
    list-style: none;
    padding: 0;
    margin: 12px 0;
    display: grid;
    gap: 4px;
  }
  .chests li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .chests li > button:only-child {
    width: 100%;
    text-align: left;
  }
  .hint {
    color: var(--muted);
  }
  .pad {
    padding: 16px;
    margin: 0;
  }
  .toasts {
    position: fixed;
    right: 16px;
    bottom: 16px;
    display: grid;
    gap: 8px;
    z-index: 70;
    max-width: min(420px, calc(100vw - 32px));
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--bg);
    border: 1px solid var(--line);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
    font-size: 13px;
  }
  .toast.error {
    border-color: var(--bad);
    color: var(--bad);
  }
  .toast span {
    flex: 1;
    white-space: pre-wrap;
  }
  .toast .x {
    border: none;
    background: none;
    color: var(--muted);
  }
</style>
