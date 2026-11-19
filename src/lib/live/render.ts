// Client for Typst fragment rendering (maths, `#function(...)` blocks).
// Fragments are cached by content; missing ones are batched to the Rust
// core, which renders them with the bundled Tinymist (ADR 0007).
import { invoke } from "@tauri-apps/api/core";

export type FragmentKind = "inline" | "block";

export interface Fragment {
  key: string;
  kind: FragmentKind;
  code: string;
}

export interface Rendered {
  /** A data: URL of the SVG, ready for an <img>. */
  src?: string;
  widthPx: number;
  heightPx: number;
  error?: string;
}

interface RawRendered {
  svg: string | null;
  widthPt: number;
  heightPt: number;
  error: string | null;
}

/** cyrb53: a fast, well-distributed 53-bit string hash. */
export function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Cache key: the same code renders differently with another preamble or folder. */
export function fragmentKey(noteDir: string, preamble: string, kind: FragmentKind, code: string) {
  return hash(`${noteDir}\u0000${preamble}\u0000${kind}\u0000${code}`);
}

const PT_TO_PX = 4 / 3;
const MAX_CACHE = 2000;

const cache = new Map<string, Rendered>();

export function cached(key: string): Rendered | undefined {
  return cache.get(key);
}

function remember(key: string, value: Rendered) {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
}

/**
 * Batches render requests for one note. `want` is called with every
 * fragment the editor shows; only uncached ones are sent.
 */
export class Renderer {
  private queued = new Map<string, Fragment>();
  private inflight = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private preamble = "";
  private files: string[] = [];
  private destroyed = false;

  constructor(
    private note: string,
    private onRendered: () => void,
  ) {}

  want(preamble: string, files: string[], fragments: Fragment[]) {
    this.preamble = preamble;
    this.files = files;
    for (const f of fragments) {
      if (!cache.has(f.key) && !this.inflight.has(f.key)) this.queued.set(f.key, f);
    }
    if (this.queued.size) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.flush(), 180);
    }
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
  }

  private async flush() {
    if (this.destroyed || !this.queued.size) return;
    const batch = [...this.queued.values()];
    this.queued.clear();
    batch.forEach((f) => this.inflight.add(f.key));
    try {
      const out = await invoke<RawRendered[]>("render_fragments", {
        note: this.note,
        preamble: this.preamble,
        fragments: batch.map((f) => ({ kind: f.kind, code: f.code })),
        files: this.files,
      });
      batch.forEach((f, i) => {
        const r = out[i];
        remember(f.key, {
          src: r?.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}` : undefined,
          widthPx: (r?.widthPt ?? 0) * PT_TO_PX,
          heightPx: (r?.heightPt ?? 0) * PT_TO_PX,
          error: r?.error ?? (r?.svg ? undefined : "not rendered"),
        });
      });
    } catch (e) {
      // Leave them uncached so a later edit retries.
      console.error("[amber] render failed", e);
    } finally {
      batch.forEach((f) => this.inflight.delete(f.key));
    }
    if (!this.destroyed) this.onRendered();
  }
}
