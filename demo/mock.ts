// Runs before Amber's UI in the demo page: answers Tauri calls through the
// demo backend (demo/backend.ts) instead of the Rust core.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Channel } from "@tauri-apps/api/core";

mockWindows("main");

let engine: Channel<unknown> | null = null;
import.meta.hot!.on("demo:lsp-msg", ({ data }: { data: string }) => engine?.onmessage({ kind: "message", data }));

mockIPC(
  async (cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    if (cmd === "engine_start") {
      engine = a.channel as Channel<unknown>;
      import.meta.hot!.send("demo:lsp-start", {});
      return "0.15.12";
    }
    if (cmd === "engine_send") return void import.meta.hot!.send("demo:lsp-send", { data: a.message });
    if (cmd === "read_file") return (await fetch(`/__demo/file?path=${encodeURIComponent(String(a.path))}`)).arrayBuffer();
    if (cmd === "app_info") {
      // Open the demo on its main note.
      const info = await call(cmd, a);
      localStorage.setItem(`amber:last-note:${info.startupVault}:Physics`, "Physics/Reading Feynman.typ");
      return info;
    }
    return call(cmd, a);
  },
  { shouldMockEvents: true },
);

async function call(cmd: string, args: unknown) {
  const res = await fetch(`/__demo/invoke/${cmd}`, { method: "POST", body: JSON.stringify(args) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
