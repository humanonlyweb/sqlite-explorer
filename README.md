# SQLite Explorer

[![CI](https://github.com/humanonlyweb/sqlite-explorer/actions/workflows/ci.yml/badge.svg)](https://github.com/humanonlyweb/sqlite-explorer/actions/workflows/ci.yml)

Browse, query, and edit SQLite databases directly in VS Code. Open any `.db` /
`.sqlite` / `.sqlite3` / `.db3` file and it opens in a fast, virtualized data
grid.

<img width="1966" height="1175" alt="Screenshot 2026-07-22 at 9 35 57 PM" src="https://github.com/user-attachments/assets/ecfcf426-f0c8-4241-afd7-91c3c4581468" />
<img width="1966" height="1175" alt="Screenshot 2026-07-22 at 9 36 11 PM" src="https://github.com/user-attachments/assets/b5aa05e6-a8be-4bd2-8b1d-1457f878cd05" />
<img width="1966" height="1175" alt="Screenshot 2026-07-22 at 9 36 59 PM" src="https://github.com/user-attachments/assets/77e303be-b6e3-432b-9883-0564110f59d9" />
<img width="1966" height="1175" alt="Screenshot 2026-07-22 at 9 36 34 PM" src="https://github.com/user-attachments/assets/a320288a-1d28-4e77-a824-74caddd1bd4a" />


## Features

- **Data grid** — DOM-virtualized (handles large tables), sortable columns,
  per-column filters, inline cell editing, a full-row edit modal, add/delete
  rows (with a confirmation step), and foreign-key links that jump to the
  referenced row.
- **Structure view** — columns (type, PK, not-null, default), indexes, and
  foreign keys.
- **SQL console** — run arbitrary SQL with `Cmd/Ctrl+Enter`; results render in
  the same grid (capped at 10,000 rows — export for the full set).
- **Export** — a whole table (honoring the active sort/filter), the selected
  rows, or a query result — as CSV, SQL inserts, or JSON (array or lines).
- **Read-only mode** — toggle to browse without any risk of writes.

> [!NOTE]
> Edits are written straight to the database file, so there is no separate "save"
> step. Enable read-only mode if you don't want that.

## Install

> [!IMPORTANT]
> **Not on the VS Code Marketplace yet.** I haven't been able to create and
> publish the extension on the Microsoft Marketplace, and I'm currently in
> contact with their support to resolve it. Until that's sorted, please build
> and install locally using the steps below.

Build a `.vsix` and install it:

```bash
bun install
bun run package                                # builds for your current OS/arch
code --install-extension release/sqlite-explorer-darwin-arm64-0.1.0.vsix
```

`bun run package` detects your platform and builds the matching `.vsix` into
`release/` (swap the filename above for the one it writes). Then reload VS Code
(or Extensions view → `⋯` → **Install from VSIX…**). See
[Packaging](#packaging) for other targets.

To just try it without installing, open the project and press **F5** (launches
an Extension Development Host with the extension loaded).

## Usage

- Open a database file from the Explorer, or run **"SQLite Explorer: Open
  Database…"** from the Command Palette.
- **Inline edit:** double-click a cell. `Enter` saves, `Esc` cancels,
  `Cmd/Ctrl+Enter` sets `NULL`.
- **Full-row edit:** select a row and choose **Edit row** — handy for wide
  tables or JSON-heavy columns where inline editing is fiddly.

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
bun run lint       # oxlint
```

> [!NOTE]
> I removed `vue-tsc` because at the moment, it doesn't work well with Typescript 7. Tracking [the issue](https://github.com/vuejs/language-tools/issues/5381).

Press **F5** to launch the Extension Development Host. Iterating on the webview:
`bun run watch:web` (Vite) alongside `bun run watch` (extension host).

### Layout

```
src/            extension host — DB engine, custom editor, message protocol
webview/        Vue 3 + Vite app 🔥 → dist/webview/
dist/           build output (extension.js + webview/)
```

The webview talks to the host over a typed `postMessage` protocol
(`src/protocol.ts`, shared via the `@shared` alias). `better-sqlite3` is a
native module loaded at runtime; it ships N-API prebuilds (ABI-stable across
Node and Electron), so no per-platform rebuild is needed.

### Packaging

`bun run package` writes a platform-specific `.vsix` to `release/`, vendoring
the one matching `better-sqlite3` prebuild so the package stays small and runs
without compilation. With no argument it builds for the current machine; pass
`all` to build every target (what the release workflow runs), or name specific
targets, e.g. `bun run package darwin-arm64 win32-x64`.

### AI Usage disclosure 🤖

I used Claude Code to help write some of the code in this project.
Specifically, in debugging better-sqlite3 while trying to package and in reviewing the code for `src/database.ts`.

## Acknowledgements

Icons are [VS Code Codicons](https://github.com/microsoft/vscode-codicons) by
Microsoft, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## License

MIT
