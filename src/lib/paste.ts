// Pasting images into a note: the image is saved into the chest's assets
// folder (named after the note and the time) and a reference is inserted.
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { NoteFormat } from "./backend";

const EXTS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export interface PasteOptions {
  format: NoteFormat;
  /** Saves the image; returns its path relative to the note. */
  save: (bytes: Uint8Array, ext: string, stamp: string) => Promise<string>;
  fail: (e: unknown) => void;
}

/** Local time as YYYYMMDD-HHMMSS. */
function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function pasteImages(opts: PasteOptions): Extension {
  return EditorView.domEventHandlers({
    paste(e, view) {
      const data = e.clipboardData;
      if (!data) return false;
      // Office apps put a picture of copied text on the clipboard too:
      // when there is text, paste the text.
      if (data.getData("text/plain").trim()) return false;
      const files = [...data.files].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return false;
      e.preventDefault();
      void insertImages(view, files, opts);
      return true;
    },
  });
}

async function insertImages(view: EditorView, files: File[], opts: PasteOptions) {
  const refs: string[] = [];
  const when = stamp();
  for (const f of files) {
    const ext = EXTS[f.type];
    if (!ext) {
      opts.fail(new Error(`Can't paste ${f.type} images. Use PNG, JPEG, GIF, WebP or SVG.`));
      continue;
    }
    try {
      const path = await opts.save(new Uint8Array(await f.arrayBuffer()), ext, when);
      refs.push(
        opts.format === "typst"
          ? `#figure(image("${path.replace(/["\\]/g, "\\$&")}"))`
          : `![](${encodeURI(path)})`,
      );
    } catch (e) {
      opts.fail(e);
    }
  }
  if (!refs.length) return;
  const { from, to } = view.state.selection.main;
  let text = refs.join("\n");
  // Typst figures are blocks: give them their own line.
  if (opts.format === "typst" && /\S/.test(view.state.sliceDoc(view.state.doc.lineAt(from).from, from))) {
    text = `\n${text}`;
  }
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: "input.paste",
    scrollIntoView: true,
  });
}
