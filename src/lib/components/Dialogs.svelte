<script lang="ts">
  import { app } from "../app.svelte";
  import { ui } from "../ui.svelte";
  import * as api from "../backend";
  import type { NoteFormat } from "../backend";
  import Modal from "./Modal.svelte";

  let error = $state<string | null>(null);
  let working = $state(false);

  // Form fields, reset whenever a dialog opens.
  let value = $state("");
  let format = $state<NoteFormat>("typst");
  let template = $state<string>("");
  let templates = $state<string[]>([]);
  let chestName = $state("");
  let parent = $state("");
  let gitInit = $state(false);
  let url = $state("");

  $effect(() => {
    const d = ui.dialog;
    error = null;
    working = false;
    if (!d) return;
    if (d.kind === "prompt") value = d.value;
    if (d.kind === "new-note") {
      value = "";
      format = app.chest?.defaultFormat ?? "typst";
      template = "";
      void api.templates().then((t) => (templates = t), () => (templates = []));
    }
    if (d.kind === "chest-settings" && app.chest) {
      chestName = app.chest.name;
      format = app.chest.defaultFormat;
      template = app.chest.template ?? "";
      void api.templates().then((t) => (templates = t), () => (templates = []));
    }
    if (d.kind === "create-vault") {
      value = "";
      parent = "";
      gitInit = false;
    }
    if (d.kind === "clone-vault") {
      url = "";
      parent = "";
    }
  });

  async function run(task: () => Promise<void>) {
    const opened = ui.dialog;
    working = true;
    error = null;
    try {
      await task();
      // The task may have opened a follow-up dialog; leave that one open.
      if (ui.dialog === opened) ui.close();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      working = false;
    }
  }

  function focusSelect(node: HTMLInputElement, stemOnly: boolean | undefined) {
    node.focus();
    const dot = node.value.lastIndexOf(".");
    if (stemOnly && dot > 0) node.setSelectionRange(node.value.lastIndexOf("/") + 1, dot);
    else node.select();
  }

  async function choose(set: (p: string) => void, title: string) {
    const p = await api.pickFolder(title).catch(app.fail);
    if (p) set(p);
  }

  const relDir = (dir: string | null) =>
    dir && app.chest && dir !== app.chest.folder ? dir.slice(app.chest.folder.length + 1) + "/" : "";
</script>

{#if ui.dialog}
  {@const d = ui.dialog}
  {#if d.kind === "prompt"}
    <Modal title={d.title} onclose={() => ui.close()}>
      <form onsubmit={(e) => { e.preventDefault(); void run(() => d.onsubmit(value.trim())); }}>
        <label>
          {d.label}
          <input bind:value use:focusSelect={d.selectStem} />
        </label>
        {#if error}<p class="error">{error}</p>{/if}
        <div class="actions">
          <button type="button" onclick={() => ui.close()}>Cancel</button>
          <button class="primary" disabled={working || !value.trim()}>{d.submit}</button>
        </div>
      </form>
    </Modal>
  {:else if d.kind === "confirm"}
    <Modal title={d.title} onclose={() => ui.close()}>
      <form onsubmit={(e) => { e.preventDefault(); void run(d.onsubmit); }}>
        <p>{d.text}</p>
        {#if error}<p class="error">{error}</p>{/if}
        <div class="actions">
          <button type="button" onclick={() => ui.close()}>{d.cancel ?? "Cancel"}</button>
          <!-- svelte-ignore a11y_autofocus -->
          <button class="primary" class:danger={d.danger} disabled={working} autofocus>{d.submit}</button>
        </div>
      </form>
    </Modal>
  {:else if d.kind === "settings"}
    <Modal title="Settings" onclose={() => ui.close()} width="520px">
      <div class="settings">
        {#if app.vault}
          <section>
            <h3>Vault</h3>
            <p class="value">{app.vault.name}</p>
            <p class="path">{app.vault.root}</p>
            <div class="buttons">
              <button onclick={() => void api.revealPath(app.vault!.root).catch(app.fail)}>Show in file manager</button>
              <button onclick={() => { ui.close(); void app.switchVault(); }}>Switch vault…</button>
            </div>
          </section>
        {/if}
        {#if app.chest}
          <section>
            <h3>Chest</h3>
            <p class="value">{app.chest.name}</p>
            <p class="path">{app.chest.folder}/chest.toml</p>
            <div class="buttons">
              <button onclick={() => ui.open({ kind: "chest-settings" })}>Chest settings…</button>
              <button onclick={() => { ui.close(); ui.palette = "chests"; }}>Switch chest…</button>
            </div>
          </section>
        {/if}
        <section>
          <h3>App</h3>
          <label class="check">
            <input
              type="checkbox"
              checked={app.info?.reopenLastVault ?? true}
              onchange={(e) => void app.setReopenLastVault(e.currentTarget.checked).catch(app.fail)}
            />
            Reopen the last vault when Amber starts
          </label>
          <p class="hint">
            Typst engine: Tinymist {app.info?.tinymistVersion} · {app.engineStatus}
            {#if app.vault?.initialized}
              · <button class="link" onclick={() => app.startEngine()}>Restart</button>
            {/if}
          </p>
          <p class="hint">Git: {app.info?.gitAvailable ? "found" : "not found (create and clone with git are off)"}</p>
        </section>
        <section>
          <h3>Keyboard</h3>
          <dl class="keys">
            <dt>⌘/Ctrl P</dt><dd>Go to note</dd>
            <dt>⌘/Ctrl ⇧ P</dt><dd>All commands</dd>
            <dt>⌘/Ctrl ⇧ F</dt><dd>Search this chest</dd>
            <dt>⌘/Ctrl ⇧ O</dt><dd>Switch chest</dd>
            <dt>⌘/Ctrl N</dt><dd>New note</dd>
            <dt>⌘/Ctrl E</dt><dd>Export PDF</dd>
            <dt>⌘/Ctrl ,</dt><dd>Settings</dd>
            <dt>⌘/Ctrl click</dt><dd>Follow a [[link]]</dd>
          </dl>
        </section>
      </div>
    </Modal>
  {:else if d.kind === "new-note" && app.chest}
    <Modal title="New note" onclose={() => ui.close()}>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void run(() => app.createNote(app.notePath(value, format, d.dir), template || null));
        }}
      >
        <label>
          Name
          <div class="with-prefix">
            {#if relDir(d.dir)}<span class="prefix">{relDir(d.dir)}</span>{/if}
            <input bind:value placeholder="Untitled" use:focusSelect={false} />
          </div>
        </label>
        <div class="row">
          <label>
            Format
            <select bind:value={format}>
              <option value="typst">Typst (.typ)</option>
              <option value="markdown">Markdown (.md)</option>
            </select>
          </label>
          <label>
            Template
            <select bind:value={template}>
              <option value="">Chest default</option>
              {#each templates.filter((t) => t.endsWith(format === "typst" ? ".typ" : ".md")) as t (t)}
                <option value={t}>{api.stem(t)}</option>
              {/each}
            </select>
          </label>
        </div>
        <p class="hint">Use slashes to create it in a subfolder, e.g. <code>lectures/week 1</code>.</p>
        {#if error}<p class="error">{error}</p>{/if}
        <div class="actions">
          <button type="button" onclick={() => ui.close()}>Cancel</button>
          <button class="primary" disabled={working || !value.trim()}>Create</button>
        </div>
      </form>
    </Modal>
  {:else if d.kind === "chest-settings" && app.chest}
    <Modal title="Chest settings" onclose={() => ui.close()}>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void run(() => app.updateChest({ name: chestName, defaultFormat: format, template: template || null }));
        }}
      >
        <label>
          Name
          <input bind:value={chestName} use:focusSelect={false} />
        </label>
        <label>
          Default format for new notes
          <select bind:value={format}>
            <option value="typst">Typst</option>
            <option value="markdown">Markdown</option>
          </select>
        </label>
        <label>
          Template for new notes
          <select bind:value={template}>
            <option value="">Shared default (_shared/templates/note.*)</option>
            {#each templates as t (t)}
              <option value={t}>{t}</option>
            {/each}
          </select>
        </label>
        <p class="hint">
          Saved to <code>{app.chest.folder}/chest.toml</code>. Comments and other settings in that file are kept.
        </p>
        {#if error}<p class="error">{error}</p>{/if}
        <div class="actions">
          <button type="button" onclick={() => ui.close()}>Cancel</button>
          <button class="primary" disabled={working || !chestName.trim()}>Save</button>
        </div>
      </form>
    </Modal>
  {:else if d.kind === "create-vault"}
    <Modal title="Create a vault" onclose={() => ui.close()}>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const root = await api.createVault(parent, value.trim(), gitInit);
            await app.openVault(root);
          });
        }}
      >
        <label>
          Name
          <input bind:value placeholder="My notes" use:focusSelect={false} />
        </label>
        <label>
          Location
          <div class="with-button">
            <input value={parent} readonly placeholder="Choose a folder…" />
            <button type="button" onclick={() => choose((p) => (parent = p), "Where to create the vault")}>
              Choose…
            </button>
          </div>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={gitInit} disabled={!app.info?.gitAvailable} />
          Track changes with git
          {#if !app.info?.gitAvailable}<span class="hint">(git not found)</span>{/if}
        </label>
        <p class="hint">Creates the folder with <code>amber.toml</code>, a <code>_shared/</code> folder for templates, and a first chest.</p>
        {#if error}<p class="error">{error}</p>{/if}
        <div class="actions">
          <button type="button" onclick={() => ui.close()}>Cancel</button>
          <button class="primary" disabled={working || !value.trim() || !parent}>Create</button>
        </div>
      </form>
    </Modal>
  {:else if d.kind === "clone-vault"}
    <Modal title="Clone a vault" onclose={() => ui.close()}>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const root = await api.cloneVault(url, parent);
            await app.openVault(root);
          });
        }}
      >
        <label>
          Repository URL
          <input bind:value={url} placeholder="git@github.com:you/notes.git" use:focusSelect={false} />
        </label>
        <label>
          Clone into
          <div class="with-button">
            <input value={parent} readonly placeholder="Choose a folder…" />
            <button type="button" onclick={() => choose((p) => (parent = p), "Where to clone the vault")}>
              Choose…
            </button>
          </div>
        </label>
        <p class="hint">Uses your system git and its saved credentials. If git asks for a password, clone once in a terminal first.</p>
        {#if working}<p class="hint">Cloning…</p>{/if}
        {#if error}<p class="error">{error}</p>{/if}
        <div class="actions">
          <button type="button" onclick={() => ui.close()}>Cancel</button>
          <button class="primary" disabled={working || !url.trim() || !parent}>Clone</button>
        </div>
      </form>
    </Modal>
  {/if}
{/if}

<style>
  .error {
    color: var(--bad);
    margin: 0;
    font-size: 13px;
    white-space: pre-wrap;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .with-prefix,
  .with-button {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .with-prefix input,
  .with-button input {
    flex: 1;
    min-width: 0;
  }
  .prefix {
    color: var(--muted);
    font-family: var(--mono);
    font-size: 12px;
    white-space: nowrap;
  }
  .settings {
    display: grid;
    gap: 18px;
  }
  .settings h3 {
    margin: 0 0 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .settings p {
    margin: 0 0 4px;
  }
  .value {
    font-weight: 600;
  }
  .path {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
  }
  .keys {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 14px;
    margin: 0;
    font-size: 13px;
  }
  .keys dt {
    font-family: var(--mono);
    color: var(--muted);
  }
  .keys dd {
    margin: 0;
  }
  button.danger {
    background: var(--bad);
    border-color: var(--bad);
  }
</style>
