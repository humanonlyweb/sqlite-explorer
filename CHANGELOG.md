# Changelog

## 0.2.1

### Fixed

- **Sidebar no longer grows past the window on databases with many tables.**
  The table list now scrolls within its own pane, with the database header
  pinned above it, instead of squeezing every row down to fit or overflowing
  the viewport.

## 0.2.0

### Added

- **Undo/redo for grid edits.** `Cmd/Ctrl+Z` reverts a cell edit, row edit, insert
  or delete; `Cmd/Ctrl+Shift+Z` redoes it, with matching toolbar buttons. Because
  writes go straight to disk, an undo is a compensating write rather than a
  rollback — it does not cover statements run from the SQL console.
- **Delete confirmation states the real blast radius.** Before deleting, the
  dialog reports how many rows in other tables a cascade or trigger will take
  with it, and whether the delete is undoable. A cascading delete is never
  offered as undoable, since restoring only the rows we captured would look
  successful while leaving the cascaded ones gone.
- **Table definition in the Structure tab.** Shows the original `CREATE TABLE` /
  `CREATE VIEW` statement as stored by SQLite.
- **External change detection.** If another process writes to the database, the
  view reloads itself instead of silently showing stale rows. Edit history is
  discarded at that point, since the captured rowids may no longer refer to the
  same rows.

### Fixed

- **Column filters treated `%` and `_` as wildcards.** Filtering for `user_id`
  also matched `userXid`, and a filter of `%` matched every row. Filter text is
  now matched literally.

### Internal

- Serialization and SQL helpers split into `src/serialize.ts` and `src/sql.ts`.
- Test suite added (`bun run test`, Node's built-in runner) covering escaping,
  export formats and the undo round-trip, and wired into CI.
