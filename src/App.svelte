<script lang="ts">
  import Editor from "./lib/Editor.svelte";
  import * as backend from "./lib/backend";
  import type { Note, VaultInfo } from "./lib/backend";
  import { Engine } from "./lib/engine";

  const SAVE_DELAY_MS = 400;
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  let vault = $state<VaultInfo | null>(null);
  let notes = $state<Note[]>([]);
  let current = $state<{ note: Note; text: string } | null>(null);
  let engine = $state.raw<Engine | null>(null);
  let engineStatus = $state<"stopped" | "starting" | "running" | "failed">("stopped");
  let previewUrl = $state<string | null>(null);
  let error = $state<string | null>(null);
  let newName = $state("");

  let pending: { path: string; text: string } | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  function fail(e: unknown) {
    error = e instanceof Error ? e.message : String(e);
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    const job = pending;
    pending = null;
    if (job) await backend.writeNote(job.path, job.text).catch(fail);
  }

  function onEdit(text: string) {
    if (!current) return;
    pending = { path: current.note.path, text };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
  }

  async function chooseVault() {
    const path = await backend.pickVault().catch(fail);
    if (path) await loadVault(path);
  }

  async function loadVault(path: string) {
    error = null;
    await flushSave();
    try {
      vault = await backend.openVault(path);
      notes = await backend.listNotes();
      current = null;
      previewUrl = null;
      await startEngine();
      const first = notes.find((n) => n.format === "typst") ?? notes[0];
      if (first) await openNote(first);
    } catch (e) {
      fail(e);
    }
  }

  async function startEngine() {
    if (!vault) return;
    engine = null;
    engineStatus = "starting";
    try {
      engine = await Engine.start(vault.rootUri, () => {
        engineStatus = "failed";
        engine = null;
        previewUrl = null;
      });
      engineStatus = "running";
    } catch (e) {
      engineStatus = "failed";
      fail(e);
    }
  }

  async function openNote(note: Note) {
    await flushSave();
    try {
      const text = await backend.readNote(note.path);
      current = { note, text };
      previewUrl = null;
      if (engine && note.format === "typst") {
        previewUrl = await engine.startPreview(note.enginePath, dark);
      } else {
        await engine?.stopPreview();
      }
    } catch (e) {
      fail(e);
    }
  }

  async function createNote(e: SubmitEvent) {
    e.preventDefault();
    let name = newName.trim();
    if (!name) return;
    if (!/\.(typ|md)$/.test(name)) name += ".typ";
    const title = name.replace(/^.*\//, "").replace(/\.(typ|md)$/, "");
    const body = name.endsWith(".md") ? `# ${title}\n\n` : `= ${title}\n\n`;
    try {
      await backend.writeNote(name, body);
      notes = await backend.listNotes();
      newName = "";
      const created = notes.find((n) => n.path === name);
      if (created) await openNote(created);
    } catch (err) {
      fail(err);
    }
  }

  // Save before the window closes.
  $effect(() => {
    const handler = () => void flushSave();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  });

  // Open the vault passed on the command line or in $AMBER_VAULT, if any.
  $effect(() => {
    backend.startupVault().then((path) => {
      if (path) void loadVault(path);
    }, fail);
  });
</script>

<div class="app">
  <header>
    <strong class="brand">Amber</strong>
    {#if vault}<span class="vault">{vault.name}</span>{/if}
    <button onclick={chooseVault}>{vault ? "Switch vault" : "Open vault"}</button>
    <span class="spacer"></span>
    {#if vault}
      <span class="status {engineStatus}" title="Typst engine (Tinymist)">
        Tinymist {engine?.version ?? ""} · {engineStatus}
      </span>
      {#if engineStatus === "failed"}<button onclick={startEngine}>Restart</button>{/if}
    {/if}
  </header>

  {#if error}
    <div class="error" role="alert">
      {error}
      <button onclick={() => (error = null)} aria-label="Dismiss">×</button>
    </div>
  {/if}

  {#if !vault}
    <main class="empty">
      <h1>Your notes belong to you.</h1>
      <p>Open a folder of <code>.typ</code> and <code>.md</code> files to start.</p>
      <button class="primary" onclick={chooseVault}>Open vault</button>
    </main>
  {:else}
    <main class="panes">
      <nav>
        <form onsubmit={createNote}>
          <input placeholder="New note (e.g. ideas.typ)" bind:value={newName} />
        </form>
        <ul>
          {#each notes as note (note.path)}
            <li>
              <button
                class:active={current?.note.path === note.path}
                onclick={() => openNote(note)}
                title={note.path}
              >
                <span class="fmt">{note.format === "typst" ? "T" : "M"}</span>
                {note.path}
              </button>
            </li>
          {:else}
            <li class="hint">No notes yet. Create one above.</li>
          {/each}
        </ul>
      </nav>

      <section class="editor-pane">
        {#if current}
          <!-- `current` is replaced only when another note opens, so the
               editor is rebuilt per note (and when the engine restarts). -->
          {#key `${current.note.path}:${engineStatus}`}
            <Editor
              note={current.note}
              text={current.text}
              client={engineStatus === "running" ? (engine?.client ?? null) : null}
              onchange={onEdit}
            />
          {/key}
        {:else}
          <p class="hint">Pick a note.</p>
        {/if}
      </section>

      <section class="preview-pane">
        {#if previewUrl}
          <iframe src={previewUrl} title="Preview"></iframe>
        {:else if current?.note.format === "markdown"}
          <p class="hint">Markdown preview arrives in Phase 1.</p>
        {:else}
          <p class="hint">Preview appears here.</p>
        {/if}
      </section>
    </main>
  {/if}
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: auto auto 1fr;
    height: 100vh;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--line);
  }
  .brand {
    color: var(--accent);
  }
  .vault {
    color: var(--muted);
  }
  .spacer {
    flex: 1;
  }
  .status {
    font-size: 12px;
    color: var(--muted);
  }
  .status.running {
    color: var(--ok);
  }
  .status.failed {
    color: var(--bad);
  }
  .error {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 14px;
    background: var(--bad-bg);
    color: var(--bad);
  }
  .empty {
    display: grid;
    place-content: center;
    text-align: center;
    gap: 8px;
  }
  .empty h1 {
    margin: 0;
    font-size: 28px;
  }
  .panes {
    display: grid;
    grid-template-columns: 240px 1fr 1fr;
    min-height: 0;
  }
  nav {
    border-right: 1px solid var(--line);
    overflow: auto;
    padding: 10px 8px;
  }
  nav input {
    width: 100%;
    box-sizing: border-box;
  }
  nav ul {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
  }
  nav li button {
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    padding: 5px 8px;
    border-radius: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  nav li button:hover {
    background: var(--hover);
  }
  nav li button.active {
    background: var(--accent-bg);
  }
  .fmt {
    display: inline-block;
    width: 1.4em;
    font-size: 11px;
    font-weight: 700;
    color: var(--accent);
  }
  .editor-pane {
    min-width: 0;
    min-height: 0;
    border-right: 1px solid var(--line);
  }
  .preview-pane {
    min-width: 0;
    min-height: 0;
    background: var(--preview-bg);
  }
  iframe {
    width: 100%;
    height: 100%;
    border: none;
  }
  .hint {
    color: var(--muted);
    padding: 16px;
    margin: 0;
  }
</style>
