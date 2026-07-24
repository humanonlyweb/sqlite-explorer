import * as path from "node:path";

import { quoteId } from "./sql.ts";

export type ExportFormat = "csv" | "sql" | "json" | "jsonl";

export interface ExportRow {
  columns: string[];
  row: unknown[];
}

export function formatForPath(filePath: string): ExportFormat {
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

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "export"
  );
}

export function dateStamp(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
}

export function serializeRows(
  format: ExportFormat,
  tableName: string,
  rows: Iterable<ExportRow>,
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

export function toSqlInsert(table: string, columns: string[], row: unknown[]): string {
  const cols = columns.map(quoteId).join(", ");
  const vals = row.map(sqlLiteral).join(", ");
  return `INSERT INTO ${quoteId(table)} (${cols}) VALUES (${vals});`;
}

export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString("hex")}'`;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `'${s.replace(/'/g, "''")}'`;
}

export function toJsonObject(columns: string[], row: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  columns.forEach((c, i) => (obj[c] = jsonValue(row[i])));
  return obj;
}

export function jsonValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return Buffer.from(v).toString("base64");
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : v.toString();
  }
  return v;
}

export function toCsvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

export function csvCell(v: unknown): string {
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
