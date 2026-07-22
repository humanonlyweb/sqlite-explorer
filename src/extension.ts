import * as vscode from "vscode";

import { SqliteEditorProvider } from "./sqliteEditorProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SqliteEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(SqliteEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sqliteExplorer.open", async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: "Open in SQLite Explorer",
        filters: { "SQLite databases": ["db", "sqlite", "sqlite3", "db3"], "All files": ["*"] },
      });
      if (picked && picked[0]) {
        await vscode.commands.executeCommand(
          "vscode.openWith",
          picked[0],
          SqliteEditorProvider.viewType,
        );
      }
    }),
  );
}

export function deactivate(): void {}
