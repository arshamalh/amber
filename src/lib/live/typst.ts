// Writing-view rules for Typst notes, over the `typst-syntax`-shaped tree.
import { ensureSyntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { joinPath } from "../backend";
import { Builder, wikiLinks } from "./context";
import { fragmentKey } from "./render";
import { BulletWidget, ChipWidget, NumberWidget, RenderWidget } from "./widgets";

/** Calls whose only argument is content are shown as styled text. */
const STYLE_CALLS: Record<string, string> = {
  strong: "cm-lp-strong",
  emph: "cm-lp-emph",
  underline: "cm-lp-underline",
  strike: "cm-lp-strike",
  highlight: "cm-lp-highlight",
  smallcaps: "cm-lp-smallcaps",
  sub: "cm-lp-sub",
  super: "cm-lp-super",
  footnote: "cm-lp-footnote",
};

const SETUP = new Set(["ModuleImport", "SetRule", "ShowRule", "LetBinding"]);
const NO_WIKI = new Set(["Raw", "LineComment", "BlockComment", "Str", "Equation", "Math", "Code", "CodeBlock", "Args"]);

export interface TypstOptions {
  /** Vault-relative path of the note. */
  notePath: string;
}

export function buildTypst(b: Builder, opts: TypstOptions) {
  const tree = ensureSyntaxTree(b.state, b.state.doc.length, 200);
  if (!tree) return { preamble: "" };
  const root = tree.topNode;
  const noteDir = opts.notePath.includes("/") ? opts.notePath.slice(0, opts.notePath.lastIndexOf("/")) : "";
  const preamble = collectPreamble(b, root, noteDir);

  // Leading setup lines (#import, #set, #show, #let) fold into one chip.
  const setup = leadingSetup(root);
  if (setup && !b.touches(setup.from, setup.to)) {
    const lines = b.state.doc.lineAt(setup.to).number - b.state.doc.lineAt(setup.from).number + 1;
    b.blockWidget(setup.from, setup.to, new ChipWidget(`Typst setup · ${lines} line${lines === 1 ? "" : "s"}`, setup.from));
  }

  const ctx = { b, noteDir, preamble };
  visitChildren(ctx, root, true);
  wikiLinks(b, (pos) => {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) {
      if (NO_WIKI.has(n.name)) return true;
    }
    return false;
  });
  return { preamble };
}

interface Ctx {
  b: Builder;
  noteDir: string;
  preamble: string;
}

function visitChildren(ctx: Ctx, node: SyntaxNode, topLevel: boolean) {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === "Hash" && c.nextSibling) {
      code(ctx, c, c.nextSibling, topLevel);
      c = c.nextSibling;
      continue;
    }
    visit(ctx, c, topLevel);
  }
}

function visit(ctx: Ctx, n: SyntaxNode, topLevel: boolean) {
  const { b } = ctx;
  switch (n.name) {
    case "Heading": {
      const marker = n.firstChild;
      if (marker?.name === "HeadingMarker") {
        b.line(n.from, `cm-lp-h${Math.min(marker.to - marker.from, 6)}`);
        if (!b.touches(n.from, n.to)) b.hide(marker.from, spaceAfter(b, marker.to));
      }
      return visitChildren(ctx, n, false);
    }
    case "Strong":
    case "Emph": {
      b.mark(n.from, n.to, n.name === "Strong" ? "cm-lp-strong" : "cm-lp-emph");
      const open = n.firstChild;
      const close = n.lastChild;
      if (!b.touches(n.from, n.to) && open && close && open.from !== close.from && close.name === open.name) {
        b.hide(open.from, open.to);
        b.hide(close.from, close.to);
      }
      return visitChildren(ctx, n, false);
    }
    case "Raw": {
      if (b.text(n.from, n.to).includes("\n")) {
        b.lines(n.from, n.to, "cm-lp-codeblock");
        b.line(n.from, "cm-lp-fence");
        b.line(n.to, "cm-lp-fence");
        return;
      }
      b.mark(n.from, n.to, "cm-lp-code");
      if (!b.touches(n.from, n.to)) {
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if (c.name === "RawDelim" || c.name === "RawLang") b.hide(c.from, c.to);
        }
      }
      return;
    }
    case "Equation":
      return equation(ctx, n, topLevel);
    case "ListItem": {
      const marker = n.firstChild;
      if (marker?.name === "ListMarker" && !b.touches(marker.from, marker.to + 1)) {
        b.widget(marker.from, marker.to, new BulletWidget(depth(n, "ListItem")));
      }
      return visitChildren(ctx, n, false);
    }
    case "EnumItem": {
      const marker = n.firstChild;
      if (marker?.name === "EnumMarker" && b.text(marker.from, marker.to) === "+" && !b.touches(marker.from, marker.to + 1)) {
        b.widget(marker.from, marker.to, new NumberWidget(enumIndex(n)));
      }
      return visitChildren(ctx, n, false);
    }
    case "TermItem": {
      const marker = n.firstChild;
      const term = marker?.nextSibling?.nextSibling;
      if (term?.name === "Markup") b.mark(term.from, term.to, "cm-lp-strong");
      if (marker && !b.touches(n.from, n.to)) b.hide(marker.from, spaceAfter(b, marker.to));
      return visitChildren(ctx, n, false);
    }
    case "Link":
      return b.url(n.from, n.to, b.text(n.from, n.to));
    case "Label":
      return b.mark(n.from, n.to, "cm-lp-label");
    case "Ref":
      return b.mark(n.from, n.to, "cm-lp-ref");
    case "Escape":
      if (!b.touches(n.from, n.to)) b.hide(n.from, n.from + 1);
      return;
    case "Linebreak":
      if (!b.touches(n.from, n.to)) b.mark(n.from, n.to, "cm-lp-dim");
      return;
    case "LineComment":
    case "BlockComment":
      return b.mark(n.from, n.to, "cm-lp-comment");
    default:
      return visitChildren(ctx, n, topLevel && (n.name === "Markup" || n.name === "Typst"));
  }
}

/** `#expr`: setup lines, styled text calls, or a rendered fragment. */
function code(ctx: Ctx, hash: SyntaxNode, expr: SyntaxNode, topLevel: boolean) {
  const { b } = ctx;
  const from = hash.from;
  const to = expr.to;
  if (SETUP.has(expr.name)) {
    b.mark(from, to, "cm-lp-setup-line");
    return;
  }
  // #strong[...] and friends: show the content, styled.
  if (expr.name === "FuncCall") {
    const callee = expr.firstChild;
    const args = expr.lastChild;
    const name = callee?.name === "Ident" ? b.text(callee.from, callee.to) : "";
    // `#name[...]` parses as FuncCall > Args > ContentBlock (no parentheses).
    const only = args?.name === "Args" ? args.firstChild : null;
    // (Lezer hands out fresh node objects, so compare positions, not identity.)
    const content = only?.name === "ContentBlock" && only.to === args?.to ? only : null;
    if (content && STYLE_CALLS[name]) {
      b.mark(content.from + 1, content.to - 1, STYLE_CALLS[name]);
      if (!b.touches(from, to)) {
        b.hide(from, content.from + 1);
        b.hide(content.to - 1, content.to);
      }
      const inner = content.firstChild?.nextSibling;
      if (inner?.name === "Markup") visitChildren(ctx, inner, false);
      return;
    }
  }
  const block = topLevel && b.wholeLines(from, to);
  fragment(ctx, from, to, block, b.text(from, to), expr);
}

function equation(ctx: Ctx, n: SyntaxNode, topLevel: boolean) {
  const { b } = ctx;
  const src = b.text(n.from, n.to);
  const display = src.length > 2 && /^\$\s/.test(src) && /\s\$$/.test(src);
  if (b.touches(n.from, n.to)) b.mark(n.from, n.to, "cm-lp-math-src");
  fragment(ctx, n.from, n.to, display && topLevel && b.wholeLines(n.from, n.to), src, n);
}

function fragment(ctx: Ctx, from: number, to: number, block: boolean, src: string, node: SyntaxNode) {
  const { b } = ctx;
  const kind = block ? "block" : "inline";
  const key = fragmentKey(ctx.noteDir, ctx.preamble, kind, src);
  b.wanted.push({ key, kind, code: src });
  collectFiles(b, node, ctx.noteDir);
  if (!b.touches(from, to)) {
    const w = new RenderWidget(key, src, block, from + 1);
    if (block) b.blockWidget(from, to, w);
    else b.widget(from, to, w);
  } else if (block) {
    b.mark(from, to, "cm-lp-code-src");
    b.below(to, new RenderWidget(key, src, true, -1));
  } else {
    b.mark(from, to, "cm-lp-code-src");
  }
}

/** Setup code used by every fragment: imports, set and show rules, lets. */
function collectPreamble(b: Builder, root: SyntaxNode, noteDir: string): string {
  const parts: string[] = [];
  for (let c = root.firstChild; c; c = c.nextSibling) {
    const expr = c.nextSibling;
    if (c.name !== "Hash" || !expr || !SETUP.has(expr.name)) continue;
    const text = b.text(expr.from, expr.to);
    // `#show: template` wraps the whole document (title pages, layout):
    // only Amber's own helper is safe to apply to fragments.
    if (expr.name === "ShowRule" && /^show\s*:/.test(text) && !/^show\s*:\s*amber\s*$/.test(text)) continue;
    parts.push(`#${text}`);
    if (expr.name === "ModuleImport") collectFiles(b, expr, noteDir);
  }
  return parts.join("\n");
}

function leadingSetup(root: SyntaxNode): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  for (let c = root.firstChild; c; c = c.nextSibling) {
    if (c.name === "Space" || c.name === "Parbreak" || c.name === "LineComment" || c.name === "BlockComment") continue;
    const expr = c.nextSibling;
    if (c.name === "Hash" && expr && SETUP.has(expr.name)) {
      if (from < 0) from = c.from;
      to = expr.to;
      c = expr;
      continue;
    }
    break;
  }
  return from < 0 ? null : { from, to };
}

/** Files a fragment may read (string literals that look like paths). */
function collectFiles(b: Builder, node: SyntaxNode, noteDir: string) {
  const cursor = node.cursor();
  do {
    if (cursor.name !== "Str") continue;
    const raw = b.text(cursor.from + 1, cursor.to - 1);
    if (!/^[^:]+\.[A-Za-z0-9]{1,5}$/.test(raw)) continue;
    const path = raw.startsWith("/") ? raw.slice(1) : joinPath(noteDir, raw);
    if (path) b.files.add(path);
  } while (cursor.next() && cursor.from < node.to);
}

function spaceAfter(b: Builder, pos: number) {
  return b.text(pos, pos + 1) === " " ? pos + 1 : pos;
}

function depth(n: SyntaxNode, name: string) {
  let d = 0;
  for (let p = n.parent; p; p = p.parent) if (p.name === name) d++;
  return d;
}

/** 1-based position among consecutive `+` items. */
function enumIndex(n: SyntaxNode) {
  let i = 1;
  for (let p = n.prevSibling; p; p = p.prevSibling) {
    if (p.name === "Space") continue;
    if (p.name !== "EnumItem") break;
    i++;
  }
  return i;
}
