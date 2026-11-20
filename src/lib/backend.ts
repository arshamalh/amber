// Typed wrappers around the Rust core's commands. The UI reaches files only
// through these. Paths are vault-relative with `/` separators.
import { Channel, invoke } from "@tauri-apps/api/core";

export type NoteFormat = "typst" | "markdown";

export interface AppInfo {
  gitAvailable: boolean;
  recentVaults: string[];
  reopenLastVault: boolean;
  autoCheckUpdates: boolean;
  /** This build's version, e.g. "0.0.6". */
  appVersion: string;
  /** False in development builds (they must not replace themselves). */
  canSelfUpdate: boolean;
  startupVault: string | null;
  tinymistVersion: string;
}

export interface ChestInfo {
  folder: string;
  name: string;
  icon: string | null;
  color: string | null;
  defaultFormat: NoteFormat;
  /** Vault-relative template path from chest.toml, if set. */
  template: string | null;
  /** False for first-level folders without a chest.toml yet. */
  isChest: boolean;
}

export interface VaultView {
  name: string;
  root: string;
  rootUri: string;
  initialized: boolean;
  chests: ChestInfo[];
  lastChest: string | null;
}

export interface TreeEntry {
  path: string;
  kind: "dir" | "note" | "file";
  format: NoteFormat | null;
}

export interface NoteSummary {
  path: string;
  title: string;
}

export interface ChestView {
  info: ChestInfo;
  tree: TreeEntry[];
  notes: NoteSummary[];
}

export interface OpenedNote {
  path: string;
  format: NoteFormat;
  text: string;
  /** LSP document URI. */
  uri: string;
  /** Absolute path, only for passing to the Typst engine. */
  enginePath: string;
}

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
}

export interface Backlink {
  path: string;
  title: string;
  context: string;
}

export interface OutLink {
  target: string;
  resolved: string | null;
}

export interface RenameResult {
  /** Every note that moved: [old path, new path]. */
  moves: [string, string][];
  /** Links pointing to the old names that could be updated. */
  links: number;
  /** Notes containing those links. */
  notes: number;
}

export interface ExportResult {
  path: string;
  /** Parts the PDF could not include. */
  warnings: string[];
}

export interface ChestUpdate {
  name: string;
  defaultFormat: NoteFormat;
  template: string | null;
}

export const appInfo = () => invoke<AppInfo>("app_info");
export const pickFolder = (title?: string) => invoke<string | null>("pick_folder", { title });

export const openVault = (path: string) => invoke<VaultView>("open_vault", { path });
export const initVault = () => invoke<VaultView>("init_vault");
export const createVault = (parent: string, name: string, git: boolean) =>
  invoke<string>("create_vault", { parent, name, git });
export const cloneVault = (url: string, parent: string) =>
  invoke<string>("clone_vault", { url, parent });
export const forgetVault = (path: string) => invoke<void>("forget_vault", { path });
export const setAutoCheckUpdates = (enabled: boolean) =>
  invoke<void>("set_auto_check_updates", { enabled });

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

/** Asks GitHub Releases whether a newer Amber exists. */
export const checkUpdate = () => invoke<UpdateInfo | null>("check_update");
/** Downloads, verifies and installs the found update, then restarts Amber. */
export const installUpdate = (progress: Channel<UpdateProgress>) =>
  invoke<void>("install_update", { progress });

export const setReopenLastVault = (enabled: boolean) =>
  invoke<void>("set_reopen_last_vault", { enabled });

export const listChests = () => invoke<ChestInfo[]>("list_chests");
export const createChest = (name: string, format: NoteFormat) =>
  invoke<ChestInfo>("create_chest", { name, format });
export const makeChest = (folder: string) => invoke<ChestInfo>("make_chest", { folder });
export const renameChest = (folder: string, name: string) => invoke<ChestInfo>("rename_chest", { folder, name });
export const deleteChest = (folder: string) => invoke<void>("delete_chest", { folder });
export const pickChestFolder = () => invoke<ChestInfo | null>("pick_chest_folder");
export const updateChest = (folder: string, update: ChestUpdate) =>
  invoke<ChestInfo>("update_chest", { folder, update });
export const openChest = (folder: string) => invoke<ChestView>("open_chest", { folder });

export const tree = () => invoke<TreeEntry[]>("tree");
export const noteList = () => invoke<NoteSummary[]>("note_list");
export const openNote = (path: string) => invoke<OpenedNote>("open_note", { path });
export const writeNote = (path: string, content: string) =>
  invoke<void>("write_note", { path, content });
export const createNote = (path: string, template?: string | null) =>
  invoke<string>("create_note", { path, template: template ?? null });
export const createFolder = (path: string) => invoke<void>("create_folder", { path });
export const renamePath = (from: string, to: string) =>
  invoke<RenameResult>("rename_path", { from, to });
export const updateLinks = (moves: [string, string][]) =>
  invoke<string[]>("update_links", { moves });
export const trashPath = (path: string) => invoke<void>("trash_path", { path });

export const resolveLink = (target: string, from: string) =>
  invoke<string | null>("resolve_link", { target, from });
export const backlinks = (path: string) => invoke<Backlink[]>("backlinks", { path });
export const outgoingLinks = (path: string) => invoke<OutLink[]>("outgoing_links", { path });
export const search = (query: string) => invoke<SearchHit[]>("search", { query });
export const renderMarkdown = (text: string) => invoke<string>("render_markdown", { text });
export const templates = () => invoke<string[]>("templates");

export const exportPdf = (path: string) => invoke<ExportResult | null>("export_pdf", { path });
export const revealPath = (path: string) => invoke<void>("reveal_path", { path });
export const revealVaultPath = (path: string) => invoke<void>("reveal_vault_path", { path });
export const openExternal = (url: string) => invoke<void>("open_external", { url });
/** Asks for an image; returns its path relative to the note (copied into the chest if needed). */
/** Raw bytes of a file in the open chest (the PDF viewer). */
export const readFile = (path: string) => invoke<ArrayBuffer>("read_file", { path });
/** Writes a file dropped in from outside to `path` (vault path); returns where it went. */
export const importFile = (path: string, bytes: Uint8Array) =>
  invoke<string>("import_file", bytes, { headers: { "x-path": encodeURIComponent(path) } });
export const pasteAsset = (note: string, bytes: Uint8Array, ext: string, stamp: string) =>
  invoke<string>("paste_asset", bytes, {
    headers: { "x-note": encodeURIComponent(note), "x-ext": ext, "x-stamp": stamp },
  });
export const importAsset = (note: string) => invoke<string | null>("import_asset", { note });

// ---- path helpers (pure string work, no file access) ----

export const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const dirName = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export const isNotePath = (p: string) => /\.(typ|md)$/i.test(p);
export const stem = (p: string) => baseName(p).replace(/\.(typ|md)$/, "");
export const extOf = (f: NoteFormat) => (f === "typst" ? "typ" : "md");

/** Joins `rel` onto `dir`, resolving `.` and `..`. Returns null if it climbs out. */
export function joinPath(dir: string, rel: string): string | null {
  const parts = dir ? dir.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}
