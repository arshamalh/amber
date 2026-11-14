// The UI side of the Typst engine: an LSP transport over Tauri IPC, the
// CodeMirror LSP client on top of it, and Tinymist's live preview.
import { Channel, invoke } from "@tauri-apps/api/core";
import { LSPClient, languageServerExtensions, type Transport } from "@codemirror/lsp-client";

type EngineEvent = { kind: "message"; data: string } | { kind: "exit" };

const PREVIEW_TASK = "amber-preview";

export class Engine {
  readonly client: LSPClient;
  private handlers = new Set<(msg: string) => void>();
  /** Serializes sends so LSP messages reach the server in order. */
  private queue: Promise<unknown> = Promise.resolve();
  private previewing = false;

  private constructor(
    rootUri: string,
    readonly version: string,
    private onExit: () => void,
  ) {
    this.client = new LSPClient({
      rootUri,
      timeout: 15_000,
      extensions: languageServerExtensions(),
    });
  }

  /** Starts Tinymist for the open vault and connects the LSP client. */
  static async start(rootUri: string, onExit: () => void): Promise<Engine> {
    const channel = new Channel<EngineEvent>();
    let engine: Engine | null = null;
    channel.onmessage = (ev) => {
      if (ev.kind === "message") engine?.handlers.forEach((h) => h(ev.data));
      else engine?.onExit();
    };
    const version = await invoke<string>("engine_start", { channel });
    engine = new Engine(rootUri, version, onExit);
    engine.client.connect(engine.transport());
    await engine.client.initializing;
    return engine;
  }

  private transport(): Transport {
    return {
      send: (message) => {
        this.queue = this.queue
          .then(() => invoke("engine_send", { message }))
          .catch((e) => console.error("[amber] engine_send failed", e));
      },
      subscribe: (h) => this.handlers.add(h),
      unsubscribe: (h) => this.handlers.delete(h),
    };
  }

  /**
   * Starts Tinymist's preview server for one note and returns the URL to
   * show. Any earlier preview is stopped first.
   */
  async startPreview(enginePath: string, dark: boolean): Promise<string> {
    await this.stopPreview();
    const result = await this.client.request<
      { command: string; arguments: unknown[] },
      { staticServerPort?: number } | null
    >("workspace/executeCommand", {
      command: "tinymist.doStartPreview",
      arguments: [
        [
          "--task-id", PREVIEW_TASK,
          "--data-plane-host", "127.0.0.1:0",
          "--invert-colors", dark ? "always" : "never",
          "--no-open",
          enginePath,
        ],
      ],
    });
    if (!result?.staticServerPort) throw new Error("Tinymist did not start a preview server");
    this.previewing = true;
    return `http://127.0.0.1:${result.staticServerPort}/`;
  }

  async stopPreview(): Promise<void> {
    if (!this.previewing) return;
    this.previewing = false;
    await this.client
      .request("workspace/executeCommand", {
        command: "tinymist.doKillPreview",
        arguments: [PREVIEW_TASK],
      })
      .catch(() => {});
  }
}
