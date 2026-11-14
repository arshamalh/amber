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
  | { kind: "create-vault" }
  | { kind: "clone-vault" };

export type PaletteMode = "notes" | "commands" | "chests";

class UiStore {
  dialog = $state<Dialog | null>(null);
  palette = $state<PaletteMode | null>(null);
  sidebar = $state<"files" | "search">("files");
  sidebarOpen = $state(true);
  rightTab = $state<"preview" | "links">("preview");
  rightOpen = $state(true);
  /** Bumped to focus the search box. */
  searchFocus = $state(0);

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
