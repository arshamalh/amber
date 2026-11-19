// PDF.js, loaded on first use (it is large). The viewer component reads
// `globalThis.pdfjsLib`, so the core library is set up before it loads.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type PdfjsLib = typeof import("pdfjs-dist");
type PdfjsViewer = typeof import("pdfjs-dist/web/pdf_viewer.mjs");

let loading: Promise<{ lib: PdfjsLib; viewer: PdfjsViewer }> | null = null;

export function loadPdfjs() {
  loading ??= (async () => {
    // Older system web views (WebKit before Safari 17.4) lack this.
    const P = Promise as unknown as { withResolvers?: unknown };
    P.withResolvers ??= function <T>() {
      let resolve!: (v: T) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
      return { promise, resolve, reject };
    };
    const lib = await import("pdfjs-dist");
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    (globalThis as { pdfjsLib?: PdfjsLib }).pdfjsLib = lib;
    const viewer = await import("pdfjs-dist/web/pdf_viewer.mjs");
    await import("pdfjs-dist/web/pdf_viewer.css");
    return { lib, viewer };
  })();
  return loading;
}

/** Fonts and character maps for PDFs that don't embed them (see vite.config.ts). */
export const PDF_DATA = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
};

/** The page in a link fragment such as `page=12`, or null. */
export function pageOf(fragment: string | null | undefined): number | null {
  const m = fragment?.match(/^page=(\d+)$/);
  return m ? Math.max(1, Number(m[1])) : null;
}

/** Splits a link destination (`paper.pdf#page=3`, `Note\#Heading`) into target and fragment. */
export function splitDest(dest: string): { target: string; fragment: string | null } {
  const m = dest.match(/^(.*?)\\?#(.*)$/);
  return m ? { target: m[1].trim(), fragment: m[2].trim() || null } : { target: dest.trim(), fragment: null };
}
