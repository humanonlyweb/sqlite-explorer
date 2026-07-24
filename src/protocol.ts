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
  ddl: string | null; // original CREATE statement from sqlite_master
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

export type CellWire = string | number | null | { blob: string };

export interface DeletePreview {
  direct: number;
  collateral: number; // rows other tables lose or have nulled by cascade/trigger
  tables: string[];
}

export interface RowSnapshot {
  rowid: RowId;
  values: Record<string, CellWire>;
}

export type UndoOp =
  | { kind: "updateCell"; table: string; rowid: RowId; column: string; value: CellWire }
  | { kind: "updateRow"; table: string; rowid: RowId; values: Record<string, CellWire> }
  | { kind: "deleteRows"; table: string; rowids: RowId[] }
  | { kind: "restoreRows"; table: string; rows: RowSnapshot[] };

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
      value: CellWire;
    }
  | {
      type: "updateRow";
      reqId: number;
      table: string;
      rowid: RowId;
      values: Record<string, CellWire>;
    }
  | { type: "insertRow"; reqId: number; table: string; values: Record<string, CellWire> }
  | { type: "deleteRows"; reqId: number; table: string; rowids: RowId[] }
  | { type: "previewDelete"; reqId: number; table: string; rowids: RowId[] }
  | { type: "applyUndo"; reqId: number; op: UndoOp }
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
  | {
      type: "mutationResult";
      reqId: number;
      ok: boolean;
      error?: string;
      undo?: UndoOp;
      // Set when the write succeeded but can't be reversed, with the reason why.
      undoUnavailable?: string;
    }
  | { type: "deletePreview"; reqId: number; preview?: DeletePreview; error?: string }
  | { type: "exportResult"; reqId: number; ok: boolean; path?: string; error?: string }
  | { type: "reloaded"; schema: DatabaseSchema }
  | { type: "externalChange"; schema: DatabaseSchema }
  | { type: "fatal"; message: string };
