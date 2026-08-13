# SQLite Explorer

[![CI](https://github.com/humanonlyweb/sqlite-explorer/actions/workflows/ci.yml/badge.svg)](https://github.com/humanonlyweb/sqlite-explorer/actions/workflows/ci.yml)

Browse, query, and edit SQLite databases in VS Code. Supported extensions are
`.db`, `.sqlite`, `.sqlite3`, and `.db3`.

<img width="1966" height="1175" alt="Screenshot 2026-07-22 at 9 35 57 PM" src="https://github.com/user-attachments/assets/ecfcf426-f0c8-4241-afd7-91c3c4581468" />

## Features

- **Data grid** — virtualized rows, sorting, filters, editing, inserts, deletes,
  and foreign-key navigation.
- **Structure view** — columns, indexes, foreign keys, and `CREATE` SQL.
- **SQL console** — run arbitrary SQL with `Cmd/Ctrl+Enter`; results render in
  the data grid, capped at 10,000 rows.
- **Export** — CSV, SQL inserts, JSON, or JSON Lines.
- **Undo/redo** — compensating writes for reversible grid mutations.
- **Read-only mode** — browse without writes.

> [!NOTE]
> Edits are written straight to the database file, so there is no separate "save"
> step. Enable read-only mode if you don't want that.

## Install

SQLite Explorer is distributed through
[GitHub Releases](https://github.com/humanonlyweb/sqlite-explorer/releases).
Download the `.vsix` for your OS and architecture, then run:

```bash
code --install-extension sqlite-explorer-<platform>-<version>.vsix
```

Alternatively, use Extensions → `…` → **Install from VSIX…**.
VSIX installations do not receive GitHub release updates automatically; install
newer versions the same way.

## Usage

- Open a database file from the Explorer, or run **"SQLite Explorer: Open
  Database…"** from the Command Palette.
- **Inline edit:** double-click a cell. `Enter` saves, `Esc` cancels,
  `Cmd/Ctrl+Enter` sets `NULL`.
- **Full-row edit:** select one row and choose **Edit row**.
- **Undo/redo:** `Cmd/Ctrl+Z` reverts the last grid edit, insert or delete;
  `Cmd/Ctrl+Shift+Z` redoes it. Edits are written to disk immediately, so an
  undo is a compensating write — it doesn't cover SQL run from the console.
- **Structure tab** shows columns, foreign keys, indexes, and the original
  `CREATE` statement.

External database writes reload the view and clear undo history.

## Settings

| Setting                   | Default | Description               |
| ------------------------- | ------- | ------------------------- |
| `sqliteExplorer.pageSize` | `1000`  | Rows fetched per page.    |
| `sqliteExplorer.readOnly` | `false` | Open databases read-only. |

## Development

Requires [Bun](https://bun.sh) and VS Code.

```bash
bun install        # install deps (better-sqlite3 ships prebuilt binaries — no compile step)
bun run build      # bundle extension host (Rolldown) + webview (Vite)
bun run typecheck  # tsc for the extension host + vue-tsc for the webview SFCs
bun run test       # node:test — escaping, export formats, undo round-trip
bun run lint       # oxlint
```

`sample.db` contains filtering, quoting, NULL, BLOB, large-integer, and
`WITHOUT ROWID` edge cases.

`webview/` is a Bun workspace; one root `bun install` covers both packages.

> [!NOTE]
> `vue-tsc` works under TypeScript 7 via
> [typescript-native-bridge](https://github.com/johnsoncodehk/typescript-native-bridge).

Press **F5** to launch the Extension Development Host. For watch mode, run
`bun run watch:web` and `bun run watch`.

### Layout

```
src/            extension host — DB engine, custom editor, message protocol
webview/        Vue 3 + Vite app (workspace) → dist/webview/
dist/           build output (extension.js + webview/)
```

`bunfig.toml` uses Bun's hoisted linker so packaging can vendor the correct
`better-sqlite3` N-API prebuild.

### Packaging

`bun run package` writes a platform-specific `.vsix` to `release/`, vendoring
the one matching `better-sqlite3` prebuild so the package stays small and runs
without compilation. With no argument it builds for the current machine; pass
`all` to build every target (what the release workflow runs), or name specific
targets, e.g. `bun run package darwin-arm64 win32-x64`.

### AI usage disclosure

Claude Code assisted with `better-sqlite3` packaging and review of
`src/database.ts`.

## Acknowledgements

Icons are [VS Code Codicons](https://github.com/microsoft/vscode-codicons) by
Microsoft, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## License

MIT
