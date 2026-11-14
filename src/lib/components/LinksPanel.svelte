<script lang="ts">
  import { app } from "../app.svelte";
  import * as api from "../backend";
  import type { Backlink, OutLink } from "../backend";

  let back = $state<Backlink[]>([]);
  let out = $state<OutLink[]>([]);

  $effect(() => {
    const path = app.note?.path;
    app.linksVersion;
    if (!path) {
      back = [];
      out = [];
      return;
    }
    void Promise.all([api.backlinks(path), api.outgoingLinks(path)]).then(
      ([b, o]) => {
        if (app.note?.path !== path) return;
        back = b;
        // One row per target.
        const seen = new Set<string>();
        out = o.filter((l) => !seen.has(l.target.toLowerCase()) && seen.add(l.target.toLowerCase()));
      },
      () => {},
    );
  });

  const rel = (p: string) => p.slice((app.chest?.folder.length ?? 0) + 1);
</script>

<div class="links">
  <section>
    <h3>Backlinks <span class="count">{back.length}</span></h3>
    {#if !back.length}
      <p class="hint">No notes in this chest link here yet.</p>
    {/if}
    <ul>
      {#each back as b, i (b.path + i)}
        <li>
          <button onclick={() => app.openNote(b.path)}>
            <span class="title">{b.title}</span>
            <span class="path">{rel(b.path)}</span>
            <span class="context">{b.context}</span>
          </button>
        </li>
      {/each}
    </ul>
  </section>
  <section>
    <h3>Links from this note <span class="count">{out.length}</span></h3>
    {#if !out.length}
      <p class="hint">Write <code>[[Note name]]</code> to link to another note.</p>
    {/if}
    <ul>
      {#each out as l (l.target)}
        <li>
          <button class:missing={!l.resolved} onclick={() => app.follow(l.target)} title={l.resolved ? rel(l.resolved) : "Not created yet. Click to create it."}>
            <span class="title">{l.target}</span>
            <span class="path">{l.resolved ? rel(l.resolved) : "not created yet"}</span>
          </button>
        </li>
      {/each}
    </ul>
  </section>
</div>

<style>
  .links {
    padding: 12px;
    display: grid;
    gap: 18px;
    overflow: auto;
    height: 100%;
    box-sizing: border-box;
    align-content: start;
  }
  h3 {
    margin: 0 0 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .count {
    font-weight: 400;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li button {
    display: grid;
    gap: 2px;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    border-radius: 6px;
    padding: 6px 8px;
  }
  li button:hover {
    background: var(--hover);
  }
  .title {
    font-weight: 600;
    color: var(--accent);
  }
  .missing .title {
    color: var(--muted);
    font-style: italic;
  }
  .path,
  .context {
    font-size: 12px;
    color: var(--muted);
  }
  .hint {
    color: var(--muted);
    margin: 0;
    font-size: 13px;
  }
</style>
