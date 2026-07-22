import type { Filter, RowId, SortDir, TableQuery, TableSchema } from "@shared/protocol";
import { computed, ref, shallowRef } from "vue";

import type { GridColumn } from "../types";
import { isNumericType } from "../util";

import { request, schema } from "./use-db";
import { currentTable, useExplorer } from "./use-explorer";
import { showToast } from "./use-toast";

const { takePendingFilter } = useExplorer();

const page = ref(0);
const pageSize = ref(1000);
const filters = ref<Filter[]>([]);
const sort = ref<{ column: string; dir: SortDir } | null>(null);

const columns = ref<GridColumn[]>([]);
const rows = shallowRef<unknown[][]>([]);
const rowids = shallowRef<(RowId | null)[]>([]);
const total = ref(0);

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const editable = computed(() => {
  const t = currentTable.value;
  return !!t && t.hasRowId && !schema.value?.readOnly;
});

function buildColumns(t: TableSchema, resultColumns: string[]): GridColumn[] {
  const fkMap = new Map<string, { table: string; to: string }>();
  for (const fk of t.foreignKeys) fkMap.set(fk.from, { table: fk.table, to: fk.to });
  return resultColumns.map((name) => {
    const meta = t.columns.find((c) => c.name === name);
    return {
      name,
      type: meta?.type ?? "",
      pk: (meta?.pk ?? 0) > 0,
      numeric: isNumericType(meta?.type ?? ""),
      fk: fkMap.get(name),
    };
  });
}

function buildQuery(t: TableSchema, pageIndex: number): TableQuery {
  return {
    table: t.name,
    page: pageIndex,
    pageSize: pageSize.value,
    sort: sort.value ? { column: sort.value.column, dir: sort.value.dir } : null,
    filters: filters.value.map((f) => ({ column: f.column, value: f.value })),
  };
}

async function load(): Promise<void> {
  const t = currentTable.value;
  if (!t) return;

  const query = buildQuery(t, page.value);
  const res = await request("tableData", (reqId) => ({ type: "getTableData", reqId, query }));

  if (res.error) {
    showToast(res.error, true);
    return;
  }

  if (!res.result) return;

  total.value = res.total ?? 0;
  columns.value = buildColumns(t, res.result.columns);
  rows.value = res.result.rows;
  rowids.value = res.result.rowids;
}

function setFilters(next: Filter[]): void {
  filters.value = next;
  page.value = 0;
  void load();
}

function toggleSort(column: string): void {
  if (sort.value?.column === column) {
    sort.value = sort.value.dir === "asc" ? { column, dir: "desc" } : null;
  } else {
    sort.value = { column, dir: "asc" };
  }
  page.value = 0;
  void load();
}

function setPage(next: number): void {
  page.value = Math.min(Math.max(0, next), pageCount.value - 1);
  void load();
}

function setPageSize(next: number): void {
  pageSize.value = next;
  page.value = 0;
  void load();
}

async function commitEdit(rowIndex: number, column: string, value: string | null): Promise<void> {
  const t = currentTable.value;
  const rowid = rowids.value[rowIndex];
  if (!t || rowid == null) {
    showToast("This row cannot be edited (no rowid).", true);
    return;
  }
  const res = await request("mutationResult", (reqId) => ({
    type: "updateCell",
    reqId,
    table: t.name,
    rowid,
    column,
    value,
  }));
  if (!res.ok) {
    showToast(res.error ?? "Update failed", true);
    await load();
    return;
  }
  const ci = columns.value.findIndex((c) => c.name === column);
  if (ci >= 0) rows.value[rowIndex][ci] = value;
  rows.value = [...rows.value];
}

async function updateRow(
  rowIndex: number,
  values: Record<string, string | null>,
): Promise<boolean> {
  const t = currentTable.value;
  const rowid = rowids.value[rowIndex];

  if (!t || rowid == null) {
    showToast("This row cannot be edited (no rowid).", true);
    return false;
  }

  if (Object.keys(values).length === 0) return true;
  const res = await request("mutationResult", (reqId) => ({
    type: "updateRow",
    reqId,
    table: t.name,
    rowid,
    values,
  }));
  if (!res.ok) {
    showToast(res.error ?? "Update failed", true);
    await load();
    return false;
  }
  const indexByName = new Map(columns.value.map((c, i) => [c.name, i]));
  for (const [name, v] of Object.entries(values)) {
    const ci = indexByName.get(name);
    if (ci != null) rows.value[rowIndex][ci] = v;
  }
  rows.value = [...rows.value];
  return true;
}

async function deleteRowsByIndex(indexes: number[]): Promise<void> {
  const t = currentTable.value;
  if (!t) return;
  const ids = indexes.map((i) => rowids.value[i]).filter((r): r is RowId => r != null);
  if (ids.length === 0) return;
  const res = await request("mutationResult", (reqId) => ({
    type: "deleteRows",
    reqId,
    table: t.name,
    rowids: ids,
  }));

  if (!res.ok) {
    showToast(res.error ?? "Delete failed", true);
    return;
  }

  showToast(`Deleted ${ids.length} row(s).`);
  await load();
}

async function insertRow(values: Record<string, string | null>): Promise<boolean> {
  const t = currentTable.value;

  if (!t) return false;

  const res = await request("mutationResult", (reqId) => ({
    type: "insertRow",
    reqId,
    table: t.name,
    values,
  }));
  if (!res.ok) {
    showToast(res.error ?? "Insert failed", true);
    return false;
  }
  showToast("Row inserted.");
  page.value = Math.max(0, Math.ceil((total.value + 1) / pageSize.value) - 1);
  await load();
  return true;
}

async function exportCsv(selectedIndexes?: number[]): Promise<void> {
  const t = currentTable.value;
  if (!t) return;

  const query = buildQuery(t, 0);
  const selectedRowids = selectedIndexes?.length
    ? selectedIndexes.map((i) => rowids.value[i]).filter((r): r is RowId => r != null)
    : undefined;
  showToast("Exporting…");
  const res = await request("exportResult", (reqId) => ({
    type: "exportCsv",
    reqId,
    query,
    rowids: selectedRowids,
  }));

  if (res.ok && res.path) showToast(`Exported to ${res.path}`);
  else if (res.error) showToast(res.error, true);
}

function syncTable(): void {
  page.value = 0;
  sort.value = null;
  const pf = takePendingFilter();
  filters.value = pf ? [pf] : [];
  void load();
}

export function useTableData() {
  return {
    page,
    pageSize,
    pageCount,
    sort,
    filters,
    columns,
    rows,
    total,
    editable,
    load,
    syncTable,
    setFilters,
    toggleSort,
    setPage,
    setPageSize,
    commitEdit,
    updateRow,
    deleteRowsByIndex,
    insertRow,
    exportCsv,
  };
}
