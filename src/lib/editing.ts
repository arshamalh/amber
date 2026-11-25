// Small editing helpers shared by Typst and Markdown notes.
import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

const WRAP = ["`", "*", "_"];

/** Typing `, * or _ over a selection wraps it instead of replacing it. */
const wrapSelection = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (!WRAP.includes(text) || view.state.selection.ranges.every((r) => r.empty)) return false;
  view.dispatch(
    view.state.changeByRange((r) =>
      r.empty
        ? { changes: { from: r.from, insert: text }, range: EditorSelection.cursor(r.from + 1) }
        : {
            changes: [
              { from: r.from, insert: text },
              { from: r.to, insert: text },
            ],
            // Keep the word selected so typing * again makes **bold**.
            range: EditorSelection.range(r.from + 1, r.to + 1),
          },
    ),
    { userEvent: "input.type", scrollIntoView: true },
  );
  return true;
});

const LETTER_ITEM = /^(\s*)([a-zA-Z])([.)])(\s+)(.*)$/;

/** Enter on a lettered item (`a. text`) starts the next one (`b. `); on an empty one it ends the list. */
function continueLetterList(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const m = LETTER_ITEM.exec(line.text);
  if (!m) return false;
  const [, indent, letter, sep, space, rest] = m;
  const bodyFrom = line.from + indent.length + 2 + space.length;
  if (sel.head < bodyFrom) return false;
  if (!rest.trim()) {
    view.dispatch({ changes: { from: line.from + indent.length, to: line.to }, userEvent: "delete" });
    return true;
  }
  if (/z/i.test(letter)) return false;
  const insert = `\n${indent}${String.fromCharCode(letter.charCodeAt(0) + 1)}${sep} `;
  view.dispatch({
    changes: { from: sel.head, insert },
    selection: { anchor: sel.head + insert.length },
    userEvent: "input",
    scrollIntoView: true,
  });
  return true;
}

export const editingHelpers: Extension = [wrapSelection, Prec.high(keymap.of([{ key: "Enter", run: continueLetterList }]))];
