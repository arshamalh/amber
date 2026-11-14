<script lang="ts">
  import { app } from "../app.svelte";
  import { ui } from "../ui.svelte";
  import * as api from "../backend";
  import * as actions from "../actions";

  const recents = $derived(app.info?.recentVaults ?? []);

  async function forget(path: string) {
    await api.forgetVault(path).catch(app.fail);
    app.info = await api.appInfo().catch(() => app.info);
  }
</script>

<main class="welcome">
  <div class="card">
    <h1>Amber</h1>
    <p class="tag">Your notes belong to you.</p>

    <div class="actions">
      <button class="primary" onclick={() => ui.open({ kind: "create-vault" })}>Create a vault</button>
      <button onclick={actions.openVault}>Open a folder…</button>
      <button onclick={() => ui.open({ kind: "clone-vault" })} disabled={!app.info?.gitAvailable} title={app.info?.gitAvailable ? "" : "git was not found on this computer"}>
        Clone with git…
      </button>
    </div>

    {#if recents.length}
      <h2>Recent vaults</h2>
      <ul>
        {#each recents as path (path)}
          <li>
            <button class="recent" onclick={() => app.openVault(path)}>
              <span class="name">{api.baseName(path.replaceAll("\\", "/"))}</span>
              <span class="path">{path}</span>
            </button>
            <button class="forget" onclick={() => forget(path)} title="Remove from this list" aria-label="Remove from recent vaults">×</button>
          </li>
        {/each}
      </ul>
    {/if}

    <p class="foot">
      <button class="link" onclick={() => ui.open({ kind: "settings" })}>Settings</button>
    </p>
    <p class="foot">
      A vault is a folder of plain <code>.typ</code> and <code>.md</code> files. Each first-level folder with a
      <code>chest.toml</code> is a chest: one per project, opened on its own.
    </p>
  </div>
</main>

<style>
  .welcome {
    display: grid;
    place-items: center;
    padding: 24px;
    overflow: auto;
  }
  .card {
    width: 520px;
    max-width: 100%;
  }
  h1 {
    margin: 0;
    font-size: 34px;
    color: var(--accent);
  }
  .tag {
    margin: 4px 0 22px;
    color: var(--muted);
    font-size: 16px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .actions .primary {
    padding: 6px 14px;
  }
  h2 {
    margin: 28px 0 8px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
  }
  .recent {
    flex: 1;
    display: grid;
    text-align: left;
    border: none;
    background: none;
    padding: 6px 8px;
    border-radius: 6px;
    min-width: 0;
  }
  .recent:hover {
    background: var(--hover);
  }
  .name {
    font-weight: 600;
  }
  .path {
    font-size: 12px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .forget {
    border: none;
    background: none;
    color: var(--muted);
    font-size: 16px;
    visibility: hidden;
  }
  li:hover .forget {
    visibility: visible;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
  }
  .foot {
    margin-top: 28px;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.5;
  }
</style>
