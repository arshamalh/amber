# 0008. Note format is chosen per chest

Date: 2026-11-19 · Status: accepted

## Context

A note's format is its file extension (`.typ` or `.md`). The New note dialog asked for a format every time, which made a deliberate project-level choice feel like a per-note chore. A strict one-format-per-chest rule was also considered.

## Decision

- **The chest decides the format of new notes** (`default_format` in `chest.toml`). It is chosen when a chest is created, with **Typst preselected and marked recommended**. A new vault starts empty: creating it opens "Create your first chest", and only that first chest gets a Welcome note (in its format). A vault can mix Typst and Markdown chests.
- **Existing folders pick automatically.** "Make it a chest" uses the format most of the folder's notes already use, and Typst on a tie or an empty folder, so an Obsidian folder becomes a Markdown chest without asking.
- **No strict rule.** Notes of the other format still open, link and export normally. The New note dialog no longer asks; format and template are behind "More options".
- The view switch in the header is named **Writing | Source**: the writing view of ADR 0007, or the plain text.

## Alternatives

- **Markdown as the default:** more portable, but most of Amber's purpose (maths, figures, diagrams, books) needs Typst.
- **Strictly one format per chest:** simpler, but Amber doesn't control what lands in the folder (clones, copies, synced files), and conversions lose content.

## Consequences

- Changing a chest's format later only affects new notes; existing notes keep theirs until converted (a convert command is still to come).
