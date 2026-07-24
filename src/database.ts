import { createRequire } from "node:module";

import type BetterSqlite3 from "better-sqlite3";

import type {
  CellWire,
  ColumnInfo,
  DatabaseSchema,
  DeletePreview,
  ForeignKey,
  IndexInfo,
  ResultSet,
  RowId,
  RowSnapshot,
  TableQuery,
  TableSchema,
  UndoOp,
} from "./protocol.ts";
import { bindCell, likePattern, quoteId, wireCell, wireValue } from "./sql.ts";

const ROWID_ALIAS = "__sqlite_explorer_rowid__";

const MAX_QUERY_ROWS = 10_000;
const MAX_UNDO_ROWS = 5_000;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

export interface Write {
  undo?: UndoOp;
  cascaded: boolean;
}

function wireRow(row: unknown[]): unknown[] {
  return row.map(wireValue);
}

function wireRowId(v: unknown): RowId | null {
  if (typeof v === "bigint") return v <= MAX_SAFE && v >= MIN_SAFE ? Number(v) : v.toString();
  if (typeof v === "number") return v;
  return null;
}

function bindRowId(id: RowId): number | bigint {
  return typeof id === "string" ? BigInt(id) : id;
}

// The extension bundle is ESM, but better-sqlite3 is a native CommonJS module.
// createRequire lets us load it lazily inside a try/catch, so a load failure
// surfaces as a catchable error instead of an uncatchable load-time crash.
const nodeRequire = createRequire(import.meta.url);

function loadDriver(): typeof BetterSqlite3 {
  // Packaged builds vendor the module next to the bundle (see scripts/package.mjs);
  // dev runs resolve it from node_modules. Try the vendored copy first.
  let lastErr: unknown;
  for (const id of ["./better-sqlite3", "better-sqlite3"]) {
    try {
      return nodeRequire(id);
    } catch (err) {
      lastErr = err;
    }
  }
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `Failed to load the better-sqlite3 native module for ${process.platform}-${process.arch}. ` +
      "The prebuilt binary for this platform may be missing from the installed " +
      "package, or the platform is unsupported.\n\n" +
      `Original error: ${detail}`,
    { cause: lastErr },
  );
}

// Shapes returned by the PRAGMA/introspection statements we run. Declaring them
// lets us use better-sqlite3's `prepare<Bind, Result>` generics so results are
// typed at the source, with no `as` assertions.
interface MasterRow {
  name: string;
  type: "table" | "view";
  sql: string | null;
}
interface PragmaColumn {
  name: string;
  type: string | null;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}
interface PragmaForeignKey {
  from: string;
  table: string;
  to: string;
}
interface PragmaIndex {
  name: string;
  unique: number;
}
interface PragmaIndexColumn {
  name: string | null;
}
interface CountRow {
  n: number;
}

export class SqliteDatabase {
  private db: BetterSqlite3.Database;
  readonly filePath: string;
  readonly readOnly: boolean;

  constructor(filePath: string, readOnly: boolean) {
    const Driver = loadDriver();
    this.filePath = filePath;
    this.readOnly = readOnly;
    this.db = new Driver(filePath, { readonly: readOnly, fileMustExist: true });
    this.db.pragma("foreign_keys = ON");
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }

  // ---- Schema introspection --------------------------------------------

  readSchema(fileName: string): DatabaseSchema {
    const objects = this.db
      .prepare<[], MasterRow>(
        `SELECT name, type, sql FROM sqlite_master
         WHERE type IN ('table','view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
         ORDER BY type, name`,
      )
      .all();

    return {
      fileName,
      filePath: this.filePath,
      readOnly: this.readOnly,
      tables: objects.map((o) => this.readTableSchema(o.name, o.type, o.sql)),
    };
  }

  dataVersion(): number {
    const v: unknown = this.db.pragma("data_version", { simple: true });
    // A constant fallback degrades to "never changed" rather than to a refresh
    // loop, which is what a sentinel like NaN would cause.
    return typeof v === "number" ? v : 0;
  }

  private readTableSchema(name: string, kind: "table" | "view", ddl: string | null): TableSchema {
    const columns: ColumnInfo[] = this.db
      .prepare<[], PragmaColumn>(`PRAGMA table_info(${quoteId(name)})`)
      .all()
      .map((c) => ({
        name: c.name,
        type: c.type ?? "",
        notNull: c.notnull !== 0,
        defaultValue: c.dflt_value,
        pk: c.pk,
      }));

    const foreignKeys: ForeignKey[] =
      kind === "table"
        ? this.db
            .prepare<[], PragmaForeignKey>(`PRAGMA foreign_key_list(${quoteId(name)})`)
            .all()
            .map((f) => ({ from: f.from, table: f.table, to: f.to }))
        : [];

    const indexes: IndexInfo[] =
      kind === "table"
        ? this.db
            .prepare<[], PragmaIndex>(`PRAGMA index_list(${quoteId(name)})`)
            .all()
            .map((idx) => ({
              name: idx.name,
              unique: idx.unique !== 0,
              columns: this.db
                .prepare<[], PragmaIndexColumn>(`PRAGMA index_info(${quoteId(idx.name)})`)
                .all()
                .map((ic) => ic.name)
                .filter((n): n is string => n != null),
            }))
        : [];

    const hasRowId = kind === "table" && this.tableHasRowId(name);

    return {
      name,
      kind,
      columns,
      foreignKeys,
      indexes,
      hasRowId,
      rowCount: this.tableRowCount(name),
      ddl,
    };
  }

  tableRowCount(name: string): number {
    try {
      return (
        this.db.prepare<[], CountRow>(`SELECT COUNT(*) AS n FROM ${quoteId(name)}`).get()?.n ?? 0
      );
    } catch {
      return -1;
    }
  }

  private tableHasRowId(name: string): boolean {
    try {
      this.db.prepare(`SELECT rowid FROM ${quoteId(name)} LIMIT 0`).run();
      return true;
    } catch {
      return false;
    }
  }

  // ---- Reads ------------------------------------------------------------

  private buildWhere(filters: TableQuery["filters"]): {
    clause: string;
    params: string[];
  } {
    const valid = filters.filter((f) => f.value !== "");
    if (valid.length === 0) return { clause: "", params: [] };
    const clause =
      " WHERE " +
      valid.map((f) => `CAST(${quoteId(f.column)} AS TEXT) LIKE ? ESCAPE '\\'`).join(" AND ");
    const params = valid.map((f) => likePattern(f.value));
    return { clause, params };
  }

  private buildSelectSql(
    query: TableQuery,
    hasRowId: boolean,
    withLimit: boolean,
    rowids?: RowId[],
  ): { sql: string; params: unknown[] } {
    const { clause, params } = this.buildWhere(query.filters);
    const bound: unknown[] = [...params];

    let where = clause;
    if (rowids && rowids.length > 0) {
      const inList = rowids.map(() => "?").join(", ");
      where += `${where ? " AND" : " WHERE"} rowid IN (${inList})`;
      bound.push(...rowids.map(bindRowId));
    }

    const cols = hasRowId ? `rowid AS ${ROWID_ALIAS}, *` : "*";
    let sql = `SELECT ${cols} FROM ${quoteId(query.table)}${where}`;
    if (query.sort) {
      sql += ` ORDER BY ${quoteId(query.sort.column)} ${
        query.sort.dir === "desc" ? "DESC" : "ASC"
      }`;
    }
    if (withLimit) {
      sql += " LIMIT ? OFFSET ?";
      bound.push(query.pageSize, query.page * query.pageSize);
    }
    return { sql, params: bound };
  }

  getTableData(query: TableQuery, hasRowId: boolean): { result: ResultSet; total: number } {
    const { clause, params } = this.buildWhere(query.filters);
    const totalRow = this.db
      .prepare<string[], CountRow>(`SELECT COUNT(*) AS n FROM ${quoteId(query.table)}${clause}`)
      .get(...params);
    const total = totalRow?.n ?? 0;

    const { sql, params: bound } = this.buildSelectSql(query, hasRowId, true);
    const stmt = this.db.prepare<unknown[], unknown[]>(sql).raw(true).safeIntegers(true);
    const rawRows = stmt.all(...bound);
    const allColumns = stmt.columns().map((c) => c.name);

    return {
      result: this.splitRowIds(allColumns, rawRows, hasRowId),
      total,
    };
  }

  private splitRowIds(allColumns: string[], rawRows: unknown[][], hasRowId: boolean): ResultSet {
    if (!hasRowId || allColumns[0] !== ROWID_ALIAS) {
      return {
        columns: allColumns,
        rows: rawRows.map(wireRow),
        rowids: rawRows.map(() => null),
      };
    }
    const columns = allColumns.slice(1);
    const rows: unknown[][] = [];
    const rowids: (RowId | null)[] = [];
    for (const r of rawRows) {
      rowids.push(wireRowId(r[0]));
      rows.push(wireRow(r.slice(1)));
    }
    return { columns, rows, rowids };
  }

  runQuery(sql: string): { result?: ResultSet; rowsAffected?: number; truncated?: boolean } {
    let stmt: BetterSqlite3.Statement<unknown[], unknown[]>;
    try {
      stmt = this.db.prepare<unknown[], unknown[]>(sql);
    } catch {
      // Multi-statement scripts can't be prepared; execute them wholesale.
      this.db.exec(sql);
      return { rowsAffected: 0 };
    }

    if (stmt.reader) {
      const raw = stmt.raw(true).safeIntegers(true);
      const columns = raw.columns().map((c) => c.name);
      const rows: unknown[][] = [];
      let truncated = false;
      for (const row of raw.iterate()) {
        if (rows.length >= MAX_QUERY_ROWS) {
          truncated = true;
          break;
        }
        rows.push(wireRow(row));
      }
      return { result: { columns, rows, rowids: rows.map(() => null) }, truncated };
    }

    const info = stmt.run();
    return { rowsAffected: info.changes };
  }

  // ---- Streaming export -------------------------------------------------

  *iterateTable(
    query: TableQuery,
    rowids?: RowId[],
  ): Generator<{ columns: string[]; row: unknown[] }, void, unknown> {
    const { sql, params } = this.buildSelectSql(query, false, false, rowids);
    const stmt = this.db.prepare<unknown[], unknown[]>(sql).raw(true).safeIntegers(true);
    const columns = stmt.columns().map((c) => c.name);
    for (const row of stmt.iterate(...params)) {
      yield { columns, row };
    }
  }

  *iterateQuery(sql: string): Generator<{ columns: string[]; row: unknown[] }, void, unknown> {
    const stmt = this.db.prepare<[], unknown[]>(sql);
    if (!stmt.reader) return;
    const raw = stmt.raw(true).safeIntegers(true);
    const columns = raw.columns().map((c) => c.name);
    for (const row of raw.iterate()) {
      yield { columns, row };
    }
  }

  // ---- Mutations --------------------------------------------------------

  private assertWritable(): void {
    if (this.readOnly) {
      throw new Error("Database is open in read-only mode.");
    }
  }

  private snapshotRows(table: string, rowids: RowId[]): RowSnapshot[] {
    if (rowids.length === 0) return [];
    const inList = rowids.map(() => "?").join(", ");
    const stmt = this.db
      .prepare<unknown[], unknown[]>(
        `SELECT rowid AS ${ROWID_ALIAS}, * FROM ${quoteId(table)} WHERE rowid IN (${inList})`,
      )
      .raw(true)
      .safeIntegers(true);

    const cols = stmt.columns().map((c) => c.name);
    const snapshots: RowSnapshot[] = [];

    for (const row of stmt.all(...rowids.map(bindRowId))) {
      const rowid = wireRowId(row[0]);
      if (rowid === null) continue;

      const values: Record<string, CellWire> = {};

      cols.forEach((c, i) => {
        if (c !== ROWID_ALIAS) values[c] = wireCell(row[i]);
      });
      snapshots.push({ rowid, values });
    }
    return snapshots;
  }

  updateCell(table: string, rowid: RowId, column: string, value: CellWire): UndoOp {
    this.assertWritable();
    const before = this.db
      .prepare(`SELECT ${quoteId(column)} FROM ${quoteId(table)} WHERE rowid = ?`)
      .pluck(true)
      .safeIntegers(true)
      .get(bindRowId(rowid));
    this.db
      .prepare(`UPDATE ${quoteId(table)} SET ${quoteId(column)} = ? WHERE rowid = ?`)
      .run(bindCell(value), bindRowId(rowid));
    return { kind: "updateCell", table, rowid, column, value: wireCell(before) };
  }

  updateRow(table: string, rowid: RowId, values: Record<string, CellWire>): UndoOp {
    this.assertWritable();
    const cols = Object.keys(values);
    if (cols.length === 0) return { kind: "updateRow", table, rowid, values: {} };

    const [snapshot] = this.snapshotRows(table, [rowid]);
    const before: Record<string, CellWire> = {};
    for (const c of cols) before[c] = snapshot?.values[c] ?? null;

    const assignments = cols.map((c) => `${quoteId(c)} = ?`).join(", ");
    this.db
      .prepare(`UPDATE ${quoteId(table)} SET ${assignments} WHERE rowid = ?`)
      .run(...cols.map((c) => bindCell(values[c])), bindRowId(rowid));
    return { kind: "updateRow", table, rowid, values: before };
  }

  insertRow(table: string, values: Record<string, CellWire>): Write {
    this.assertWritable();
    const cols = Object.keys(values);
    const before = this.totalChanges();
    const info =
      cols.length === 0
        ? this.db.prepare(`INSERT INTO ${quoteId(table)} DEFAULT VALUES`).run()
        : this.db
            .prepare(
              `INSERT INTO ${quoteId(table)} (${cols.map(quoteId).join(", ")}) VALUES (${cols
                .map(() => "?")
                .join(", ")})`,
            )
            .run(...cols.map((c) => bindCell(values[c])));
    const rowid = wireRowId(info.lastInsertRowid);
    return {
      undo: { kind: "deleteRows", table, rowids: rowid === null ? [] : [rowid] },
      cascaded: this.totalChanges() - before > info.changes,
    };
  }

  /** Tables reachable from `target` by following foreign keys inward, transitively. */
  private dependentTables(target: string): string[] {
    const names = this.db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'`,
      )
      .all()
      .map((r) => r.name);

    const children = new Map<string, string[]>();
    for (const t of names) {
      for (const fk of this.db
        .prepare<[], { table: string }>(`PRAGMA foreign_key_list(${quoteId(t)})`)
        .all()) {
        children.set(fk.table, [...(children.get(fk.table) ?? []), t]);
      }
    }

    const seen = new Set<string>();
    const queue = [target];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const child of children.get(current) ?? []) {
        if (child === target || seen.has(child)) continue;
        seen.add(child);
        queue.push(child);
      }
    }
    return [...seen];
  }

  /**
   * Counts what a delete would touch by performing it and rolling back, so the
   * confirmation can warn about cascades before anything is written.
   */
  previewDelete(table: string, rowids: RowId[]): DeletePreview {
    if (this.readOnly || rowids.length === 0) return { direct: 0, collateral: 0, tables: [] };

    const del = this.db.prepare(`DELETE FROM ${quoteId(table)} WHERE rowid = ?`);
    let direct = 0;
    let collateral = 0;
    const before = this.totalChanges();

    this.db.exec("BEGIN");
    try {
      for (const id of rowids) direct += del.run(bindRowId(id)).changes;
      collateral = this.totalChanges() - before - direct;
    } finally {
      this.db.exec("ROLLBACK");
    }

    return { direct, collateral, tables: collateral > 0 ? this.dependentTables(table) : [] };
  }

  /** Rows changed on this connection since it opened, including cascades and triggers. */
  private totalChanges(): number {
    const n: unknown = this.db.prepare("SELECT total_changes() AS n").pluck(true).get();
    return typeof n === "number" ? n : 0;
  }

  /**
   * `undo` is omitted when the delete reached rows we didn't snapshot — an
   * `ON DELETE CASCADE` or a delete trigger. Restoring only the rows we captured
   * would look successful while leaving the cascaded ones gone for good, so we
   * decline to offer undo rather than offer a lossy one.
   */
  deleteRows(table: string, rowids: RowId[]): Write & { changes: number } {
    this.assertWritable();
    if (rowids.length === 0) {
      return { changes: 0, undo: { kind: "restoreRows", table, rows: [] }, cascaded: false };
    }
    // A snapshot lives on both sides of the postMessage bridge for the full
    // history depth, so past a point it costs more than a bulk undo is worth.
    const snapshots = rowids.length <= MAX_UNDO_ROWS ? this.snapshotRows(table, rowids) : null;
    const del = this.db.prepare(`DELETE FROM ${quoteId(table)} WHERE rowid = ?`);
    const tx = this.db.transaction((ids: RowId[]) => {
      let n = 0;
      for (const id of ids) n += del.run(bindRowId(id)).changes;
      return n;
    });

    const before = this.totalChanges();
    const changes = tx(rowids);
    const cascaded = this.totalChanges() - before - changes > 0;

    if (cascaded || snapshots === null) return { changes, cascaded };
    return { changes, cascaded, undo: { kind: "restoreRows", table, rows: snapshots } };
  }

  restoreRows(table: string, rows: RowSnapshot[]): Write {
    this.assertWritable();
    // Keyed by column set, not by row: a bulk restore would otherwise re-compile
    // the same INSERT thousands of times.
    const statements = new Map<string, BetterSqlite3.Statement>();
    const tx = this.db.transaction((batch: RowSnapshot[]) => {
      for (const { rowid, values } of batch) {
        const cols = Object.keys(values);
        const key = cols.join(" ");
        let stmt = statements.get(key);
        if (!stmt) {
          const columnList = ["rowid", ...cols].map(quoteId).join(", ");
          const placeholders = Array.from({ length: cols.length + 1 }, () => "?").join(", ");
          stmt = this.db.prepare(
            `INSERT INTO ${quoteId(table)} (${columnList}) VALUES (${placeholders})`,
          );
          statements.set(key, stmt);
        }
        stmt.run(bindRowId(rowid), ...cols.map((c) => bindCell(values[c])));
      }
    });

    const before = this.totalChanges();
    tx(rows);
    return {
      undo: { kind: "deleteRows", table, rowids: rows.map((r) => r.rowid) },
      cascaded: this.totalChanges() - before - rows.length > 0,
    };
  }

  /**
   * Applies an inverse operation and returns the inverse of *that*, giving redo.
   * `undo` is absent when the applied operation cascaded and so can't itself be
   * reversed.
   */
  applyUndo(op: UndoOp): Write {
    switch (op.kind) {
      case "updateCell":
        return { undo: this.updateCell(op.table, op.rowid, op.column, op.value), cascaded: false };
      case "updateRow":
        return { undo: this.updateRow(op.table, op.rowid, op.values), cascaded: false };
      case "deleteRows":
        return this.deleteRows(op.table, op.rowids);
      default:
        return this.restoreRows(op.table, op.rows);
    }
  }
}
