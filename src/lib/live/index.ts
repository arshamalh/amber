// The writing view: Typst or Markdown with markup hidden away from the
// cursor, maths and function blocks rendered by Typst (ADR 0007).
// Turning on "Show Typst" removes this extension; the text never changes.
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { NoteFormat } from "../backend";
import { Builder } from "./context";
import { buildMarkdown } from "./markdown";
import { Renderer, type Fragment } from "./render";
import { buildTypst } from "./typst";

export interface LiveOptions {
  format: NoteFormat;
  notePath: string;
  follow: (target: string) => void;
  openUrl: (url: string) => void;
}

interface LiveState {
  decos: DecorationSet;
  wanted: Fragment[];
  preamble: string;
  files: string[];
}

/** Dispatched when new renders arrive, to redraw widgets. */
const rendered = StateEffect.define<null>();

function build(state: EditorState, opts: LiveOptions): LiveState {
  const b = new Builder(state);
  let preamble = "";
  if (opts.format === "typst") preamble = buildTypst(b, { notePath: opts.notePath }).preamble;
  else buildMarkdown(b, opts.notePath);
  return {
    decos: Decoration.set(b.decos, true),
    wanted: b.wanted,
    preamble,
    files: [...b.files],
  };
}

export function livePreview(opts: LiveOptions): Extension {
  const field = StateField.define<LiveState>({
    create: (state) => build(state, opts),
    update(value, tr) {
      const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state);
      if (tr.docChanged || tr.selection || treeChanged || tr.effects.some((e) => e.is(rendered))) {
        return build(tr.state, opts);
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  });

  const requester = ViewPlugin.fromClass(
    class {
      renderer: Renderer;
      last: LiveState | null = null;
      constructor(readonly view: EditorView) {
        this.renderer = new Renderer(opts.notePath, () =>
          this.view.dispatch({ effects: rendered.of(null) }),
        );
        this.request();
      }
      update(u: ViewUpdate) {
        if (u.state.field(field) !== this.last) this.request();
      }
      request() {
        const live = this.view.state.field(field);
        this.last = live;
        if (live.wanted.length) this.renderer.want(live.preamble, live.files, live.wanted);
      }
      destroy() {
        this.renderer.destroy();
      }
    },
  );

  const clicks = EditorView.domEventHandlers({
    mousedown(e) {
      if (e.button !== 0 || e.shiftKey || e.altKey) return false;
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-lp-wiki], [data-lp-href]");
      if (!el) return false;
      // Plain click follows a rendered link; in revealed source, only Cmd/Ctrl+click.
      if (el.dataset.lpRendered !== "1" && !(e.metaKey || e.ctrlKey)) return false;
      e.preventDefault();
      if (el.dataset.lpWiki) opts.follow(el.dataset.lpWiki);
      else if (el.dataset.lpHref) opts.openUrl(el.dataset.lpHref);
      return true;
    },
  });

  return [field, requester, clicks, EditorView.editorAttributes.of({ class: "cm-writing" }), theme];
}

const theme = EditorView.theme({
  "&.cm-writing .cm-content": {
    fontFamily: "var(--prose)",
    fontSize: "16px",
    lineHeight: "1.7",
  },
  "&.cm-writing .cm-gutters": { display: "none" },
  "&.cm-writing .cm-activeLine": { background: "transparent" },
  ".cm-lp-h1": { fontSize: "1.9em", fontWeight: "700", lineHeight: "1.3", paddingTop: "0.5em" },
  ".cm-lp-h2": { fontSize: "1.5em", fontWeight: "700", lineHeight: "1.3", paddingTop: "0.4em" },
  ".cm-lp-h3": { fontSize: "1.25em", fontWeight: "650", paddingTop: "0.3em" },
  ".cm-lp-h4, .cm-lp-h5, .cm-lp-h6": { fontSize: "1.05em", fontWeight: "650" },
  // Code highlighting underlines headings; the size already says "heading".
  "&.cm-writing [class*='cm-lp-h'] span:not(.cm-lp-url):not(.cm-lp-wikilink)": { textDecoration: "none" },
  ".cm-lp-strong": { fontWeight: "700" },
  ".cm-lp-emph": { fontStyle: "italic" },
  ".cm-lp-underline": { textDecoration: "underline" },
  ".cm-lp-strike": { textDecoration: "line-through" },
  ".cm-lp-highlight": { background: "color-mix(in srgb, var(--accent) 25%, transparent)" },
  ".cm-lp-smallcaps": { fontVariant: "small-caps" },
  ".cm-lp-sub": { verticalAlign: "sub", fontSize: "0.8em" },
  ".cm-lp-super": { verticalAlign: "super", fontSize: "0.8em" },
  ".cm-lp-footnote": { fontSize: "0.85em", color: "var(--muted)", borderBottom: "1px dotted var(--muted)" },
  ".cm-lp-done": { color: "var(--muted)", textDecoration: "line-through" },
  ".cm-lp-code": {
    fontFamily: "var(--mono)",
    fontSize: "0.88em",
    background: "var(--hover)",
    borderRadius: "4px",
    padding: "1px 3px",
  },
  ".cm-lp-codeblock": { fontFamily: "var(--mono)", fontSize: "0.88em", background: "var(--hover)" },
  ".cm-lp-fence": { color: "var(--muted)" },
  ".cm-lp-quote": { borderLeft: "3px solid var(--line)", paddingLeft: "12px !important", color: "var(--muted)" },
  ".cm-lp-comment, .cm-lp-dim, .cm-lp-comment *": { color: "var(--muted) !important", opacity: "0.75" },
  ".cm-lp-label": { color: "var(--muted)", fontSize: "0.85em" },
  ".cm-lp-ref": { color: "var(--accent)" },
  ".cm-lp-url, .cm-lp-wikilink": {
    color: "var(--accent)",
    textDecoration: "underline",
    textDecorationColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
    textUnderlineOffset: "3px",
    cursor: "pointer",
  },
  ".cm-lp-setup-line, .cm-lp-code-src, .cm-lp-math-src": { fontFamily: "var(--mono)", fontSize: "0.88em" },
  ".cm-lp-bullet, .cm-lp-number": { color: "var(--muted)", display: "inline-block", minWidth: "0.9em" },
  ".cm-lp-task": { margin: "0 4px 0 0", verticalAlign: "middle", accentColor: "var(--accent)" },
  ".cm-lp-chip": {
    display: "inline-block",
    margin: "2px 0",
    padding: "1px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    color: "var(--muted)",
    background: "var(--hover)",
    cursor: "pointer",
    fontFamily: "var(--prose)",
  },
  ".cm-lp-hr": { borderTop: "1px solid var(--line)", margin: "10px 0" },
  ".cm-lp-render": { cursor: "pointer" },
  ".cm-lp-render img": { verticalAlign: "middle", maxWidth: "100%" },
  ".cm-lp-render-block": { display: "block", textAlign: "center", padding: "6px 0" },
  ".cm-lp-render-live": { cursor: "default", opacity: "0.9", borderTop: "1px dashed var(--line)", fontSize: "12px" },
  ".cm-lp-render-pending": { fontFamily: "var(--mono)", fontSize: "0.88em", color: "var(--muted)" },
  ".cm-lp-render-error": {
    fontFamily: "var(--mono)",
    fontSize: "0.88em",
    textDecoration: "underline wavy var(--bad)",
    textUnderlineOffset: "3px",
  },
  ".cm-lp-render-live.cm-lp-render-error": { color: "var(--bad)", textDecoration: "none" },
  ".cm-lp-image img": { maxWidth: "100%", maxHeight: "420px", borderRadius: "4px", verticalAlign: "middle" },
});
