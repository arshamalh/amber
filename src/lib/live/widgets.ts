// Widgets shown in place of hidden markup in the writing view.
import { WidgetType, type EditorView } from "@codemirror/view";
import { cached } from "./render";

/** Moves the cursor into the source at `pos`, which reveals it. */
function reveal(view: EditorView, pos: number) {
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
  view.focus();
}

/** Rendered Typst output (maths, function blocks). Click to edit the source. */
export class RenderWidget extends WidgetType {
  /** Render state when the widget was made, so it redraws once rendered. */
  readonly status: "ok" | "error" | "pending";

  constructor(
    readonly key: string,
    readonly source: string,
    readonly block: boolean,
    /** Where clicking puts the cursor; -1 for the preview under edited source. */
    readonly pos: number,
  ) {
    super();
    const r = cached(key);
    this.status = r?.src ? "ok" : r?.error ? "error" : "pending";
  }

  eq(other: RenderWidget) {
    return (
      other.key === this.key &&
      other.block === this.block &&
      other.pos === this.pos &&
      other.status === this.status
    );
  }

  toDOM(view: EditorView) {
    const r = cached(this.key);
    const el = document.createElement(this.block ? "div" : "span");
    el.className = `cm-lp-render ${this.block ? "cm-lp-render-block" : "cm-lp-render-inline"}`;
    if (this.pos < 0) el.classList.add("cm-lp-render-live");
    if (r?.src) {
      const img = document.createElement("img");
      img.src = r.src;
      img.alt = this.source;
      img.draggable = false;
      img.style.width = `${r.widthPx}px`;
      el.append(img);
    } else if (r?.error) {
      el.classList.add("cm-lp-render-error");
      el.textContent = this.pos < 0 ? `⚠ ${r.error}` : this.source;
      el.title = r.error;
    } else {
      el.classList.add("cm-lp-render-pending");
      el.textContent = this.pos < 0 ? "" : this.source;
    }
    if (this.pos >= 0) {
      el.title ||= "Click to edit";
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        reveal(view, this.pos);
      });
    }
    return el;
  }

  get estimatedHeight() {
    return cached(this.key)?.heightPx ?? -1;
  }

  ignoreEvent() {
    return true;
  }
}

export class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }
  eq(o: BulletWidget) {
    return o.depth === this.depth;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-bullet";
    el.textContent = ["•", "◦", "▪"][this.depth % 3];
    return el;
  }
}

export class NumberWidget extends WidgetType {
  constructor(readonly n: number) {
    super();
  }
  eq(o: NumberWidget) {
    return o.n === this.n;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-number";
    el.textContent = `${this.n}.`;
    return el;
  }
}

export class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-lp-hr";
    return el;
  }
}

/** A Markdown task checkbox; clicking toggles `[ ]` / `[x]` in the source. */
export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lp-task";
    box.checked = this.checked;
    if (this.checked) box.setAttribute("checked", "");
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

/** An image from the vault (Markdown `![alt](path)`). */
export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string | null,
    readonly alt: string,
    readonly pos: number,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.alt === this.alt && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "cm-lp-image";
    if (this.src) {
      const img = document.createElement("img");
      img.src = this.src;
      img.alt = this.alt;
      img.draggable = false;
      el.append(img);
    } else {
      el.textContent = `🖼 ${this.alt || "image"}`;
    }
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      reveal(view, this.pos);
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}
