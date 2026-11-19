// App state and actions. Components read this and call its methods; only
// this module talks to the backend for vault/chest/note flows.
import { listen } from "@tauri-apps/api/event";
import { Channel } from "@tauri-apps/api/core";
import * as api from "./backend";
import type {
  AppInfo, ChestInfo, NoteFormat, NoteSummary, OpenedNote, TreeEntry, VaultView,
} from "./backend";
import { Engine } from "./engine";

const SAVE_DELAY_MS = 400;

export type Toast = {
  id: number;
  kind: "info" | "error";
  text: string;
  action?: { label: string; run: () => void };
};

export type EngineStatus = "stopped" | "starting" | "running" | "failed";

/** Per-device UI conveniences (never vault data). Failures are ignored. */
const local = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
};

class AppStore {
  info = $state<AppInfo | null>(null);
  /** True until the first vault decision is made (avoids a flash of the start screen). */
  booting = $state(true);
  vault = $state<VaultView | null>(null);
  chest = $state<ChestInfo | null>(null);
  tree = $state<TreeEntry[]>([]);
  notes = $state<NoteSummary[]>([]);
  note = $state<OpenedNote | null>(null);
  /** Bumped to rebuild the editor (another note, or a reload from disk). */
  editorKey = $state(0);
  /** Current editor text, for the Markdown preview. */
  liveText = $state("");
  engine = $state.raw<Engine | null>(null);
  engineStatus = $state<EngineStatus>("stopped");
  previewUrl = $state<string | null>(null);
  /** Folder selected in the tree; new notes go here. */
  selectedDir = $state<string | null>(null);
  linksVersion = $state(0);
  toasts = $state<Toast[]>([]);
  busy = $state<string | null>(null);

  private lastSaved = "";
  private pending: { path: string; text: string } | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private toastId = 0;
  private dark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  // ---- feedback -------------------------------------------------------

  toast(text: string, kind: Toast["kind"] = "info", action?: Toast["action"]) {
    const id = ++this.toastId;
    this.toasts.push({ id, kind, text, action });
    setTimeout(() => this.dismiss(id), kind === "error" ? 9000 : 4500);
  }

  dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  fail = (e: unknown) => {
    this.toast(e instanceof Error ? e.message : String(e), "error");
  };

  // ---- startup and vaults --------------------------------------------

  async boot() {
    try {
      await listen<{ paths: string[] }>("vault-changed", (e) => this.onVaultChanged(e.payload.paths));
      this.info = await api.appInfo();
      const recent = this.info.reopenLastVault ? this.info.recentVaults[0] : undefined;
      const first = this.info.startupVault ?? recent;
      if (first) await this.openVault(first, { quiet: !this.info.startupVault });
      // A quiet update check, once the app is up.
      if (this.info.autoCheckUpdates && this.info.canSelfUpdate) {
        setTimeout(() => void this.checkForUpdate(), 4000);
      }
    } finally {
      this.booting = false;
    }
  }

  // ---- updates ---------------------------------------------------------

  update = $state<api.UpdateInfo | null>(null);
  updateStatus = $state<"idle" | "checking" | "none" | "available" | "installing" | "error">("idle");
  updateError = $state<string | null>(null);

  async setAutoCheckUpdates(enabled: boolean) {
    await api.setAutoCheckUpdates(enabled);
    if (this.info) this.info.autoCheckUpdates = enabled;
  }

  /** Looks for a newer release; quietly unless `loud` (the Settings button). */
  async checkForUpdate(loud = false) {
    this.updateStatus = "checking";
    this.updateError = null;
    try {
      this.update = await api.checkUpdate();
      this.updateStatus = this.update ? "available" : "none";
      if (this.update && !loud) {
        this.toast(`Amber ${this.update.version} is available.`, "info", {
          label: "Update",
          run: () => void this.installUpdate(),
        });
      }
    } catch (e) {
      this.updateStatus = "error";
      this.updateError = e instanceof Error ? e.message : String(e);
      if (loud) this.fail(e);
    }
  }

  /** Saves, downloads the update (with progress) and restarts into it. */
  async installUpdate() {
    if (!this.update) return;
    if (!this.info?.canSelfUpdate) {
      this.toast("Updates install only in released builds of Amber.");
      return;
    }
    await this.flushSave();
    this.updateStatus = "installing";
    const progress = new Channel<api.UpdateProgress>();
    progress.onmessage = ({ downloaded, total }) => {
      this.busy = total
        ? `Downloading update… ${Math.round((downloaded / total) * 100)}%`
        : `Downloading update… ${(downloaded / 1e6).toFixed(1)} MB`;
    };
    try {
      await api.installUpdate(progress); // restarts Amber on success
    } catch (e) {
      this.updateStatus = "error";
      this.busy = null;
      this.fail(e);
    }
  }

  async setReopenLastVault(enabled: boolean) {
    await api.setReopenLastVault(enabled);
    if (this.info) this.info.reopenLastVault = enabled;
  }

  /** Back to the start screen (recent vaults, create, open, clone). */
  async switchVault() {
    await this.closeVault();
  }

  async openVault(path: string, opts: { quiet?: boolean } = {}) {
    await this.flushSave();
    try {
      const v = await api.openVault(path);
      this.closeChest();
      this.vault = v;
      this.info = await api.appInfo();
      if (!v.initialized) return; // the UI offers "Make this a vault"
      await this.startEngine();
      const pick =
        v.chests.find((c) => c.isChest && c.folder === v.lastChest) ??
        v.chests.find((c) => c.isChest);
      if (pick) await this.openChest(pick.folder);
    } catch (e) {
      if (opts.quiet) {
        // A recent vault that moved or was deleted: just show the welcome screen.
        this.vault = null;
      } else this.fail(e);
    }
  }

  async closeVault() {
    await this.flushSave();
    this.closeChest();
    this.vault = null;
    this.engine = null;
    this.engineStatus = "stopped";
    this.info = await api.appInfo().catch(() => this.info);
  }

  async initVault() {
    try {
      this.vault = await api.initVault();
      await this.startEngine();
    } catch (e) {
      this.fail(e);
    }
  }

  async refreshChests() {
    if (!this.vault) return;
    const chests = await api.listChests().catch(() => null);
    if (chests) this.vault.chests = chests;
  }

  // ---- chests ---------------------------------------------------------

  private closeChest() {
    this.chest = null;
    this.tree = [];
    this.notes = [];
    this.note = null;
    this.previewUrl = null;
    this.selectedDir = null;
  }

  async openChest(folder: string) {
    await this.flushSave();
    try {
      const view = await api.openChest(folder);
      this.closeChest();
      this.chest = view.info;
      this.tree = view.tree;
      this.notes = view.notes;
      const key = `amber:last-note:${this.vault?.root}:${folder}`;
      const last = local.get(key);
      const target = view.notes.find((n) => n.path === last) ?? view.notes[0];
      if (target) await this.openNote(target.path);
    } catch (e) {
      this.fail(e);
    }
  }

  async createChest(name: string, format: NoteFormat) {
    const info = await api.createChest(name, format);
    await this.refreshChests();
    await this.openChest(info.folder);
  }

  async makeChest(folder: string) {
    await api.makeChest(folder);
    await this.refreshChests();
    await this.openChest(folder);
  }

  async updateChest(update: api.ChestUpdate) {
    if (!this.chest) return;
    this.chest = await api.updateChest(this.chest.folder, update);
    await this.refreshChests();
  }

  /** Re-reads the tree and note list (after file operations). */
  async refreshChest() {
    if (!this.chest) return;
    const [tree, notes] = await Promise.all([api.tree(), api.noteList()]);
    this.tree = tree;
    this.notes = notes;
    this.linksVersion++;
  }

  // ---- Typst engine -----------------------------------------------------

  async startEngine() {
    if (!this.vault) return;
    this.engine = null;
    this.engineStatus = "starting";
    try {
      const engine = await Engine.start(this.vault.rootUri, () => {
        if (this.engine !== engine) return;
        this.engineStatus = "failed";
        this.engine = null;
        this.previewUrl = null;
      });
      this.engine = engine;
      this.engineStatus = "running";
      this.editorKey++; // attach the LSP client to the open editor
      if (this.note?.format === "typst") await this.startPreview();
    } catch (e) {
      this.engineStatus = "failed";
      this.fail(e);
    }
  }

  /** Whether the page view (Tinymist preview) is showing. */
  private previewWanted = false;

  /** Starts or stops Tinymist's page preview with the page-view panel. */
  async setPreviewWanted(wanted: boolean) {
    if (wanted === this.previewWanted) return;
    this.previewWanted = wanted;
    if (wanted) await this.startPreview();
    else {
      this.previewUrl = null;
      await this.engine?.stopPreview();
    }
  }

  // ---- writing view / "Show Typst" ----------------------------------------

  /** True when the open note shows its plain source ("Show Typst"). */
  sourceMode = $state(false);

  private sourceKey(path: string) {
    return `amber:source:${this.vault?.root}:${path}`;
  }

  toggleSource() {
    if (!this.note) return;
    this.sourceMode = !this.sourceMode;
    local.set(this.sourceKey(this.note.path), this.sourceMode ? "1" : "0");
  }

  private async startPreview() {
    const note = this.note;
    if (!this.previewWanted || !note || note.format !== "typst" || !this.engine) return;
    try {
      const url = await this.engine.startPreview(note.enginePath, this.dark);
      if (this.note?.path === note.path) this.previewUrl = url;
    } catch (e) {
      this.fail(e);
    }
  }

  // ---- notes ----------------------------------------------------------------

  async openNote(path: string) {
    await this.flushSave();
    try {
      const note = await api.openNote(path);
      this.note = note;
      this.lastSaved = note.text;
      this.liveText = note.text;
      this.previewUrl = null;
      this.sourceMode = local.get(this.sourceKey(path)) === "1";
      this.selectedDir = api.dirName(path);
      this.editorKey++;
      this.linksVersion++;
      if (this.vault && this.chest) {
        local.set(`amber:last-note:${this.vault.root}:${this.chest.folder}`, path);
      }
      if (note.format === "typst") await this.startPreview();
      else await this.engine?.stopPreview();
    } catch (e) {
      this.fail(e);
    }
  }

  onEdit = (text: string) => {
    if (!this.note) return;
    this.liveText = text;
    this.pending = { path: this.note.path, text };
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushSave(), SAVE_DELAY_MS);
  };

  async flushSave() {
    clearTimeout(this.saveTimer);
    const job = this.pending;
    this.pending = null;
    if (!job) return;
    try {
      await api.writeNote(job.path, job.text);
      if (this.note?.path === job.path) this.lastSaved = job.text;
      this.linksVersion++;
      void this.refreshNotesSoon();
    } catch (e) {
      this.fail(e);
    }
  }

  /** Titles can change while typing; refresh the list lazily. */
  private refreshNotesSoon() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(async () => {
      this.notes = await api.noteList().catch(() => this.notes);
    }, 1000);
  }

  /** Path for a new note named `name` (may include folders) in `dir`. */
  notePath(name: string, format: NoteFormat, dir?: string | null): string {
    const chest = this.chest!.folder;
    let clean = name.trim().replace(/^\/+/, "");
    if (!/\.(typ|md)$/.test(clean)) clean += `.${api.extOf(format)}`;
    const base = dir && dir.startsWith(chest) ? dir : chest;
    return `${base}/${clean}`;
  }

  async createNote(path: string, template?: string | null) {
    const created = await api.createNote(path, template);
    await this.refreshChest();
    await this.openNote(created);
  }

  async createFolder(path: string) {
    await api.createFolder(path);
    await this.refreshChest();
    this.selectedDir = path;
  }

  /** Renames; returns what could follow (links to update) for the caller to offer. */
  async rename(from: string, to: string): Promise<api.RenameResult> {
    await this.flushSave();
    const result = await api.renamePath(from, to);
    const open = this.note?.path;
    await this.refreshChest();
    if (open && (open === from || open.startsWith(`${from}/`))) {
      await this.openNote(to + open.slice(from.length));
    }
    return result;
  }

  async updateLinks(moves: [string, string][]) {
    await this.flushSave();
    const changed = await api.updateLinks(moves);
    await this.refreshChest();
    const open = this.note?.path;
    if (open && changed.includes(open)) await this.openNote(open);
    this.toast(`Updated links in ${changed.length} note${changed.length === 1 ? "" : "s"}`);
  }

  async trash(path: string) {
    await this.flushSave();
    await api.trashPath(path);
    const open = this.note?.path;
    if (open && (open === path || open.startsWith(`${path}/`))) {
      this.note = null;
      this.previewUrl = null;
      await this.engine?.stopPreview();
    }
    await this.refreshChest();
    this.toast(`Moved ${api.baseName(path)} to the trash`);
  }

  /** Opens the note a `[[link]]` points to, creating it if it is missing. */
  follow = async (target: string) => {
    if (!this.note || !this.chest) return;
    try {
      const resolved = await api.resolveLink(target, this.note.path);
      if (resolved) return await this.openNote(resolved);
      const path = this.notePath(target, this.chest.defaultFormat, this.chest.folder);
      await this.createNote(path);
      this.toast(`Created ${api.baseName(path)}`);
    } catch (e) {
      this.fail(e);
    }
  };

  async exportPdf() {
    const note = this.note;
    if (!note) return;
    await this.flushSave();
    this.busy = "Exporting PDF…";
    try {
      const out = await api.exportPdf(note.path);
      if (out) {
        this.toast(`Exported ${api.baseName(out.path)}`, "info", {
          label: "Show",
          run: () => void api.revealPath(out.path).catch(this.fail),
        });
        if (out.warnings.length) {
          this.toast(`The PDF is missing some parts:\n• ${out.warnings.join("\n• ")}`, "error");
        }
      }
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy = null;
    }
  }

  // ---- changes on disk ------------------------------------------------------

  private async onVaultChanged(paths: string[]) {
    if (!this.vault) return;
    if (paths.some((p) => !p.includes("/") || p.endsWith("/chest.toml"))) {
      await this.refreshChests();
    }
    const chest = this.chest?.folder;
    if (!chest || !paths.some((p) => p.startsWith(`${chest}/`))) return;
    await this.refreshChest().catch(() => {});
    const note = this.note;
    if (!note || !paths.includes(note.path)) return;
    try {
      const disk = await api.openNote(note.path);
      if (disk.text === this.lastSaved || disk.text === this.liveText) return;
      if (this.pending) {
        this.toast(`${api.baseName(note.path)} changed on disk; your unsaved edits will overwrite it.`, "error");
        return;
      }
      this.note = disk;
      this.lastSaved = disk.text;
      this.liveText = disk.text;
      this.editorKey++;
      this.toast(`Reloaded ${api.baseName(note.path)} (changed on disk)`);
    } catch {
      this.note = null;
      this.previewUrl = null;
      this.toast(`${api.baseName(note.path)} was deleted or moved`);
    }
  }
}

export const app = new AppStore();
