<script lang="ts">
  import { untrack } from "svelte";
  import { EditorView, basicSetup } from "codemirror";
  import { keymap } from "@codemirror/view";
  import { indentWithTab } from "@codemirror/commands";
  import { markdown } from "@codemirror/lang-markdown";
  import type { Extension } from "@codemirror/state";
  import type { LSPClient } from "@codemirror/lsp-client";
  import { typst } from "./typst-lang";
  import type { OpenedNote } from "./backend";

  interface Props {
    note: OpenedNote;
    /** LSP client for Typst notes; null while the engine is not running. */
    client: LSPClient | null;
    extensions?: Extension[];
    onchange: (text: string) => void;
  }

  let { note, client, extensions = [], onchange }: Props = $props();
  let host: HTMLDivElement;

  const theme = EditorView.theme({
    "&": { height: "100%", fontSize: "15px" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6" },
    ".cm-content": { padding: "20px 0 40vh", maxWidth: "80ch" },
    ".cm-gutters": { background: "transparent", border: "none" },
  });

  // The parent re-creates this component (via {#key}) when the note, its
  // text on disk, or the engine changes. The view is built once, untracked,
  // so typing never rebuilds it.
  $effect(() => untrack(() => mount()));

  function mount() {
    const lang = note.format === "typst" ? typst : markdown();
    const lsp = note.format === "typst" && client ? [client.plugin(note.uri, "typst")] : [];
    const view = new EditorView({
      parent: host,
      doc: note.text,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        EditorView.lineWrapping,
        theme,
        lang,
        lsp,
        extensions,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onchange(u.state.doc.toString());
        }),
      ],
    });
    view.focus();
    return () => view.destroy();
  }
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    height: 100%;
    overflow: hidden;
  }
</style>
