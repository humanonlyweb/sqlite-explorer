import { createRequire } from "node:module";

import type BetterSqlite3 from "better-sqlite3";

import type {
  ColumnInfo,
  DatabaseSchema,
  ForeignKey,
  IndexInfo,
  ResultSet,
  RowId,
  TableQuery,
  TableSchema,
} from "./protocol";

const ROWID_ALIAS = "__sqlite_explorer_rowid__";

const MAX_QUERY_ROWS = 10_000;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

function wireValue(v: unknown): unknown {
  if (typeof v !== "bigint") return v;
  return v <= MAX_SAFE && v >= MIN_SAFE ? Number(v) : v.toString();
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

function quoteId(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

// Shapes returned by the PRAGMA/introspection statements we run. Declaring them
// lets us use better-sqlite3's `prepare<Bind, Result>` generics so results are
// typed at the source, with no `as` assertions.
interface MasterRow {
  name: string;
  type: "table" | "view";
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
        `SELECT name, type FROM sqlite_master
         WHERE type IN ('table','view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
         ORDER BY type, name`,
      )
      .all();

    return {
      fileName,
      filePath: this.filePath,
      readOnly: this.readOnly,
      tables: objects.map((o) => this.readTableSchema(o.name, o.type)),
    };
  }

  private readTableSchema(name: string, kind: "table" | "view"): TableSchema {
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

    let rowCount = 0;
    try {
      const row = this.db.prepare<[], CountRow>(`SELECT COUNT(*) AS n FROM ${quoteId(name)}`).get();
      rowCount = row?.n ?? 0;
    } catch {
      rowCount = -1; // unknown (e.g. a view over a missing table)
    }

    return { name, kind, columns, foreignKeys, indexes, hasRowId, rowCount };
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
      " WHERE " + valid.map((f) => `CAST(${quoteId(f.column)} AS TEXT) LIKE ?`).join(" AND ");
    const params = valid.map((f) => `%${f.value}%`);
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

  updateCell(table: string, rowid: RowId, column: string, value: string | null): void {
    this.assertWritable();
    this.db
      .prepare(`UPDATE ${quoteId(table)} SET ${quoteId(column)} = ? WHERE rowid = ?`)
      .run(value, bindRowId(rowid));
  }

  updateRow(table: string, rowid: RowId, values: Record<string, string | null>): void {
    this.assertWritable();
    const cols = Object.keys(values);
    if (cols.length === 0) return;
    const assignments = cols.map((c) => `${quoteId(c)} = ?`).join(", ");
    this.db
      .prepare(`UPDATE ${quoteId(table)} SET ${assignments} WHERE rowid = ?`)
      .run(...cols.map((c) => values[c]), bindRowId(rowid));
  }

  insertRow(table: string, values: Record<string, string | null>): void {
    this.assertWritable();
    const cols = Object.keys(values);
    if (cols.length === 0) {
      this.db.prepare(`INSERT INTO ${quoteId(table)} DEFAULT VALUES`).run();
      return;
    }
    const placeholders = cols.map(() => "?").join(", ");
    const columnList = cols.map(quoteId).join(", ");
    this.db
      .prepare(`INSERT INTO ${quoteId(table)} (${columnList}) VALUES (${placeholders})`)
      .run(...cols.map((c) => values[c]));
  }

  deleteRows(table: string, rowids: RowId[]): number {
    this.assertWritable();
    if (rowids.length === 0) return 0;
    const del = this.db.prepare(`DELETE FROM ${quoteId(table)} WHERE rowid = ?`);
    const tx = this.db.transaction((ids: RowId[]) => {
      let n = 0;
      for (const id of ids) n += del.run(bindRowId(id)).changes;
      return n;
    });
    return tx(rowids);
  }
}
