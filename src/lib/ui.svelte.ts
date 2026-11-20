// Which dialog, palette or panel is showing. Pure UI state.

export type Dialog =
  | {
      kind: "prompt";
      title: string;
      label: string;
      value: string;
      submit: string;
      /** Selects the part before the extension when the dialog opens. */
      selectStem?: boolean;
      onsubmit: (value: string) => Promise<void>;
    }
  | {
      kind: "confirm";
      title: string;
      text: string;
      submit: string;
      cancel?: string;
      danger?: boolean;
      onsubmit: () => Promise<void>;
    }
  | { kind: "settings" }
  | { kind: "new-note"; dir: string | null }
  | { kind: "chest-settings" }
  | { kind: "new-chest"; first?: boolean }
  | { kind: "delete-chest"; folder: string; name: string }
  | { kind: "create-vault" }
  | { kind: "clone-vault" };

export type PaletteMode = "notes" | "commands" | "chests";

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

class UiStore {
  dialog = $state<Dialog | null>(null);
  palette = $state<PaletteMode | null>(null);
  sidebar = $state<"files" | "search">("files");
  sidebarOpen = $state(true);
  /** Pane widths in px, set by dragging the dividers. `rightWidth` 0 = half. */
  sidebarWidth = $state(Number(readLocal("amber:sidebar-width")) || 240);
  rightWidth = $state(Number(readLocal("amber:right-width")) || 0);
  rightTab = $state<"preview" | "links" | "pdf">("preview");
  /** The side panel (page view / links) starts closed: writing comes first. */
  rightOpen = $state(false);
  /** Bumped to focus the search box. */
  searchFocus = $state(0);

  saveWidths() {
    try {
      localStorage.setItem("amber:sidebar-width", String(this.sidebarWidth));
      localStorage.setItem("amber:right-width", String(this.rightWidth));
    } catch {
      /* storage unavailable */
    }
  }

  open(d: Dialog) {
    this.palette = null;
    this.dialog = d;
  }

  close() {
    this.dialog = null;
  }

  showSearch() {
    this.sidebarOpen = true;
    this.sidebar = "search";
    this.searchFocus++;
  }
}

export const ui = new UiStore();
