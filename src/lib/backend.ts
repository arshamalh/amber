// Typed wrappers around the Rust core's commands. The UI reaches files only
// through these. Paths are vault-relative with `/` separators.
import { invoke } from "@tauri-apps/api/core";

export type NoteFormat = "typst" | "markdown";

export interface AppInfo {
  gitAvailable: boolean;
  recentVaults: string[];
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

export const listChests = () => invoke<ChestInfo[]>("list_chests");
export const createChest = (name: string) => invoke<ChestInfo>("create_chest", { name });
export const makeChest = (folder: string) => invoke<ChestInfo>("make_chest", { folder });
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
export const renamePath = (from: string, to: string) => invoke<void>("rename_path", { from, to });
export const trashPath = (path: string) => invoke<void>("trash_path", { path });

export const resolveLink = (target: string, from: string) =>
  invoke<string | null>("resolve_link", { target, from });
export const backlinks = (path: string) => invoke<Backlink[]>("backlinks", { path });
export const outgoingLinks = (path: string) => invoke<OutLink[]>("outgoing_links", { path });
export const search = (query: string) => invoke<SearchHit[]>("search", { query });
export const renderMarkdown = (text: string) => invoke<string>("render_markdown", { text });
export const templates = () => invoke<string[]>("templates");

export const exportPdf = (path: string) => invoke<string | null>("export_pdf", { path });
export const revealPath = (path: string) => invoke<void>("reveal_path", { path });
export const revealVaultPath = (path: string) => invoke<void>("reveal_vault_path", { path });
export const openExternal = (url: string) => invoke<void>("open_external", { url });

// ---- path helpers (pure string work, no file access) ----

export const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const dirName = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
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
