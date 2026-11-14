// A small Typst highlighter for CodeMirror. Completion, diagnostics and
// hover come from Tinymist; this only colours the source.
import { StreamLanguage, type StringStream } from "@codemirror/language";

interface State {
  blockComment: number;
  math: boolean;
  /** Paren/bracket depth inside a `#code(...)` expression. */
  code: number;
  /** Inside a `#let`/`#set`/`#show`... statement until the line ends. */
  stmt: boolean;
}

const KEYWORDS = new Set([
  "let", "set", "show", "import", "include", "if", "else", "for", "in",
  "while", "return", "break", "continue", "context", "none", "auto",
  "true", "false", "and", "or", "not", "as",
]);

function codeToken(stream: StringStream, state: State): string | null {
  if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
  if (stream.match(/^\d+(\.\d+)?(pt|mm|cm|in|em|fr|%|deg|rad)?/)) return "number";
  if (stream.match(/^[A-Za-z_][\w-]*/)) {
    const word = stream.current();
    if (KEYWORDS.has(word)) return "keyword";
    return stream.peek() === "(" || stream.peek() === "[" ? "variableName.function" : "variableName";
  }
  const ch = stream.next();
  if (ch === "(" || ch === "{") state.code++;
  else if (ch === ")" || ch === "}") state.code = Math.max(0, state.code - 1);
  return null;
}

export const typst = StreamLanguage.define<State>({
  name: "typst",
  startState: () => ({ blockComment: 0, math: false, code: 0, stmt: false }),
  copyState: (s) => ({ ...s }),
  token(stream, state) {
    if (stream.sol()) state.stmt = false;
    if (state.blockComment > 0) {
      while (!stream.eol()) {
        if (stream.match("*/")) {
          state.blockComment--;
          if (state.blockComment === 0) break;
        } else if (stream.match("/*")) state.blockComment++;
        else stream.next();
      }
      return "comment";
    }
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.blockComment = 1;
      return "comment";
    }
    if (state.code > 0 || state.stmt) return codeToken(stream, state);

    if (state.math) {
      if (stream.eat("$")) {
        state.math = false;
        return "atom";
      }
      stream.eatWhile(/[^$\\]/);
      if (stream.eat("\\")) stream.next();
      return "atom";
    }
    if (stream.eat("$")) {
      state.math = true;
      return "atom";
    }

    if (stream.sol() && stream.match(/^\s*=+\s.*/)) return "heading";
    if (stream.sol() && stream.match(/^\s*([-+]|\/)\s/)) return "keyword";
    if (stream.match(/^\[\[[^\]]+\]\]/)) return "link";
    if (stream.match(/^#(let|set|show|import|include|if|for|while|context)\b/)) {
      state.stmt = true;
      return "keyword";
    }
    if (stream.match(/^#[A-Za-z_][\w.-]*/)) return "variableName.function";
    if (stream.match(/^`[^`]*`?/)) return "string";
    if (stream.match(/^<[\w.:-]+>/)) return "labelName";
    if (stream.match(/^@[\w.:-]+/)) return "labelName";
    if (stream.match(/^\*[^*\n]+\*/)) return "strong";
    if (stream.match(/^_[^_\n]+_/)) return "emphasis";
    if (stream.match(/^\\./)) return "escape";
    if (stream.peek() === "(" && state.code === 0 && /[\w.]$/.test(stream.string.slice(0, stream.pos))) {
      return codeToken(stream, state);
    }
    stream.next();
    stream.eatWhile(/[^\s#$*_`<@\\[/(]/);
    return null;
  },
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  },
});
