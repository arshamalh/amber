<script lang="ts">
  import { app } from "../app.svelte";
  import { ui } from "../ui.svelte";
  import * as api from "../backend";
  import type { SearchHit } from "../backend";

  let query = $state("");
  let hits = $state<SearchHit[]>([]);
  let input: HTMLInputElement;
  let seq = 0;

  $effect(() => {
    if (ui.searchFocus) input?.focus();
  });

  $effect(() => {
    const q = query;
    app.linksVersion; // re-run after edits so results stay fresh
    const mine = ++seq;
    const t = setTimeout(async () => {
      const result = q.trim() ? await api.search(q).catch(() => []) : [];
      if (mine === seq) hits = result;
    }, 120);
    return () => clearTimeout(t);
  });

  const words = $derived(
    query
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter(Boolean),
  );

  /** Splits text into plain and matched parts for highlighting. */
  function parts(text: string): { text: string; hit: boolean }[] {
    if (!words.length) return [{ text, hit: false }];
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return text.split(re).map((t, i) => ({ text: t, hit: i % 2 === 1 }));
  }
</script>

<div class="search">
  <input bind:this={input} bind:value={query} placeholder="Search this chest" type="search" />
  {#if query.trim() && !hits.length}
    <p class="hint">No matches.</p>
  {/if}
  <ul>
    {#each hits as hit (hit.path)}
      <li>
        <button class:active={app.note?.path === hit.path} onclick={() => app.openNote(hit.path)}>
          <span class="title">{#each parts(hit.title) as p}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</span>
          <span class="path">{hit.path.slice((app.chest?.folder.length ?? 0) + 1)}</span>
          <span class="snippet">{#each parts(hit.snippet) as p}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</span>
        </button>
      </li>
    {/each}
  </ul>
</div>

<style>
  .search {
    display: grid;
    gap: 8px;
  }
  input {
    width: 100%;
    box-sizing: border-box;
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
  li button.active {
    background: var(--accent-bg);
  }
  .title {
    font-weight: 600;
  }
  .path {
    font-size: 11px;
    color: var(--muted);
  }
  .snippet {
    font-size: 12px;
    color: var(--muted);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  mark {
    background: var(--accent-bg);
    color: inherit;
    border-radius: 2px;
  }
  .hint {
    color: var(--muted);
    margin: 0;
    padding: 0 8px;
  }
</style>
