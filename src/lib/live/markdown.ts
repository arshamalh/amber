// Writing-view rules for Markdown notes, over @lezer/markdown's tree.
import { ensureSyntaxTree } from "@codemirror/language";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { SyntaxNode } from "@lezer/common";
import { joinPath } from "../backend";
import { Builder, wikiLinks } from "./context";
import { BulletWidget, CheckboxWidget, ChipWidget, ImageWidget, RuleWidget } from "./widgets";

const NO_WIKI = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText", "HTMLBlock", "HTMLTag", "Comment"]);

export function buildMarkdown(b: Builder, notePath: string) {
  const tree = ensureSyntaxTree(b.state, b.state.doc.length, 200);
  if (!tree) return;
  const noteDir = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";

  // YAML front matter folds into a chip.
  const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(b.state.doc.toString());
  if (fm) {
    const end = fm[0].replace(/\r?\n$/, "").length;
    if (!b.touches(0, end)) b.blockWidget(0, end, new ChipWidget("Properties", 0));
  }

  const visit = (n: SyntaxNode) => {
    const name = n.name;
    const heading = /^ATXHeading(\d)$/.exec(name);
    if (heading) {
      b.line(n.from, `cm-lp-h${heading[1]}`);
      const mark = n.firstChild;
      if (mark?.name === "HeaderMark" && !b.touches(n.from, n.to)) {
        b.hide(mark.from, b.text(mark.to, mark.to + 1) === " " ? mark.to + 1 : mark.to);
      }
    } else if (/^SetextHeading(\d)$/.test(name)) {
      b.line(n.from, `cm-lp-h${name.slice(-1)}`);
    } else if (name === "Emphasis" || name === "StrongEmphasis" || name === "Strikethrough") {
      b.mark(n.from, n.to, name === "Emphasis" ? "cm-lp-emph" : name === "StrongEmphasis" ? "cm-lp-strong" : "cm-lp-strike");
      if (!b.touches(n.from, n.to)) hideMarks(b, n, /Mark$/);
    } else if (name === "InlineCode") {
      b.mark(n.from, n.to, "cm-lp-code");
      if (!b.touches(n.from, n.to)) hideMarks(b, n, /^CodeMark$/);
      return;
    } else if (name === "FencedCode" || name === "CodeBlock") {
      b.lines(n.from, n.to, "cm-lp-codeblock");
      if (name === "FencedCode") {
        b.line(n.from, "cm-lp-fence");
        b.line(n.to, "cm-lp-fence");
      }
      return;
    } else if (name === "Link") {
      // `[[x]]` parses as a link inside brackets; wiki handling covers it.
      if (b.text(n.from - 1, n.from) === "[" && b.text(n.to, n.to + 1) === "]") return;
      link(b, n);
      return;
    } else if (name === "Image") {
      image(b, n, noteDir);
      return;
    } else if (name === "URL" && n.parent?.name !== "Link" && n.parent?.name !== "Image") {
      b.url(n.from, n.to, b.text(n.from, n.to));
    } else if (name === "ListMark") {
      const list = n.parent?.parent?.name;
      const isTask = n.nextSibling?.name === "Task";
      if (isTask && !b.touches(n.from, n.to + 1)) {
        // A to-do item shows just its checkbox.
        b.hide(n.from, b.text(n.to, n.to + 1) === " " ? n.to + 1 : n.to);
      } else if (list === "BulletList" && !b.touches(n.from, n.to + 1)) {
        let depth = 0;
        for (let p = n.parent?.parent?.parent; p; p = p.parent) if (p.name === "BulletList") depth++;
        b.widget(n.from, n.to, new BulletWidget(depth));
      }
    } else if (name === "TaskMarker") {
      if (!b.touches(n.from, n.to)) {
        const checked = /x/i.test(b.text(n.from, n.to));
        b.widget(n.from, n.to, new CheckboxWidget(checked, n.from));
        const textFrom = b.text(n.to, n.to + 1) === " " ? n.to + 1 : n.to;
        if (checked) b.mark(textFrom, n.parent!.to, "cm-lp-done");
      }
    } else if (name === "Blockquote") {
      b.lines(n.from, n.to, "cm-lp-quote");
    } else if (name === "QuoteMark") {
      const line = b.state.doc.lineAt(n.from);
      if (!b.touches(line.from, line.to)) b.hide(n.from, b.text(n.to, n.to + 1) === " " ? n.to + 1 : n.to);
    } else if (name === "HorizontalRule") {
      if (!b.touches(n.from, n.to)) b.blockWidget(n.from, n.to, new RuleWidget());
      return;
    } else if (name === "Escape") {
      if (!b.touches(n.from, n.to)) b.hide(n.from, n.from + 1);
    } else if (name === "HTMLTag" || name === "Comment" || name === "HTMLBlock") {
      b.mark(n.from, n.to, "cm-lp-comment");
      return;
    }
    for (let c = n.firstChild; c; c = c.nextSibling) visit(c);
  };
  visit(tree.topNode);

  wikiLinks(b, (pos) => {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) {
      if (NO_WIKI.has(n.name)) return true;
    }
    return false;
  });
}

function hideMarks(b: Builder, n: SyntaxNode, re: RegExp) {
  for (let c = n.firstChild; c; c = c.nextSibling) if (re.test(c.name)) b.hide(c.from, c.to);
}

/** `[text](url)`: show the text as a link. */
function link(b: Builder, n: SyntaxNode) {
  const marks: SyntaxNode[] = [];
  let url = "";
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.name === "LinkMark") marks.push(c);
    if (c.name === "URL") url = b.text(c.from, c.to);
  }
  if (marks.length < 2) return;
  const textFrom = marks[0].to;
  const textTo = marks[1].from;
  if (url) b.url(textFrom, textTo, url, n.from, n.to);
  else b.mark(textFrom, textTo, "cm-lp-url");
  if (!b.touches(n.from, n.to)) {
    b.hide(n.from, textFrom);
    b.hide(textTo, n.to);
  }
}

function image(b: Builder, n: SyntaxNode, noteDir: string) {
  if (b.touches(n.from, n.to)) return;
  let url = "";
  let alt = "";
  const marks: SyntaxNode[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.name === "URL") url = b.text(c.from, c.to);
    if (c.name === "LinkMark") marks.push(c);
  }
  if (marks.length >= 2) alt = b.text(marks[0].to, marks[1].from);
  let src: string | null = null;
  if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    const path = joinPath(noteDir, decodeURIComponent(url));
    if (path) src = convertFileSrc(path, "amberfile");
  }
  const w = new ImageWidget(src, alt, n.from + 2);
  if (b.wholeLines(n.from, n.to)) b.blockWidget(n.from, n.to, w);
  else b.widget(n.from, n.to, w);
}
