<script lang="ts">
  import { app } from "../app.svelte";
  import * as api from "../backend";
  import * as actions from "../actions";
  import type { TreeEntry } from "../backend";

  interface Node {
    name: string;
    path: string;
    kind: TreeEntry["kind"];
    format: TreeEntry["format"];
    children: Node[];
  }

  const titles = $derived(new Map(app.notes.map((n) => [n.path, n.title])));

  const root = $derived.by(() => {
    const top: Node = { name: "", path: app.chest?.folder ?? "", kind: "dir", format: null, children: [] };
    const dirs = new Map<string, Node>([[top.path, top]]);
    for (const e of app.tree) {
      const node: Node = { name: api.baseName(e.path), path: e.path, kind: e.kind, format: e.format, children: [] };
      (dirs.get(api.dirName(e.path)) ?? top).children.push(node);
      if (e.kind === "dir") dirs.set(e.path, node);
    }
    const sort = (n: Node) => {
      n.children.sort((a, b) =>
        a.kind === "dir" && b.kind !== "dir" ? -1 :
        b.kind === "dir" && a.kind !== "dir" ? 1 :
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
      );
      n.children.forEach(sort);
    };
    sort(top);
    return top;
  });

  // Expanded folders, remembered per chest on this device.
  const storeKey = $derived(`amber:expanded:${app.vault?.root}:${app.chest?.folder}`);
  let expanded = $state(new Set<string>());
  $effect(() => {
    try {
      expanded = new Set(JSON.parse(localStorage.getItem(storeKey) ?? "[]"));
    } catch {
      expanded = new Set();
    }
  });
  function toggle(path: string) {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expanded = next;
    try {
      localStorage.setItem(storeKey, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }
  // Reveal the open note's folders.
  $effect(() => {
    const p = app.note?.path;
    if (!p) return;
    const parts = p.split("/");
    let missing = false;
    const next = new Set(expanded);
    for (let i = 2; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!next.has(dir)) {
        next.add(dir);
        missing = true;
      }
    }
    if (missing) expanded = next;
  });

  let menu = $state<{ x: number; y: number; node: Node | null } | null>(null);

  function openMenu(e: MouseEvent, node: Node | null) {
    e.preventDefault();
    e.stopPropagation();
    menu = { x: e.clientX, y: e.clientY, node };
  }

  function click(node: Node) {
    if (node.kind === "dir") {
      toggle(node.path);
      app.selectedDir = node.path;
    } else if (node.kind === "note") {
      void app.openNote(node.path);
    } else {
      void api.revealVaultPath(node.path).catch(app.fail);
    }
  }

  const dirFor = (node: Node | null) =>
    !node ? app.chest?.folder ?? null : node.kind === "dir" ? node.path : api.dirName(node.path);

  // Run the action first: `node` in the menu reads `menu.node`, which is
  // gone once the menu closes.
  function menuAction(fn: () => void) {
    try {
      fn();
    } finally {
      menu = null;
    }
  }

  // ---- drag and drop: move notes, files and folders between folders ----

  let dragging = $state<Node | null>(null);
  /** Folder under the pointer (the chest folder means "top level"). */
  let dropTarget = $state<string | null>(null);
  let expandTimer: ReturnType<typeof setTimeout> | undefined;

  function canDrop(target: string) {
    const d = dragging;
    if (!d) return false;
    if (api.dirName(d.path) === target) return false; // already there
    if (d.kind === "dir" && (target === d.path || target.startsWith(`${d.path}/`))) return false;
    return true;
  }

  function onDragStart(e: DragEvent, node: Node) {
    dragging = node;
    menu = null;
    e.dataTransfer?.setData("text/plain", node.path);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: DragEvent, target: string, expandable = false) {
    if (!dragging) return;
    e.stopPropagation();
    if (!canDrop(target)) {
      dropTarget = null;
      return;
    }
    e.preventDefault(); // allow dropping here
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    if (dropTarget !== target) {
      dropTarget = target;
      clearTimeout(expandTimer);
      // Hovering a closed folder opens it, so deeper folders can be reached.
      if (expandable && !expanded.has(target)) expandTimer = setTimeout(() => toggle(target), 650);
    }
  }

  async function onDrop(e: DragEvent, target: string) {
    e.preventDefault();
    e.stopPropagation();
    const node = dragging;
    const ok = !!node && canDrop(target); // before endDrag() clears `dragging`
    endDrag();
    if (node && ok) await actions.move(node.path, node.kind === "dir", target);
  }

  function endDrag() {
    clearTimeout(expandTimer);
    dragging = null;
    dropTarget = null;
  }
</script>

<svelte:window onclick={() => (menu = null)} onkeydown={(e) => e.key === "Escape" && (menu = null)} />

{#snippet branch(nodes: Node[], depth: number)}
  {#each nodes as node (node.path)}
    <li>
      <button
        class="row {node.kind}"
        class:active={app.note?.path === node.path}
        class:selected={node.kind === "dir" && app.selectedDir === node.path}
        style:padding-left="{8 + depth * 14}px"
        class:drop={node.kind === "dir" && dropTarget === node.path}
        class:dragging={dragging?.path === node.path}
        title={node.kind === "note" ? titles.get(node.path) ?? node.name : node.name}
        draggable="true"
        onclick={() => click(node)}
        oncontextmenu={(e) => openMenu(e, node)}
        ondragstart={(e) => onDragStart(e, node)}
        ondragend={endDrag}
        ondragover={(e) => (node.kind === "dir" ? onDragOver(e, node.path, true) : onDragOver(e, api.dirName(node.path)))}
        ondrop={(e) => onDrop(e, node.kind === "dir" ? node.path : api.dirName(node.path))}
      >
        {#if node.kind === "dir"}
          <span class="chev" class:open={expanded.has(node.path)}>›</span>
        {:else}
          <span class="badge {node.format ?? 'file'}">{node.format === "typst" ? "T" : node.format === "markdown" ? "M" : "·"}</span>
        {/if}
        <span class="name">{node.kind === "note" ? node.name.replace(/\.(typ|md)$/, "") : node.name}</span>
      </button>
      {#if node.kind === "dir" && expanded.has(node.path)}
        <ul>{@render branch(node.children, depth + 1)}</ul>
      {/if}
    </li>
  {/each}
{/snippet}

<div
  class="tree"
  class:drop-root={!!app.chest && dropTarget === app.chest.folder}
  oncontextmenu={(e) => openMenu(e, null)}
  ondragover={(e) => app.chest && onDragOver(e, app.chest.folder)}
  ondragleave={(e) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as globalThis.Node | null)) dropTarget = null;
  }}
  ondrop={(e) => app.chest && onDrop(e, app.chest.folder)}
  role="tree"
  tabindex="-1"
>
  <ul>{@render branch(root.children, 0)}</ul>
  {#if !app.tree.length}
    <p class="empty">This chest is empty. <button class="link" onclick={() => actions.newNote()}>Create a note</button></p>
  {/if}
</div>

{#if menu}
  {@const node = menu.node}
  <div class="menu" style:left="{menu.x}px" style:top="{menu.y}px" role="menu">
    <button onclick={() => menuAction(() => actions.newNote(dirFor(node)))}>New note here</button>
    <button onclick={() => menuAction(() => actions.newFolder(dirFor(node)))}>New folder here</button>
    {#if node}
      <hr />
      <button onclick={() => menuAction(() => actions.rename(node.path, node.kind === "dir"))}>Rename…</button>
      <button onclick={() => menuAction(() => void api.revealVaultPath(node.path).catch(app.fail))}>
        Show in file manager
      </button>
      <hr />
      <button class="danger" onclick={() => menuAction(() => actions.trash(node.path, node.kind === "dir"))}>Move to trash…</button>
    {/if}
  </div>
{/if}

<style>
  .tree {
    min-height: 100%;
    padding-bottom: 40px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    border: none;
    background: none;
    border-radius: 6px;
    padding: 4px 8px;
    text-align: left;
    white-space: nowrap;
  }
  .row:hover {
    background: var(--hover);
  }
  .row.drop {
    background: var(--accent-bg);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .row.dragging {
    opacity: 0.5;
  }
  .tree.drop-root {
    box-shadow: inset 0 0 0 1px var(--accent);
    border-radius: 6px;
  }
  .row.active {
    background: var(--accent-bg);
  }
  .row.selected {
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .row.file .name {
    color: var(--muted);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chev {
    display: inline-block;
    width: 1em;
    text-align: center;
    color: var(--muted);
    transition: transform 0.1s;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .badge {
    width: 1em;
    font-size: 10px;
    font-weight: 700;
    text-align: center;
    color: var(--accent);
  }
  .badge.markdown {
    color: var(--muted);
  }
  .badge.file {
    color: var(--muted);
  }
  .empty {
    color: var(--muted);
    padding: 8px;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
  }
  .menu {
    position: fixed;
    z-index: 40;
    min-width: 190px;
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
  }
  .menu button:hover {
    background: var(--hover);
  }
  .menu .danger {
    color: var(--bad);
  }
  hr {
    border: none;
    border-top: 1px solid var(--line);
    margin: 4px 0;
  }
</style>
