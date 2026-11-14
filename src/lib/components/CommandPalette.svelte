<script lang="ts">
  import { app } from "../app.svelte";
  import { ui, type PaletteMode } from "../ui.svelte";
  import { commands } from "../actions";
  import * as actions from "../actions";

  interface Item {
    key: string;
    label: string;
    detail?: string;
    run: () => void;
  }

  let query = $state("");
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLUListElement | undefined = $state();

  $effect(() => {
    if (ui.palette) {
      query = ui.palette === "commands" ? ">" : "";
      active = 0;
      queueMicrotask(() => input?.focus());
    }
  });

  /** Subsequence match; lower is better, null for no match. */
  function score(text: string, q: string): number | null {
    if (!q) return 0;
    const t = text.toLowerCase();
    const at = t.indexOf(q);
    if (at >= 0) return at === 0 || /[\s/_-]/.test(t[at - 1]) ? at * 0.1 : at * 0.5 + 1;
    let pos = -1;
    let gaps = 0;
    for (const ch of q) {
      const next = t.indexOf(ch, pos + 1);
      if (next < 0) return null;
      gaps += next - pos - 1;
      pos = next;
    }
    return 10 + gaps;
  }

  const mode = $derived<PaletteMode>(query.startsWith(">") ? "commands" : ui.palette === "chests" ? "chests" : "notes");

  const items = $derived.by((): Item[] => {
    const q = (mode === "commands" ? query.slice(1) : query).trim().toLowerCase();
    let pool: Item[] = [];
    if (mode === "commands") {
      pool = commands
        .filter((c) => !c.when || c.when())
        .map((c) => ({ key: c.id, label: c.title, detail: c.shortcut, run: c.run }));
    } else if (mode === "chests") {
      pool = (app.vault?.chests ?? []).map((c) => ({
        key: c.folder,
        label: c.name,
        detail: c.isChest ? (c.folder === app.chest?.folder ? "open" : undefined) : "make it a chest",
        run: () => void (c.isChest ? app.openChest(c.folder) : app.makeChest(c.folder).catch(app.fail)),
      }));
      pool.push({ key: "+new", label: "New chest…", run: actions.newChest });
    } else {
      const chest = app.chest?.folder ?? "";
      pool = app.notes.map((n) => {
        const rel = n.path.slice(chest.length + 1);
        return {
          key: n.path,
          label: n.title,
          detail: rel,
          run: () => void app.openNote(n.path),
        };
      });
      if (q && app.chest) {
        const name = query.trim();
        pool.push({
          key: "+create",
          label: `Create "${name}"`,
          detail: "new note",
          run: () =>
            void app
              .createNote(app.notePath(name, app.chest!.defaultFormat, app.chest!.folder))
              .catch(app.fail),
        });
      }
    }
    if (!q) return pool;
    return pool
      .map((it) => {
        const s = Math.min(score(it.label, q) ?? Infinity, (score(it.detail ?? "", q) ?? Infinity) + 2);
        return { it, s: it.key.startsWith("+") ? 1000 : s };
      })
      .filter((x) => x.s !== Infinity)
      .sort((a, b) => a.s - b.s)
      .map((x) => x.it)
      .slice(0, 60);
  });

  $effect(() => {
    items;
    active = 0;
  });

  $effect(() => {
    list?.children[active]?.scrollIntoView({ block: "nearest" });
  });

  function choose(it: Item | undefined) {
    if (!it) return;
    ui.palette = null;
    it.run();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(active + 1, items.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      ui.palette = null;
    }
  }

  const placeholder = $derived(
    ui.palette === "chests" ? "Switch chest…" : "Go to note…  (type > for commands)",
  );
</script>

{#if ui.palette}
  <div class="backdrop" onclick={() => (ui.palette = null)} role="presentation">
    <div class="palette" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette" tabindex="-1" onkeydown={() => {}}>
      <input bind:this={input} bind:value={query} {placeholder} {onkeydown} spellcheck="false" />
      <ul bind:this={list}>
        {#each items as it, i (it.key)}
          <li>
            <button class:active={i === active} onmousemove={() => (active = i)} onclick={() => choose(it)}>
              <span class="label">{it.label}</span>
              {#if it.detail}<span class="detail">{it.detail}</span>{/if}
            </button>
          </li>
        {:else}
          <li class="empty">Nothing found</li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: start center;
    padding-top: 12vh;
    background: rgb(0 0 0 / 0.2);
  }
  .palette {
    width: 560px;
    max-width: calc(100vw - 32px);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.25);
    overflow: hidden;
  }
  input {
    width: 100%;
    box-sizing: border-box;
    border: none;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    padding: 12px 14px;
    font-size: 15px;
    outline: none;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 4px;
    max-height: 50vh;
    overflow: auto;
  }
  button {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    border: none;
    background: none;
    text-align: left;
    padding: 7px 10px;
    border-radius: 6px;
  }
  button.active {
    background: var(--accent-bg);
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 50%;
  }
  .empty {
    color: var(--muted);
    padding: 8px 10px;
  }
</style>
