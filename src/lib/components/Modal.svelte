<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    onclose: () => void;
    children: Snippet;
    width?: string;
  }

  let { title, onclose, children, width = "440px" }: Props = $props();

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="backdrop" onclick={onclose} role="presentation">
  <div
    class="modal"
    style:width
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={() => {}}
  >
    <header>
      <h2>{title}</h2>
      <button type="button" class="close" onclick={onclose} aria-label="Close" title="Close (Esc)">×</button>
    </header>
    <div class="body">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.35);
    display: grid;
    place-items: start center;
    /* Lower on tall windows, close to the top on short ones. */
    padding: min(14vh, 80px) 16px 16px;
    z-index: 50;
  }
  .modal {
    display: flex;
    flex-direction: column;
    max-width: 100%;
    /* Fits the window; the body scrolls when the content is taller. */
    max-height: calc(100vh - min(14vh, 80px) - 16px);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.25);
    box-sizing: border-box;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 12px 10px 20px;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  .close {
    border: none;
    background: none;
    color: var(--muted);
    font-size: 20px;
    line-height: 1;
    padding: 2px 8px;
    border-radius: 6px;
  }
  .close:hover {
    background: var(--hover);
    color: var(--fg);
  }
  .body {
    overflow-y: auto;
    padding: 14px 20px 18px;
    min-height: 0;
  }
  .modal :global(form) {
    display: grid;
    gap: 12px;
  }
  .modal :global(label) {
    display: grid;
    gap: 5px;
    font-size: 13px;
    color: var(--muted);
  }
  .modal :global(label.check) {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--fg);
  }
  .modal :global(.actions) {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
  .modal :global(.hint) {
    font-size: 12px;
    color: var(--muted);
    margin: 0;
  }
</style>
