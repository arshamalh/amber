# 0004. In-memory chest index (Tantivy in RAM, link graph in maps)

Date: 2026-11-14 · Status: accepted

## Context

Phase 1 needs full-text search, backlinks and `[[link]]` resolution, all scoped to the open chest. The plan names Tantivy + SQLite in the app cache dir. Chests keep the indexed set small: one project, not a whole vault.

## Decision

- When a chest opens, Rust reads every note in it once and builds a `ChestIndex` (`src-tauri/src/index.rs`):
  - a Tantivy index created **in RAM** (title boosted, prefix matching so results appear while typing);
  - a map of note → title and parsed `[[links]]`, used for backlinks, outgoing links and resolution.
- The file watcher and Amber's own writes update the index per note. Folder moves trigger a full rebuild of that chest's index.
- Nothing is written to disk, so nothing can end up in the vault, and there is no cache to invalidate.
- SQLite is deferred.

## Alternatives

- **Tantivy + SQLite on disk in the cache dir:** faster reopen for huge chests, but needs change detection (mtimes, hashes), migrations and cache cleanup. Not worth it before a chest is big enough to feel slow.
- **Plain substring search:** no ranking and slow past a few thousand notes.

## Consequences

- Opening a chest costs one read of its notes. For thousands of notes this is well under a second; tens of thousands would need the on-disk index.
- Moving to an on-disk index later only changes `index.rs`; commands and UI stay the same.
