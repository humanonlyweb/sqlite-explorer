import { randomBytes } from "node:crypto";
import * as path from "path";

import * as vscode from "vscode";

import { SqliteDatabase } from "./database.ts";
import type { DatabaseSchema, InboundMessage, OutboundMessage, TableSchema } from "./protocol.ts";
import { dateStamp, formatForPath, serializeRows, slugify, type ExportRow } from "./serialize.ts";

const CASCADE_NOTE =
  "Deleted rows in other tables too (ON DELETE CASCADE or a trigger), so this can't be undone.";

class SqliteDocument implements vscode.CustomDocument {
  readonly uri: vscode.Uri;
  readonly db: SqliteDatabase;
  schema: DatabaseSchema;
  // One document can back several panels (split view), so sends fan out.
  readonly panels = new Set<(m: OutboundMessage) => void>();
  readonly disposables: vscode.Disposable[] = [];
  dataVersion: number;

  constructor(uri: vscode.Uri, db: SqliteDatabase, schema: DatabaseSchema) {
    this.uri = uri;
    this.db = db;
    this.schema = schema;
    this.dataVersion = db.dataVersion();
  }

  broadcast(msg: OutboundMessage): void {
    for (const post of this.panels) post(msg);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.panels.clear();
    this.db.close();
  }
}

export class SqliteEditorProvider implements vscode.CustomEditorProvider<SqliteDocument> {
  public static readonly viewType = "sqliteExplorer.editor";

  private readonly changeEmitter = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<SqliteDocument>
  >();
  // Required by the API surface. Edits are written straight to disk, so the
  // document is never "dirty" and this never fires.
  public readonly onDidChangeCustomDocument = this.changeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  // ---- CustomDocument lifecycle ----------------------------------------

  async openCustomDocument(uri: vscode.Uri): Promise<SqliteDocument> {
    if (uri.scheme !== "file") {
      throw new Error("SQLite Explorer can only open databases on the local filesystem.");
    }
    const readOnly = vscode.workspace
      .getConfiguration("sqliteExplorer")
      .get<boolean>("readOnly", false);
    const db = new SqliteDatabase(uri.fsPath, readOnly);
    const schema = db.readSchema(path.basename(uri.fsPath));
    const document = new SqliteDocument(uri, db, schema);
    this.watchForExternalChanges(document);
    return document;
  }

  /**
   * Watches the database file (and its -wal sidecar, which is where writes land
   * first in WAL mode) and reloads when another process commits. `data_version`
   * is the discriminator: SQLite bumps it only for other connections, so our own
   * writes can't trigger a refresh loop.
   */
  private watchForExternalChanges(document: SqliteDocument): void {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
        `${path.basename(document.uri.fsPath)}*`,
      ),
    );

    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (timer) clearTimeout(timer);
      // WAL commits touch several files in quick succession; settle before reading.
      timer = setTimeout(() => {
        try {
          const version = document.db.dataVersion();
          if (version === document.dataVersion) return;
          document.dataVersion = version;
          document.schema = document.db.readSchema(document.schema.fileName);
          document.broadcast({ type: "externalChange", schema: document.schema });
        } catch {
          /* file mid-write or briefly locked; the next event will catch it */
        }
      }, 250);
    };

    watcher.onDidChange(check);
    watcher.onDidCreate(check);
    document.disposables.push(watcher, { dispose: () => timer && clearTimeout(timer) });
  }

  // Writes are immediate, so these are no-ops that keep the document clean.
  async saveCustomDocument(): Promise<void> {}
  async saveCustomDocumentAs(): Promise<void> {}
  async revertCustomDocument(): Promise<void> {}
  async backupCustomDocument(): Promise<vscode.CustomDocumentBackup> {
    return { id: "", delete: () => {} };
  }

  // ---- Webview ----------------------------------------------------------

  async resolveCustomEditor(
    document: SqliteDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    };
    webviewPanel.webview.html = await this.getHtml(webviewPanel.webview);

    const post = (msg: OutboundMessage) => {
      void webviewPanel.webview.postMessage(msg);
    };
    document.panels.add(post);

    const sub = webviewPanel.webview.onDidReceiveMessage((msg: InboundMessage) =>
      this.handleMessage(document, msg, post),
    );
    webviewPanel.onDidDispose(() => {
      document.panels.delete(post);
      sub.dispose();
    });
  }

  private tableByName(document: SqliteDocument, name: string): TableSchema | undefined {
    return document.schema.tables.find((t) => t.name === name);
  }

  private async handleMessage(
    document: SqliteDocument,
    msg: InboundMessage,
    post: (m: OutboundMessage) => void,
  ): Promise<void> {
    const { db } = document;
    try {
      switch (msg.type) {
        case "ready":
          post({ type: "init", schema: document.schema });
          return;

        case "getTableData": {
          const t = this.tableByName(document, msg.query.table);
          const { result, total } = db.getTableData(msg.query, t?.hasRowId ?? false);
          post({
            type: "tableData",
            reqId: msg.reqId,
            result,
            total,
            page: msg.query.page,
          });
          return;
        }

        case "runQuery": {
          const { result, rowsAffected, truncated } = db.runQuery(msg.sql);
          if (rowsAffected !== undefined && result === undefined) {
            // A mutation may have changed the schema or row counts.
            this.reload(document);
          }
          post({ type: "queryResult", reqId: msg.reqId, result, rowsAffected, truncated });
          return;
        }

        case "updateCell": {
          const undo = db.updateCell(msg.table, msg.rowid, msg.column, msg.value);
          post({ type: "mutationResult", reqId: msg.reqId, ok: true, undo });
          return;
        }

        case "updateRow": {
          const undo = db.updateRow(msg.table, msg.rowid, msg.values);
          post({ type: "mutationResult", reqId: msg.reqId, ok: true, undo });
          return;
        }

        case "insertRow": {
          const undo = db.insertRow(msg.table, msg.values);
          this.reload(document);
          post({ type: "mutationResult", reqId: msg.reqId, ok: true, undo });
          return;
        }

        case "deleteRows": {
          const { undo } = db.deleteRows(msg.table, msg.rowids);
          this.reload(document);
          post({
            type: "mutationResult",
            reqId: msg.reqId,
            ok: true,
            undo,
            undoUnavailable: undo ? undefined : CASCADE_NOTE,
          });
          return;
        }

        case "previewDelete": {
          const preview = db.previewDelete(msg.table, msg.rowids);
          post({ type: "deletePreview", reqId: msg.reqId, preview });
          return;
        }

        case "applyUndo": {
          const undo = db.applyUndo(msg.op);
          this.reload(document);
          post({
            type: "mutationResult",
            reqId: msg.reqId,
            ok: true,
            undo,
            undoUnavailable: undo ? undefined : CASCADE_NOTE,
          });
          return;
        }

        case "exportCsv": {
          const p = await this.exportRows(document, msg.query.table, msg.query.table, () =>
            db.iterateTable(msg.query, msg.rowids),
          );
          post({ type: "exportResult", reqId: msg.reqId, ok: !!p, path: p });
          return;
        }

        case "exportQueryCsv": {
          const base = `${path.parse(document.uri.fsPath).name}-query`;
          const p = await this.exportRows(document, base, "results", () =>
            db.iterateQuery(msg.sql),
          );
          post({ type: "exportResult", reqId: msg.reqId, ok: !!p, path: p });
          return;
        }

        case "refresh":
          this.reload(document);
          return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reqId = "reqId" in msg ? msg.reqId : -1;
      post({ type: "mutationResult", reqId, ok: false, error: message });
      // Also surface it on the specific channels the webview may be awaiting.
      post({ type: "tableData", reqId, error: message });
      post({ type: "queryResult", reqId, error: message });
      post({ type: "deletePreview", reqId, error: message });
      post({ type: "exportResult", reqId, ok: false, error: message });
    }
  }

  private reload(document: SqliteDocument): void {
    document.schema = document.db.readSchema(document.schema.fileName);
    document.dataVersion = document.db.dataVersion();
    document.broadcast({ type: "reloaded", schema: document.schema });
  }

  // Streams the rows to a file in whichever format the user picks from the save
  // dialog's file-type dropdown (CSV, SQL inserts, JSON array, or JSON lines).
  // `iterate` is a factory so the query only runs once a destination is chosen.
  private async exportRows(
    document: SqliteDocument,
    baseName: string,
    tableName: string,
    iterate: () => Generator<ExportRow>,
  ): Promise<string | undefined> {
    const fileName = `${slugify(baseName)}-${dateStamp()}.csv`;
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), fileName)),
      filters: {
        CSV: ["csv"],
        "SQL inserts": ["sql"],
        "JSON (array)": ["json"],
        "JSON Lines": ["jsonl", "ndjson"],
      },
    });
    if (!target) return undefined;

    const content = serializeRows(formatForPath(target.fsPath), tableName, iterate());
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
    return target.fsPath;
  }

  // Loads the Vite-built webview HTML, rewrites its relative asset URLs to
  // webview URIs, and injects a per-load nonce + CSP so scripts can run.
  private async getHtml(webview: vscode.Webview): Promise<string> {
    const webviewDist = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview");
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(webviewDist, "index.html"),
    );
    const baseUri = webview.asWebviewUri(webviewDist).toString().replace(/\/$/, "");
    const nonce = getNonce();

    let html = Buffer.from(bytes).toString("utf8");
    html = html
      .replace(/(src|href)="\.?\/assets\//g, `$1="${baseUri}/assets/`)
      .replace(/ crossorigin/g, "")
      .replace(/<script/g, `<script nonce="${nonce}"`);

    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join("; ");
    return html.replace(
      /<head>/,
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`,
    );
  }
}

function getNonce(): string {
  return randomBytes(16).toString("base64");
}
