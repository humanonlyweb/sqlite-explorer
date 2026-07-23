import { randomBytes } from "node:crypto";
import * as path from "path";

import * as vscode from "vscode";

import { SqliteDatabase } from "./database";
import type { DatabaseSchema, InboundMessage, OutboundMessage, TableSchema } from "./protocol";

class SqliteDocument implements vscode.CustomDocument {
  readonly uri: vscode.Uri;
  readonly db: SqliteDatabase;
  schema: DatabaseSchema;

  constructor(uri: vscode.Uri, db: SqliteDatabase, schema: DatabaseSchema) {
    this.uri = uri;
    this.db = db;
    this.schema = schema;
  }

  dispose(): void {
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
    return new SqliteDocument(uri, db, schema);
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

    const post = (msg: OutboundMessage) => webviewPanel.webview.postMessage(msg);

    const sub = webviewPanel.webview.onDidReceiveMessage((msg: InboundMessage) =>
      this.handleMessage(document, msg, post),
    );
    webviewPanel.onDidDispose(() => sub.dispose());
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
            this.reload(document, post);
          }
          post({ type: "queryResult", reqId: msg.reqId, result, rowsAffected, truncated });
          return;
        }

        case "updateCell":
          db.updateCell(msg.table, msg.rowid, msg.column, msg.value);
          post({ type: "mutationResult", reqId: msg.reqId, ok: true });
          return;

        case "updateRow":
          db.updateRow(msg.table, msg.rowid, msg.values);
          post({ type: "mutationResult", reqId: msg.reqId, ok: true });
          return;

        case "insertRow":
          db.insertRow(msg.table, msg.values);
          this.reload(document, post);
          post({ type: "mutationResult", reqId: msg.reqId, ok: true });
          return;

        case "deleteRows":
          db.deleteRows(msg.table, msg.rowids);
          this.reload(document, post);
          post({ type: "mutationResult", reqId: msg.reqId, ok: true });
          return;

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
          this.reload(document, post);
          return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reqId = "reqId" in msg ? msg.reqId : -1;
      post({ type: "mutationResult", reqId, ok: false, error: message });
      // Also surface it on the specific channels the webview may be awaiting.
      post({ type: "tableData", reqId, error: message });
      post({ type: "queryResult", reqId, error: message });
      post({ type: "exportResult", reqId, ok: false, error: message });
    }
  }

  private reload(document: SqliteDocument, post: (m: OutboundMessage) => void): void {
    document.schema = document.db.readSchema(document.schema.fileName);
    post({ type: "reloaded", schema: document.schema });
  }

  // Streams the rows to a file in whichever format the user picks from the save
  // dialog's file-type dropdown (CSV, SQL inserts, JSON array, or JSON lines).
  // `iterate` is a factory so the query only runs once a destination is chosen.
  private async exportRows(
    document: SqliteDocument,
    baseName: string,
    tableName: string,
    iterate: () => Generator<{ columns: string[]; row: unknown[] }>,
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

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "export"
  );
}

function dateStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
}

type ExportFormat = "csv" | "sql" | "json" | "jsonl";

function formatForPath(filePath: string): ExportFormat {
  switch (path.extname(filePath).toLowerCase()) {
    case ".sql":
      return "sql";
    case ".json":
      return "json";
    case ".jsonl":
    case ".ndjson":
      return "jsonl";
    default:
      return "csv";
  }
}

function serializeRows(
  format: ExportFormat,
  tableName: string,
  rows: Iterable<{ columns: string[]; row: unknown[] }>,
): string {
  if (format === "json") {
    const out: Record<string, unknown>[] = [];
    for (const { columns, row } of rows) out.push(toJsonObject(columns, row));
    return JSON.stringify(out, null, 2);
  }

  const lines: string[] = [];
  let wroteHeader = false;
  for (const { columns, row } of rows) {
    if (format === "csv") {
      if (!wroteHeader) {
        wroteHeader = true;
        lines.push(toCsvRow(columns));
      }
      lines.push(toCsvRow(row));
    } else if (format === "sql") {
      lines.push(toSqlInsert(tableName, columns, row));
    } else {
      lines.push(JSON.stringify(toJsonObject(columns, row)));
    }
  }
  return lines.join(format === "csv" ? "\r\n" : "\n");
}

function toSqlInsert(table: string, columns: string[], row: unknown[]): string {
  const cols = columns.map(quoteIdentifier).join(", ");
  const vals = row.map(sqlLiteral).join(", ");
  return `INSERT INTO ${quoteIdentifier(table)} (${cols}) VALUES (${vals});`;
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString("hex")}'`;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `'${s.replace(/'/g, "''")}'`;
}

function toJsonObject(columns: string[], row: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  columns.forEach((c, i) => (obj[c] = jsonValue(row[i])));
  return obj;
}

function jsonValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return Buffer.from(v).toString("base64");
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : v.toString();
  }
  return v;
}

function toCsvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Uint8Array) return `[blob ${v.length} bytes]`;
  const s =
    typeof v === "string"
      ? v
      : typeof v === "number" || typeof v === "bigint" || typeof v === "boolean"
        ? v.toString()
        : JSON.stringify(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function getNonce(): string {
  return randomBytes(16).toString("base64");
}
