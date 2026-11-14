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
    <h2>{title}</h2>
    {@render children()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.35);
    display: grid;
    place-items: start center;
    padding-top: 14vh;
    z-index: 50;
  }
  .modal {
    max-width: calc(100vw - 32px);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.25);
    padding: 18px 20px;
  }
  h2 {
    margin: 0 0 14px;
    font-size: 16px;
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
