// Pure SQL-text and value-marshalling helpers. Kept free of `vscode` and of the
// native driver so they can be unit-tested directly.
import type { CellWire } from "./protocol.ts";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

export function quoteId(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

// LIKE treats % and _ as wildcards, so an unescaped filter value silently matches
// more than the user typed — filtering `user_id` would also match `userXid`, and a
// lone `%` would match every row. Callers must pair this with `ESCAPE '\'`.
export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
}

export function wireValue(v: unknown): unknown {
  if (typeof v !== "bigint") return v;
  return v <= MAX_SAFE && v >= MIN_SAFE ? Number(v) : v.toString();
}

/** A cell bound for the webview, with BLOBs base64-wrapped to survive JSON transit. */
export function wireCell(v: unknown): CellWire {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return { blob: Buffer.from(v).toString("base64") };
  if (typeof v === "bigint") return v <= MAX_SAFE && v >= MIN_SAFE ? Number(v) : v.toString();
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  // SQLite yields only null/number/bigint/string/Buffer, so this is defensive.
  return JSON.stringify(v) ?? null;
}

export function bindCell(v: CellWire): string | number | null | Buffer {
  if (v !== null && typeof v === "object") return Buffer.from(v.blob, "base64");
  return v;
}
