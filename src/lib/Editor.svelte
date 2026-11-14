<script lang="ts">
  import { EditorView, basicSetup } from "codemirror";
  import { keymap } from "@codemirror/view";
  import { indentWithTab } from "@codemirror/commands";
  import { markdown } from "@codemirror/lang-markdown";
  import type { LSPClient } from "@codemirror/lsp-client";
  import { typst } from "./typst-lang";
  import type { Note } from "./backend";

  interface Props {
    note: Note;
    text: string;
    /** LSP client for Typst notes; null while the engine is not running. */
    client: LSPClient | null;
    onchange: (text: string) => void;
  }

  let { note, text, client, onchange }: Props = $props();
  let host: HTMLDivElement;

  const theme = EditorView.theme({
    "&": { height: "100%", fontSize: "15px" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6" },
    ".cm-content": { padding: "16px 0", maxWidth: "82ch" },
    ".cm-gutters": { background: "transparent", border: "none" },
  });

  // Rebuild the view whenever the note or the client changes; the parent
  // passes a fresh `text` with each new note.
  $effect(() => {
    const lang = note.format === "typst" ? typst : markdown();
    const lsp = note.format === "typst" && client ? [client.plugin(note.uri, "typst")] : [];
    const view = new EditorView({
      parent: host,
      doc: text,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        EditorView.lineWrapping,
        theme,
        lang,
        lsp,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onchange(u.state.doc.toString());
        }),
      ],
    });
    view.focus();
    return () => view.destroy();
  });
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    height: 100%;
    overflow: hidden;
  }
</style>
