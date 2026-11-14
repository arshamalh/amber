// Typed wrappers around the Rust core's commands. The UI reaches files only
// through these.
import { invoke } from "@tauri-apps/api/core";

export type NoteFormat = "typst" | "markdown";

export interface VaultInfo {
  name: string;
  rootUri: string;
}

export interface Note {
  /** Vault-relative path with `/` separators. */
  path: string;
  format: NoteFormat;
  /** LSP document URI. */
  uri: string;
  /** Absolute path, only for passing to the Typst engine. */
  enginePath: string;
}

export const pickVault = () => invoke<string | null>("pick_vault");
export const openVault = (path: string) => invoke<VaultInfo>("open_vault", { path });
export const listNotes = () => invoke<Note[]>("list_notes");
export const readNote = (path: string) => invoke<string>("read_note", { path });
export const writeNote = (path: string, content: string) =>
  invoke<void>("write_note", { path, content });

/** A vault to open on launch (CLI argument or $AMBER_VAULT), if any. */
export const startupVault = () => invoke<string | null>("startup_vault");
