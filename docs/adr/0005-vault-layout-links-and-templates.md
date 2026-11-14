# 0005. Vault layout, `[[links]]` in Typst, and templates

Date: 2026-11-14 · Status: accepted

## Context

Phase 1 adds vaults, chests, wiki links and templates. Typst has no wiki-link syntax, and a note must still compile with the plain `typst` CLI on any machine.

## Decision

- **Vault:** a folder with `amber.toml`. **Chest:** a first-level folder with `chest.toml`. Folders starting with `.` or `_` are never chests. Opening a folder without `amber.toml` asks before adding one; nothing is written silently.
- **`_shared/`** holds `amber.typ` (Amber's Typst helpers) and `templates/`. These are ordinary, visible, editable files. Amber writes them only when a vault is created or initialised, and never overwrites them.
- **Links in Typst notes:** `[[Note]]` is plain text in Typst markup. `_shared/amber.typ` provides `amber`, a show rule that styles `[[...]]` as a link. Templates start with:

  ```typst
  #import "/_shared/amber.typ": *
  #show: amber
  ```

  Tinymist and PDF export use the vault as the Typst root, so `/_shared/...` resolves the same everywhere. Removing those two lines turns the styling off for a note.
- **Link syntax:** `[[Target]]`, `[[Target|Label]]`, `[[Target#Heading]]`. In Typst `#` starts code, so the heading form is `[[Target\#Heading]]` there. Links in code, raw blocks and comments are ignored.
- **Resolution** (`src-tauri/src/links.rs`): by file name without extension, case-insensitive, inside the open chest only. Ties prefer the linking note's folder, then the shortest path. `[[folder/Name]]` matches by path suffix. Following a missing link creates the note in the chest root.
- **Templates:** a new note uses `template` from `chest.toml` when its format matches, else `_shared/templates/note.<ext>`, else a bare heading. `{{title}}` and `{{date}}` are filled in.
- **Git:** the system `git` binary, so existing SSH keys and credential helpers work. Prompts are disabled (`GIT_TERMINAL_PROMPT=0`, SSH `BatchMode`), so a missing credential fails with a message instead of hanging.

## Alternatives

- **A Typst package installed into the user's Typst data dir (`@local/amber`):** cleaner imports, but notes would not compile on a machine without Amber.
- **`#link(<...>)` or a custom function for links:** valid Typst, but far noisier to type than `[[...]]` and unlike Obsidian.
- **git2 (libgit2):** no external binary, but SSH and credential-helper support is weaker and it adds OpenSSL to the build.

## Consequences

- `_` or `*` inside a link target in a Typst note (`[[my_note]]`) still triggers Typst's emphasis syntax. Use spaces or hyphens in note names, or escape with `\_`.
- Renaming a note does not update links to it yet.
- The PDF export of a note matches what the plain `typst` CLI produces with `--root <vault>`.
