// The "/" menu: insert blocks without knowing Typst or Markdown syntax.
// Every item writes plain source text; nothing is hidden or proprietary.
import { snippet, startCompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { NoteFormat } from "../backend";

interface Block {
  label: string;
  /** Extra words the "/" query matches, e.g. "line hr" for /line or /hr. */
  aliases?: string;
  detail: string;
  /** Snippet template (`${}` / `${name}` are fields); `\n` breaks lines. */
  typst?: string;
  markdown?: string;
  /** Inserted on its own line(s). */
  line?: boolean;
  /** Needs a file chosen first (images). */
  pickFile?: boolean;
  /** Open completion again after inserting (e.g. note names after `[[`). */
  reopen?: boolean;
}

const BLOCKS: Block[] = [
  { label: "Heading 1", detail: "Big section title", typst: "= ${Heading}", markdown: "# ${Heading}", line: true },
  { label: "Heading 2", detail: "Section title", typst: "== ${Heading}", markdown: "## ${Heading}", line: true },
  { label: "Heading 3", detail: "Subsection title", typst: "=== ${Heading}", markdown: "### ${Heading}", line: true },
  { label: "Bulleted list", detail: "• item", typst: "- ${}", markdown: "- ${}", line: true },
  { label: "Numbered list", detail: "1. item", typst: "+ ${}", markdown: "1. ${}", line: true },
  { label: "To-do list", detail: "☐ task", markdown: "- [ ] ${}", line: true },
  { label: "Term and definition", detail: "Term: description", typst: "/ ${Term}: ${Description}", line: true },
  { label: "Quote", detail: "Quoted block", typst: "#quote(block: true)[${Quote}]", markdown: "> ${Quote}", line: true },
  {
    label: "Callout",
    detail: "Highlighted box",
    typst: "#block(fill: luma(94%), inset: 10pt, radius: 4pt, width: 100%)[${Note}]",
    markdown: "> **Note:** ${}",
    line: true,
  },
  { label: "Maths block", detail: "Display equation", typst: "$ ${x^2} $", markdown: "$$\n${x^2}\n$$", line: true },
  { label: "Inline maths", detail: "Maths in a sentence", typst: "$${x}$", markdown: "$${x}$" },
  { label: "Code block", detail: "Code with highlighting", typst: "```${lang}\n${}\n```", markdown: "```${lang}\n${}\n```", line: true },
  {
    label: "Table",
    detail: "Rows and columns",
    typst: "#table(\n  columns: 2,\n  table.header([${Column}], [Column]),\n  [${}], [],\n)",
    markdown: "| ${Column} | Column |\n| --- | --- |\n|  |  |",
    line: true,
  },
  { label: "Image", detail: "From your computer or the vault", pickFile: true, line: true },
  { label: "Link to note", detail: "[[Note]]", typst: "[[${}]]", markdown: "[[${}]]", reopen: true },
  { label: "Web link", detail: "https://…", typst: '#link("${https://}")[${text}]', markdown: "[${text}](${https://})" },
  { label: "Footnote", detail: "Note at the page bottom", typst: "#footnote[${}]", markdown: "[^${1}]" },
  {
    label: "Horizontal line",
    aliases: "line divider hr rule separator",
    detail: "A line across the page",
    typst: "#line(length: 100%)",
    // `***`, not `---`: under a paragraph `---` would turn it into a heading.
    markdown: "***",
    line: true,
  },
  { label: "Page break", detail: "Start a new page in the PDF", typst: "#pagebreak()", line: true },
  { label: "Table of contents", detail: "Outline of headings", typst: "#outline()", line: true },
];

const NO_MENU = /^(Raw|Str|Code|CodeBlock|Args|Math|Equation|LineComment|BlockComment|InlineCode|FencedCode|CodeText|URL)$/;

export interface SlashOptions {
  format: NoteFormat;
  /** Asks for an image; returns its path relative to the note, or null. */
  pickImage: () => Promise<string | null>;
}

export function slashMenu(opts: SlashOptions): Extension {
  const source = (ctx: CompletionContext) => {
    // "/" at the start of a line or after a space; "/ " (a Typst term) and "//" close it.
    const m = ctx.matchBefore(/(?:^|\s)\/[\p{L}\p{N}]*$/u);
    if (!m) return null;
    const slash = m.from + m.text.indexOf("/");
    for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(ctx.state).resolveInner(slash, -1); n; n = n.parent) {
      if (NO_MENU.test(n.name)) return null;
    }
    const options: Completion[] = BLOCKS.filter((blk) => blk.pickFile || blk[opts.format]).map((blk) => ({
      // Matching uses `label`; `displayLabel` is what the menu shows.
      // Aliases first, so "/line" is a prefix match and beats "Inline maths".
      label: blk.aliases ? `${blk.aliases} ${blk.label}` : blk.label,
      displayLabel: blk.label,
      detail: blk.detail,
      type: "keyword",
      boost: 0,
      apply: (view: EditorView, _c: Completion, _from: number, to: number) => void insert(view, blk, slash, to, opts),
    }));
    return { from: slash + 1, options, validFor: /^[\p{L}\p{N}]*$/u, filter: true };
  };
  return EditorState.languageData.of(() => [{ autocomplete: source }]);
}

async function insert(view: EditorView, blk: Block, from: number, to: number, opts: SlashOptions) {
  let template = blk[opts.format] ?? "";
  if (blk.pickFile) {
    // Remove the "/query" first so a cancelled dialog leaves no trace.
    view.dispatch({ changes: { from, to } });
    to = from;
    const path = await opts.pickImage();
    if (!path) return;
    const lit = path.replace(/["\\]/g, "\\$&");
    template = opts.format === "typst" ? `#figure(image("${lit}"), caption: [\${Caption}])` : `![\${alt}](${encodeURI(path)})`;
  }
  const line = view.state.doc.lineAt(from);
  if (blk.line && /\S/.test(view.state.sliceDoc(line.from, from))) template = `\n${template}`;
  snippet(template)(view, { label: blk.label }, from, to);
  if (blk.reopen) startCompletion(view);
}
