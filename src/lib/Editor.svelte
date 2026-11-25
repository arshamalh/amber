<script lang="ts">
  import { untrack } from "svelte";
  import { EditorView, basicSetup } from "codemirror";
  import { keymap } from "@codemirror/view";
  import { indentWithTab } from "@codemirror/commands";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { syntaxTree } from "@codemirror/language";
  import { Compartment, Prec, type Extension } from "@codemirror/state";
  import type { LSPClient } from "@codemirror/lsp-client";
  import { typst } from "./typst-lang";
  import { editingHelpers } from "./editing";
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

  /**
   * Enter at the end of an opening fence (```rust) that has no closing one
   * yet: adds the closing fence and puts the cursor on the line between.
   */
  function closeFence(view: EditorView): boolean {
    const { state } = view;
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.head);
    const m = /^(\s*)(`{3,}|~{3,})[\w+#.-]*\s*$/.exec(line.text);
    if (!sel.empty || sel.head !== line.to || !m) return false;
    let fence = syntaxTree(state).resolveInner(line.from + m[1].length, 1);
    while (fence.name !== "FencedCode" && fence.parent) fence = fence.parent;
    if (fence.name !== "FencedCode" || state.doc.lineAt(fence.from).number !== line.number) return false;
    const end = fence.lastChild;
    if (end?.name === "CodeMark" && state.doc.lineAt(end.from).number !== line.number) return false; // already closed
    const indent = m[1];
    view.dispatch({
      changes: { from: line.to, insert: `\n${indent}\n${indent}${m[2]}` },
      selection: { anchor: line.to + 1 + indent.length },
      userEvent: "input",
      scrollIntoView: true,
    });
    return true;
  }

  const theme = EditorView.theme({
    "&": { height: "100%", fontSize: "15px" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6" },
    ".cm-content": { padding: "20px 0 40vh", maxWidth: "80ch" },
    // Side space on the scroller, not the content: CodeMirror draws selections
    // across the content's padding, past the edge of code blocks.
    "&.cm-writing .cm-content": { maxWidth: "72ch", margin: "0 auto", padding: "28px 0 40vh" },
    "&.cm-writing .cm-scroller": { padding: "0 24px" },
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
    const lang =
      note.format === "typst"
        ? typst()
        : [
            // Code blocks highlight by their language (loaded when first used).
            markdown({ base: markdownLanguage, codeLanguages: languages }),
            Prec.high(keymap.of([{ key: "Enter", run: closeFence }])),
          ];
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
        editingHelpers,
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
