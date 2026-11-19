// [[Wiki link]] support in the editor: highlighting, Cmd/Ctrl+click to
// follow, and note-name completion after `[[`.
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { baseName, stem, type NoteFormat, type NoteSummary } from "./backend";

const LINK = /\[\[([^\[\]\n]+)\]\]/g;

/** The destination inside `[[...]]` without its label: `Note`, `Note\#Heading`, `paper.pdf#page=3`. */
export function linkDest(inner: string): string {
  return inner.split("|")[0].trim();
}

interface WikiOptions {
  format: NoteFormat;
  /** Vault-relative chest folder, used to shorten completion paths. */
  chest: string;
  notes: () => NoteSummary[];
  /** PDFs in the chest (vault paths), offered after `[[` too. */
  pdfs: () => string[];
  /** Opens a link destination (see `linkDest`). */
  follow: (dest: string) => void;
}

const linkMark = Decoration.mark({ class: "cm-wikilink" });

const decorator = new MatchDecorator({ regexp: LINK, decoration: () => linkMark });

const highlight = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) {
      this.decorations = decorator.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = decorator.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

function linkAt(view: EditorView, pos: number): string | null {
  const line = view.state.doc.lineAt(pos);
  for (const m of line.text.matchAll(LINK)) {
    const from = line.from + m.index!;
    if (pos >= from && pos <= from + m[0].length) return linkDest(m[1]);
  }
  return null;
}

export function wikiLinks(opts: WikiOptions): Extension {
  const complete = (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[[^\[\]|#\n]*$/);
    if (!m) return null;
    const notes = opts.notes();
    const counts = new Map<string, number>();
    for (const n of notes) counts.set(stem(n.path).toLowerCase(), (counts.get(stem(n.path).toLowerCase()) ?? 0) + 1);
    const closed = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === "]]";
    const pdfs = opts.pdfs();
    const pdfNames = new Map<string, number>();
    for (const p of pdfs) pdfNames.set(baseName(p).toLowerCase(), (pdfNames.get(baseName(p).toLowerCase()) ?? 0) + 1);
    const pdfOptions = pdfs.map((p) => {
      const target = pdfNames.get(baseName(p).toLowerCase()) === 1 ? baseName(p) : p.slice(opts.chest.length + 1);
      return { label: target, detail: "PDF", type: "text", apply: closed ? target : `${target}]]` };
    });
    return {
      from: m.from + 2,
      validFor: /^[^\[\]|#\n]*$/,
      options: [...pdfOptions, ...notes.map((n) => {
        const name = stem(n.path);
        // Use the chest-relative path when the name alone is ambiguous.
        const unique = counts.get(name.toLowerCase()) === 1;
        const target = unique ? name : n.path.slice(opts.chest.length + 1).replace(/\.(typ|md)$/, "");
        return {
          label: target,
          detail: n.title !== name ? n.title : undefined,
          type: "text",
          apply: closed ? target : `${target}]]`,
        };
      })],
    };
  };

  return [
    highlight,
    EditorState.languageData.of(() => [{ autocomplete: complete }]),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        const target = pos == null ? null : linkAt(view, pos);
        if (!target) return false;
        e.preventDefault();
        opts.follow(target);
        return true;
      },
    }),
    EditorView.theme({
      ".cm-wikilink": {
        color: "var(--accent)",
        textDecoration: "underline",
        textDecorationColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
        textUnderlineOffset: "3px",
      },
      "&.cm-modkey .cm-wikilink": { cursor: "pointer" },
    }),
    // Show a pointer over links while Cmd/Ctrl is held.
    EditorView.domEventHandlers({
      keydown(e, view) {
        if (e.key === "Meta" || e.key === "Control") view.dom.classList.add("cm-modkey");
        return false;
      },
      keyup(e, view) {
        if (e.key === "Meta" || e.key === "Control") view.dom.classList.remove("cm-modkey");
        return false;
      },
      blur(_e, view) {
        view.dom.classList.remove("cm-modkey");
        return false;
      },
    }),
  ];
}
