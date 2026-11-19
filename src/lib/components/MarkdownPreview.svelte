<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { app } from "../app.svelte";
  import * as api from "../backend";

  let html = $state("");
  let host: HTMLDivElement;
  let seq = 0;

  // Render in Rust (comrak, raw HTML escaped), debounced while typing.
  $effect(() => {
    const text = app.liveText;
    const mine = ++seq;
    const t = setTimeout(async () => {
      const out = await api.renderMarkdown(text).catch(() => null);
      if (out !== null && mine === seq) html = out;
    }, 120);
    return () => clearTimeout(t);
  });

  // Point relative images at the read-only vault file protocol.
  $effect(() => {
    html;
    const note = app.note;
    if (!host || !note) return;
    const dir = api.dirName(note.path);
    for (const img of host.querySelectorAll("img")) {
      const src = img.getAttribute("src") ?? "";
      if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) continue;
      const path = api.joinPath(dir, decodeURIComponent(src.split(/[?#]/)[0]));
      if (path) img.src = convertFileSrc(path, "amberfile");
    }
  });

  function onclick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (a.dataset.wikilink) {
      const dest = decodeURIComponent(href);
      if (dest && !dest.startsWith("#")) void app.follow(dest);
    } else if (/^(https?:|mailto:)/i.test(href)) {
      void api.openExternal(href).catch(app.fail);
    } else if (href.startsWith("#")) {
      try {
        host.querySelector(`#${CSS.escape(decodeURIComponent(href.slice(1)))}`)?.scrollIntoView();
      } catch {
        /* not a valid anchor */
      }
    } else if (/\.(md|typ)$/i.test(href.split(/[?#]/)[0]) && app.note) {
      const path = api.joinPath(api.dirName(app.note.path), decodeURIComponent(href.split(/[?#]/)[0]));
      if (path) void app.openNote(path);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="md" bind:this={host} {onclick}>{@html html}</div>

<style>
  .md {
    height: 100%;
    box-sizing: border-box;
    overflow: auto;
    padding: 24px 32px 40vh;
    line-height: 1.6;
    font-size: 15px;
    background: var(--bg);
  }
  .md :global(h1),
  .md :global(h2),
  .md :global(h3) {
    line-height: 1.25;
  }
  .md :global(a) {
    color: var(--accent);
    cursor: pointer;
  }
  .md :global(img) {
    max-width: 100%;
  }
  .md :global(pre),
  .md :global(code) {
    font-family: var(--mono);
    font-size: 13px;
  }
  .md :global(pre) {
    background: var(--hover);
    padding: 10px 12px;
    border-radius: 6px;
    overflow: auto;
  }
  .md :global(table) {
    border-collapse: collapse;
  }
  .md :global(th),
  .md :global(td) {
    border: 1px solid var(--line);
    padding: 4px 8px;
  }
  .md :global(blockquote) {
    margin: 0;
    padding-left: 12px;
    border-left: 3px solid var(--line);
    color: var(--muted);
  }
</style>
