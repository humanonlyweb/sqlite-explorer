export interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  pk: number; // 0 = not part of PK, otherwise 1-based position
}

export interface ForeignKey {
  from: string; // column in this table
  table: string; // referenced table
  to: string; // referenced column
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface TableSchema {
  name: string;
  kind: "table" | "view";
  columns: ColumnInfo[];
  foreignKeys: ForeignKey[];
  indexes: IndexInfo[];
  hasRowId: boolean;
  rowCount: number;
}

export interface DatabaseSchema {
  fileName: string;
  filePath: string;
  readOnly: boolean;
  tables: TableSchema[];
}

export type SortDir = "asc" | "desc";

export interface Filter {
  column: string;
  value: string;
}

export interface TableQuery {
  table: string;
  page: number; // 0-based
  pageSize: number;
  sort: { column: string; dir: SortDir } | null;
  filters: Filter[];
}

export type RowId = number | string;

// ---- Webview -> Host ----------------------------------------------------

export type InboundMessage =
  | { type: "ready" }
  | { type: "getTableData"; reqId: number; query: TableQuery }
  | { type: "runQuery"; reqId: number; sql: string }
  | {
      type: "updateCell";
      reqId: number;
      table: string;
      rowid: RowId;
      column: string;
      value: string | null;
    }
  | {
      type: "updateRow";
      reqId: number;
      table: string;
      rowid: RowId;
      values: Record<string, string | null>;
    }
  | { type: "insertRow"; reqId: number; table: string; values: Record<string, string | null> }
  | { type: "deleteRows"; reqId: number; table: string; rowids: RowId[] }
  | { type: "exportCsv"; reqId: number; query: TableQuery; rowids?: RowId[] }
  | { type: "exportQueryCsv"; reqId: number; sql: string }
  | { type: "refresh" };

// ---- Host -> Webview ----------------------------------------------------

export interface ResultSet {
  columns: string[];
  rows: unknown[][];
  rowids: (RowId | null)[];
}

export type OutboundMessage =
  | { type: "init"; schema: DatabaseSchema }
  | {
      type: "tableData";
      reqId: number;
      result?: ResultSet;
      total?: number;
      page?: number;
      error?: string;
    }
  | {
      type: "queryResult";
      reqId: number;
      result?: ResultSet;
      rowsAffected?: number;
      truncated?: boolean;
      error?: string;
    }
  | { type: "mutationResult"; reqId: number; ok: boolean; error?: string }
  | { type: "exportResult"; reqId: number; ok: boolean; path?: string; error?: string }
  | { type: "reloaded"; schema: DatabaseSchema }
  | { type: "fatal"; message: string };
