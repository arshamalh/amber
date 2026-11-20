// A stand-in for Amber's Rust core, for recording the demo video in a plain
// browser. It answers the commands the demo uses from demo/vault on disk,
// renders Typst with the real bundled Tinymist, and bridges the Typst
// engine (LSP) over Vite's dev-server socket. Read-only: edits stay in the
// browser, so every recording starts from the same vault.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Plugin } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const VAULT = join(ROOT, "demo/vault");
const CHEST = "Physics";
const TINYMIST = join(ROOT, "src-tauri/binaries", readdirSync(join(ROOT, "src-tauri/binaries")).find((f) => /^tinymist-[^.]+$/.test(f))!);

const isNote = (p: string) => /\.(typ|md)$/.test(p);
const formatOf = (p: string) => (p.endsWith(".md") ? "markdown" : "typst");
const base = (p: string) => p.split("/").pop()!;
const stem = (p: string) => base(p).replace(/\.(typ|md)$/, "");

function walk(dir = CHEST): string[] {
  return readdirSync(join(VAULT, dir)).flatMap((name) => {
    if (name.startsWith(".") || name === "chest.toml") return [];
    const rel = `${dir}/${name}`;
    return statSync(join(VAULT, rel)).isDirectory() ? [rel, ...walk(rel)] : [rel];
  });
}

const read = (rel: string) => readFileSync(join(VAULT, rel), "utf8");
const title = (rel: string) => /^(?:=|#)\s+(.+)$/m.exec(read(rel))?.[1] ?? stem(rel);
const notes = () => walk().filter(isNote).map((path) => ({ path, title: title(path) }));
const tree = () =>
  walk().map((path) => ({
    path,
    kind: statSync(join(VAULT, path)).isDirectory() ? "dir" : isNote(path) ? "note" : "file",
    format: isNote(path) ? formatOf(path) : null,
  }));
const chestInfo = { folder: CHEST, name: CHEST, icon: null, color: null, defaultFormat: "typst", template: null, isChest: true };

function resolve(target: string): string | null {
  const want = target.trim().toLowerCase();
  return walk().find((p) => !p.endsWith("/") && (base(p).toLowerCase() === want || stem(p).toLowerCase() === want)) ?? null;
}

const LINK = /\[\[([^[\]\n]+)\]\]/g;
const linkTarget = (inner: string) => inner.split("|")[0].split(/\\?#/)[0].trim();

// ---- Typst fragments: the same document as src-tauri/src/typst/render.rs ----

function document(preamble: string, fragments: { kind: string; code: string }[]): string {
  let src =
    "#show ref: it => if query(it.target).len() == 0 { text(fill: luma(110), str(it.target)) } else { it }\n" +
    preamble +
    "\n#set text(size: 11.25pt)\n#set par(justify: false)\n";
  for (const f of fragments) {
    if (/^\s*#page[([]/.test(f.code)) {
      src += `${f.code}\n`;
      continue;
    }
    const width = f.kind === "block" ? "500pt" : "auto";
    src += `#page(width: ${width}, height: auto, margin: (x: 1pt, y: 3pt), fill: none, header: none, footer: none, numbering: none, background: none, foreground: none)[\n${f.code}\n]\n`;
  }
  return src;
}

function compile(source: string) {
  const work = join(VAULT, ".render");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, "out"), { recursive: true });
  writeFileSync(join(work, "main.typ"), source);
  const run = spawnSync(TINYMIST, ["compile", "--ignore-system-fonts", "--root", VAULT, join(work, "main.typ"), join(work, "out/{0p}.svg")], { encoding: "utf8" });
  if (run.status !== 0) return { error: (/error: (.*)/.exec(run.stderr)?.[1] ?? "render failed").trim() };
  return {
    pages: readdirSync(join(work, "out"))
      .sort()
      .map((f) => {
        const svg = readFileSync(join(work, "out", f), "utf8");
        const head = svg.slice(0, svg.indexOf(">"));
        const attr = (n: string) => parseFloat(new RegExp(`${n}="([\\d.]+)`).exec(head)?.[1] ?? "0");
        return { svg, widthPt: attr("width"), heightPt: attr("height"), error: null };
      }),
  };
}

function renderFragments(preamble: string, fragments: { kind: string; code: string }[]) {
  const all = compile(document(preamble, fragments));
  if (all.pages?.length === fragments.length) return all.pages;
  return fragments.map((f) => {
    const one = compile(document(preamble, [f]));
    return one.pages?.length === 1 ? one.pages[0] : { svg: null, widthPt: 0, heightPt: 0, error: one.error ?? "more than one page" };
  });
}

// ---- commands ---------------------------------------------------------------

type Args = Record<string, any>;
const commands: Record<string, (a: Args) => unknown> = {
  app_info: () => ({
    gitAvailable: true,
    recentVaults: [VAULT],
    reopenLastVault: true,
    autoCheckUpdates: false,
    appVersion: "0.1.5",
    canSelfUpdate: false,
    startupVault: VAULT,
    tinymistVersion: "0.15.12",
  }),
  open_vault: () => ({ name: "Notebook", root: VAULT, rootUri: pathToFileURL(VAULT).href, initialized: true, chests: [chestInfo], lastChest: CHEST }),
  list_chests: () => [chestInfo],
  open_chest: () => ({ info: chestInfo, tree: tree(), notes: notes() }),
  tree: () => tree(),
  note_list: () => notes(),
  open_note: ({ path }) => ({ path, format: formatOf(path), text: read(path), uri: pathToFileURL(join(VAULT, path)).href, enginePath: join(VAULT, path) }),
  resolve_link: ({ target }) => resolve(target),
  backlinks: ({ path }) =>
    notes()
      .filter((n) => n.path !== path)
      .flatMap((n) =>
        read(n.path)
          .split("\n")
          .filter((line) => [...line.matchAll(LINK)].some((m) => resolve(linkTarget(m[1])) === path))
          .map((line) => ({ path: n.path, title: n.title, context: line.trim() })),
      ),
  outgoing_links: ({ path }) => [...read(path).matchAll(LINK)].map((m) => ({ target: linkTarget(m[1]), resolved: resolve(linkTarget(m[1])) })),
  render_fragments: ({ preamble, fragments }) => renderFragments(preamble, fragments),
  templates: () => [],
  search: () => [],
  render_markdown: () => "",
};

// ---- the Typst engine (LSP), bridged over the dev server's socket ------------

function lspBridge(server: Parameters<NonNullable<Plugin["configureServer"]>>[0]) {
  let proc: ChildProcess | null = null;
  let buf = Buffer.alloc(0);
  server.ws.on("demo:lsp-start", () => {
    proc?.kill();
    buf = Buffer.alloc(0);
    proc = spawn(TINYMIST, ["lsp"], { cwd: VAULT });
    proc.stdout!.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) return;
        const len = Number(/content-length: *(\d+)/i.exec(buf.subarray(0, end).toString())?.[1]);
        if (buf.length < end + 4 + len) return;
        server.ws.send("demo:lsp-msg", { data: buf.subarray(end + 4, end + 4 + len).toString("utf8") });
        buf = buf.subarray(end + 4 + len);
      }
    });
    proc.stderr!.on("data", () => {}); // Tinymist logs here
  });
  server.ws.on("demo:lsp-send", ({ data }: { data: string }) => {
    proc?.stdin!.write(`Content-Length: ${Buffer.byteLength(data)}\r\n\r\n${data}`);
  });
}

export function demoBackend(): Plugin {
  return {
    name: "amber-demo-backend",
    configureServer(server) {
      lspBridge(server);
      server.middlewares.use("/__demo/", (req, res) => {
        const url = new URL(req.url ?? "", "http://x");
        if (url.pathname.startsWith("/file")) {
          // Raw files (the PDF viewer), confined to the vault.
          const rel = url.searchParams.get("path") ?? "";
          if (rel.split("/").includes("..")) return void res.writeHead(403).end();
          return void res.end(readFileSync(join(VAULT, rel)));
        }
        const cmd = url.pathname.replace(/^\/invoke\//, "");
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const handler = commands[cmd];
            const out = handler ? handler(body ? JSON.parse(body) : {}) : null;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(out ?? null));
          } catch (e) {
            res.writeHead(500).end(String(e));
          }
        });
      });
    },
  };
}

