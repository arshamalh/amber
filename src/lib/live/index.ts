// The writing view: Typst or Markdown with markup hidden away from the
// cursor, maths and function blocks rendered by Typst (ADR 0007).
// Turning on "Show Typst" removes this extension; the text never changes.
import { EditorSelection, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
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
  /** Hidden leading lines, which the cursor skips. */
  prelude: DecorationSet;
  preludeEnd: number;
  /** Whether the user has clicked, typed or moved the cursor yet. */
  active: boolean;
  wanted: Fragment[];
  preamble: string;
  files: string[];
}

/** Dispatched when new renders arrive, to redraw widgets. */
const rendered = StateEffect.define<null>();

function build(state: EditorState, opts: LiveOptions, active: boolean): LiveState {
  const b = new Builder(state, active);
  let preamble = "";
  if (opts.format === "typst") preamble = buildTypst(b, { notePath: opts.notePath }).preamble;
  else buildMarkdown(b, opts.notePath);
  const p = b.prelude;
  return {
    decos: Decoration.set(b.decos, true),
    prelude: p ? Decoration.set([Decoration.mark({}).range(p.from, p.to)]) : Decoration.none,
    preludeEnd: p ? p.to : -1,
    active,
    wanted: b.wanted,
    preamble,
    files: [...b.files],
  };
}

export function livePreview(opts: LiveOptions): Extension {
  const field = StateField.define<LiveState>({
    create: (state) => build(state, opts, false),
    update(value, tr) {
      const user = ["select", "input", "delete", "move", "undo", "redo"].some((e) => tr.isUserEvent(e));
      const active = value.active || user;
      const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state);
      if (tr.docChanged || tr.selection || treeChanged || active !== value.active || tr.effects.some((e) => e.is(rendered))) {
        return build(tr.state, opts, active);
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
        // Start the cursor on the first visible line, below hidden setup
        // lines and after a heading or list marker (which is hidden), so
        // typing right away can't break the line. Not a user action, so
        // nothing gets revealed.
        queueMicrotask(() => {
          const st = view.state;
          if (st.selection.main.head !== 0 && st.selection.main.head > st.field(field).preludeEnd) return;
          const end = st.field(field).preludeEnd;
          const line = st.doc.lineAt(Math.min(end >= 0 ? end + 1 : 0, st.doc.length));
          const marker = /^(?:=+|#{1,6}|[-+*]|\d+\.)\s/.exec(line.text)?.[0].length ?? 0;
          view.dispatch({ selection: { anchor: line.from + marker } });
        });
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

  // The cursor can't enter the hidden setup lines (Source shows them).
  const atomic = EditorView.atomicRanges.of((view) => view.state.field(field).prelude);

  // Atomic ranges still allow the position *before* hidden lines (0), where
  // typing would land above `#import`. Keep the cursor, and both ends of a
  // selection (e.g. Select All), on or below the first visible line.
  const belowPrelude = EditorState.transactionFilter.of((tr) => {
    if (!tr.selection) return tr;
    const end = tr.startState.field(field).preludeEnd;
    if (end < 0) return tr;
    const first = tr.changes.mapPos(end, 1) + 1;
    if (first > tr.newDoc.length) return tr;
    const sel = tr.selection;
    if (sel.ranges.every((r) => r.from >= first)) return tr;
    const clamp = (p: number) => Math.max(p, first);
    return [tr, { selection: EditorSelection.create(sel.ranges.map((r) => EditorSelection.range(clamp(r.anchor), clamp(r.head))), sel.mainIndex), sequential: true }];
  });

  return [field, requester, clicks, atomic, belowPrelude, EditorView.editorAttributes.of({ class: "cm-writing" }), theme];
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
