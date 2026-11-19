// User-facing actions shared by the tree, the palette, menus and shortcuts.
import { app } from "./app.svelte";
import { ui } from "./ui.svelte";
import * as api from "./backend";

const chestRel = (path: string) => path.slice((app.chest?.folder.length ?? 0) + 1);

export function newNote(dir: string | null = app.selectedDir) {
  if (!app.chest) return;
  ui.open({ kind: "new-note", dir });
}

export function newFolder(dir: string | null = app.selectedDir) {
  const chest = app.chest?.folder;
  if (!chest) return;
  const prefix = dir && dir !== chest && dir.startsWith(`${chest}/`) ? `${chestRel(dir)}/` : "";
  ui.open({
    kind: "prompt",
    title: "New folder",
    label: "Folder name (slashes create subfolders)",
    value: prefix,
    submit: "Create",
    onsubmit: (v) => app.createFolder(`${chest}/${v.replace(/^\/+|\/+$/g, "")}`),
  });
}

export function rename(path: string, isDir: boolean) {
  const chest = app.chest?.folder;
  if (!chest) return;
  ui.open({
    kind: "prompt",
    title: `Rename ${isDir ? "folder" : "file"}`,
    label: "New path inside the chest. Links to it are not updated yet.",
    value: chestRel(path),
    submit: "Rename",
    selectStem: !isDir,
    onsubmit: async (v) => {
      const to = `${chest}/${v.replace(/^\/+|\/+$/g, "")}`;
      if (to === path) return;
      const result = await app.rename(path, to);
      if (result.links > 0) offerLinkUpdate(result, isDir ? null : api.stem(to));
    },
  });
}

/** Moves a note, file or folder into `targetDir` (drag and drop). */
export async function move(path: string, isDir: boolean, targetDir: string) {
  const to = `${targetDir}/${api.baseName(path)}`;
  try {
    const result = await app.rename(path, to);
    const where = targetDir === app.chest?.folder ? "the top level" : api.baseName(targetDir);
    app.toast(`Moved ${api.baseName(path)}${isDir ? " (folder)" : ""} to ${where}`);
    if (result.links > 0) offerLinkUpdate(result, isDir ? null : api.stem(to));
  } catch (e) {
    app.fail(e);
  }
}

/** After a rename: ask whether links to the old name should follow. */
function offerLinkUpdate(result: api.RenameResult, newName: string | null) {
  const one = result.links === 1;
  const links = `${result.links} link${one ? "" : "s"}`;
  const notes = `${result.notes} note${result.notes === 1 ? "" : "s"}`;
  // A single renamed note: name it. A folder move: say "new location".
  const where = newName ? `“${newName}”` : "the new location";
  // Open after the rename dialog has closed.
  queueMicrotask(() =>
    ui.open({
      kind: "confirm",
      title: "Update links?",
      text: `${links} in ${notes} ${one ? "points" : "point"} to the old ${newName ? "name" : "location"}. Update ${one ? "it" : "them"} to point to ${where}?`,
      submit: "Update links",
      cancel: "Keep old links",
      onsubmit: () => app.updateLinks(result.moves),
    }),
  );
}

export function trash(path: string, isDir: boolean) {
  ui.open({
    kind: "confirm",
    title: "Move to trash?",
    text: `"${chestRel(path)}"${isDir ? " and everything in it" : ""} will be moved to the system trash.`,
    submit: "Move to trash",
    danger: true,
    onsubmit: () => app.trash(path),
  });
}

export function newChest() {
  if (!app.vault) return;
  ui.open({ kind: "new-chest" });
}

export function openVault() {
  void api.pickFolder("Open a vault").then((p) => {
    if (p) void app.openVault(p);
  }, app.fail);
}

export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  when?: () => boolean;
  run: () => void;
}

const mod = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+";

export const commands: Command[] = [
  { id: "note.new", title: "New note", shortcut: `${mod}N`, when: () => !!app.chest, run: () => newNote() },
  { id: "folder.new", title: "New folder", when: () => !!app.chest, run: () => newFolder() },
  { id: "note.open", title: "Go to note…", shortcut: `${mod}P`, when: () => !!app.chest, run: () => (ui.palette = "notes") },
  { id: "search", title: "Search in chest", shortcut: `${mod}⇧F`, when: () => !!app.chest, run: () => ui.showSearch() },
  { id: "note.export", title: "Export note as PDF", shortcut: `${mod}E`, when: () => !!app.note, run: () => void app.exportPdf() },
  { id: "note.rename", title: "Rename note…", when: () => !!app.note, run: () => rename(app.note!.path, false) },
  { id: "note.trash", title: "Move note to trash…", when: () => !!app.note, run: () => trash(app.note!.path, false) },
  { id: "note.reveal", title: "Show note in file manager", when: () => !!app.note, run: () => void api.revealVaultPath(app.note!.path).catch(app.fail) },
  { id: "chest.switch", title: "Switch chest…", shortcut: `${mod}⇧O`, when: () => !!app.vault?.initialized, run: () => (ui.palette = "chests") },
  { id: "chest.new", title: "New chest…", when: () => !!app.vault?.initialized, run: newChest },
  { id: "chest.settings", title: "Chest settings…", when: () => !!app.chest, run: () => ui.open({ kind: "chest-settings" }) },
  { id: "view.sidebar", title: "Toggle sidebar", shortcut: `${mod}\\`, run: () => (ui.sidebarOpen = !ui.sidebarOpen) },
  {
    id: "view.source",
    title: "Switch Writing / Source",
    shortcut: `${mod}⇧T`,
    when: () => !!app.note,
    run: () => app.toggleSource(),
  },
  { id: "view.preview", title: "Page view (how it prints)", when: () => !!app.note, run: () => ((ui.rightOpen = true), (ui.rightTab = "preview")) },
  { id: "view.links", title: "Show links and backlinks", when: () => !!app.note, run: () => ((ui.rightOpen = true), (ui.rightTab = "links")) },
  { id: "view.right", title: "Toggle right panel", run: () => (ui.rightOpen = !ui.rightOpen) },
  { id: "settings", title: "Settings…", shortcut: `${mod},`, run: () => ui.open({ kind: "settings" }) },
  { id: "vault.switch", title: "Switch vault…", when: () => !!app.vault, run: () => void app.switchVault() },
  { id: "vault.open", title: "Open another vault…", run: openVault },
  { id: "vault.create", title: "Create a vault…", run: () => ui.open({ kind: "create-vault" }) },
  { id: "vault.clone", title: "Clone a vault…", when: () => !!app.info?.gitAvailable, run: () => ui.open({ kind: "clone-vault" }) },
  { id: "vault.close", title: "Close vault", when: () => !!app.vault, run: () => void app.closeVault() },
  { id: "engine.restart", title: "Restart Typst engine", when: () => !!app.vault?.initialized, run: () => void app.startEngine() },
];
