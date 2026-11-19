<script lang="ts">
  import { untrack } from "svelte";
  import { EditorView, basicSetup } from "codemirror";
  import { keymap } from "@codemirror/view";
  import { indentWithTab } from "@codemirror/commands";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { Compartment, type Extension } from "@codemirror/state";
  import type { LSPClient } from "@codemirror/lsp-client";
  import { typst } from "./typst-lang";
  import type { OpenedNote } from "./backend";

  interface Props {
    note: OpenedNote;
    /** LSP client for Typst notes; null while the engine is not running. */
    client: LSPClient | null;
    extensions?: Extension[];
    /** The writing view (markup hidden). Active unless `source` is on. */
    writing?: Extension;
    /** "Show Typst": plain source, no hiding. */
    source?: boolean;
    onchange: (text: string) => void;
  }

  let { note, client, extensions = [], writing = [], source = false, onchange }: Props = $props();
  let host: HTMLDivElement;
  let view: EditorView | undefined;
  const mode = new Compartment();

  const theme = EditorView.theme({
    "&": { height: "100%", fontSize: "15px" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6" },
    ".cm-content": { padding: "20px 0 40vh", maxWidth: "80ch" },
    "&.cm-writing .cm-content": { maxWidth: "72ch", margin: "0 auto", padding: "28px 24px 40vh" },
    ".cm-gutters": { background: "transparent", border: "none" },
  });

  // The parent re-creates this component (via {#key}) when the note, its
  // text on disk, or the engine changes. The view is built once, untracked,
  // so typing never rebuilds it.
  $effect(() => untrack(() => mount()));

  // Switching between the writing view and the source swaps one
  // compartment; the document and undo history are untouched.
  $effect(() => {
    const ext = source ? [] : writing;
    view?.dispatch({ effects: mode.reconfigure(ext) });
  });

  function mount() {
    const lang = note.format === "typst" ? typst() : markdown({ base: markdownLanguage });
    const lsp = note.format === "typst" && client ? [client.plugin(note.uri, "typst")] : [];
    view = new EditorView({
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
        mode.of(untrack(() => (source ? [] : writing))),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onchange(u.state.doc.toString());
        }),
      ],
    });
    view.focus();
    return () => {
      view?.destroy();
      view = undefined;
    };
  }
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    height: 100%;
    overflow: hidden;
  }
</style>
