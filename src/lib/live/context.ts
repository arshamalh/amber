// Shared state for building writing-view decorations from a syntax tree.
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type WidgetType } from "@codemirror/view";
import type { Fragment } from "./render";
import { PageWidget } from "./widgets";

export class Builder {
  decos: Range<Decoration>[] = [];
  /** Ranges replaced by widgets; nothing else may decorate inside them. */
  private replaced: [number, number][] = [];
  wanted: Fragment[] = [];
  files = new Set<string>();

  /** Lines hidden in the writing view (setup code, front matter). */
  prelude: { from: number; to: number } | null = null;

  /**
   * `active` is false until the user clicks, types or moves the cursor, so
   * a freshly opened note shows nothing revealed under the initial cursor.
   */
  constructor(
    readonly state: EditorState,
    readonly active = true,
  ) {}

  /** True when the selection touches [from, to]: show the source there. */
  touches(from: number, to: number): boolean {
    if (!this.active) return false;
    return this.state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  }

  /**
   * Hides whole lines [from, to] plus the blank lines after them. Only the
   * Source view shows them; the cursor skips over them (see atomic ranges).
   */
  hideLines(from: number, to: number) {
    const doc = this.state.doc;
    let last = doc.lineAt(to);
    while (last.number < doc.lines && !/\S/.test(doc.line(last.number + 1).text)) {
      last = doc.line(last.number + 1);
    }
    const a = doc.lineAt(from).from;
    if (this.isReplaced(a, last.to)) return;
    this.decos.push(Decoration.replace({ block: true }).range(a, last.to));
    this.replaced.push([a, last.to]);
    this.prelude = { from: a, to: last.to };
  }

  isReplaced(from: number, to: number): boolean {
    return this.replaced.some(([a, b]) => from < b && to > a);
  }

  mark(from: number, to: number, cls: string, attributes?: Record<string, string>) {
    if (from >= to || this.isReplaced(from, to)) return;
    this.decos.push(Decoration.mark({ class: cls, attributes }).range(from, to));
  }

  hide(from: number, to: number) {
    if (from >= to || this.isReplaced(from, to)) return;
    this.decos.push(Decoration.replace({}).range(from, to));
    this.replaced.push([from, to]);
  }

  widget(from: number, to: number, widget: WidgetType) {
    if (this.isReplaced(from, to)) return;
    this.decos.push(Decoration.replace({ widget }).range(from, to));
    this.replaced.push([from, to]);
  }

  /** Replaces whole lines [from, to] with a block widget. */
  blockWidget(from: number, to: number, widget: WidgetType) {
    const a = this.state.doc.lineAt(from).from;
    const b = this.state.doc.lineAt(to).to;
    if (this.isReplaced(a, b)) return;
    this.decos.push(Decoration.replace({ widget, block: true }).range(a, b));
    this.replaced.push([a, b]);
  }

  /** A widget below the line containing `pos` (e.g. a live render preview). */
  below(pos: number, widget: WidgetType) {
    const end = this.state.doc.lineAt(pos).to;
    this.decos.push(Decoration.widget({ widget, block: true, side: 1 }).range(end));
  }

  inline(pos: number, widget: WidgetType) {
    this.decos.push(Decoration.widget({ widget, side: 1 }).range(pos));
  }

  line(pos: number, cls: string) {
    const from = this.state.doc.lineAt(pos).from;
    this.decos.push(Decoration.line({ class: cls }).range(from));
  }

  lines(from: number, to: number, cls: string) {
    const doc = this.state.doc;
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
      this.decos.push(Decoration.line({ class: cls }).range(doc.line(n).from));
    }
  }

  /** True if [from, to] is alone on its lines (only whitespace around it). */
  wholeLines(from: number, to: number): boolean {
    const doc = this.state.doc;
    const a = doc.lineAt(from);
    const b = doc.lineAt(to);
    return !/\S/.test(doc.sliceString(a.from, from)) && !/\S/.test(doc.sliceString(to, b.to));
  }

  /** A web link; `[from, to]` is the whole syntax node (for revealing). */
  url(from: number, to: number, href: string, nodeFrom = from, nodeTo = to) {
    this.mark(from, to, "cm-lp-url", {
      "data-lp-href": href,
      "data-lp-rendered": this.touches(nodeFrom, nodeTo) ? "0" : "1",
    });
  }

  text(from: number, to: number) {
    return this.state.doc.sliceString(from, to);
  }
}

const WIKI = /\[\[([^[\]\n]+)\]\]/g;

/**
 * Hides `[[`, `]]` and the `target|` part of wiki links outside the
 * cursor, leaving the label. `skip(pos)` excludes code, maths and comments.
 */
export function wikiLinks(b: Builder, skip: (pos: number) => boolean) {
  const text = b.state.doc.toString();
  for (const m of text.matchAll(WIKI)) {
    const from = m.index!;
    const to = from + m[0].length;
    if (skip(from) || b.isReplaced(from, to)) continue;
    const inner = m[1];
    const dest = inner.split("|")[0].trim();
    const bar = inner.indexOf("|");
    const labelFrom = bar >= 0 ? from + 2 + bar + 1 : from + 2;
    const shown = !b.touches(from, to);
    // [[paper.pdf\#page=12]] reads "paper.pdf, p. 12".
    const page = bar < 0 ? /\\?#page=(\d+)\s*$/.exec(inner) : null;
    let labelTo = to - 2;
    if (shown) {
      b.hide(from, labelFrom);
      if (page) {
        labelTo = from + 2 + page.index;
        b.widget(labelTo, to, new PageWidget(page[1], dest));
      } else b.hide(to - 2, to);
    }
    b.mark(shown ? labelFrom : from, shown ? labelTo : to, "cm-lp-wikilink", {
      "data-lp-wiki": dest,
      "data-lp-rendered": shown ? "1" : "0",
    });
  }
}
