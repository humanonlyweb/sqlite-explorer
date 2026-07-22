import { ref, shallowRef } from "vue";

import type { GridColumn } from "../types";
import { formatCount } from "../util";

import { request } from "./use-db";
import { showToast } from "./use-toast";

// Module-scoped so the query text and results survive tab switches.
const sqlText = ref("");
const columns = ref<GridColumn[]>([]);
const rows = shallowRef<unknown[][]>([]);
const status = ref("Ready.");
const statusError = ref(false);
const canExport = ref(false);
const running = ref(false);

async function run(): Promise<void> {
  const sql = sqlText.value.trim();
  if (!sql || running.value) return;

  running.value = true;
  status.value = "Running…";
  statusError.value = false;

  try {
    const res = await request("queryResult", (reqId) => ({ type: "runQuery", reqId, sql }));

    if (res.error) {
      status.value = res.error;
      statusError.value = true;
      canExport.value = false;
      return;
    }

    if (res.result) {
      columns.value = res.result.columns.map((name) => ({
        name,
        type: "",
        pk: false,
        numeric: false,
      }));
      rows.value = res.result.rows;
      status.value = res.truncated
        ? `Showing first ${formatCount(res.result.rows.length)} rows (truncated — export for the full result).`
        : `${formatCount(res.result.rows.length)} row(s).`;
      canExport.value = true;
    } else {
      columns.value = [];
      rows.value = [];
      status.value = `Done. ${res.rowsAffected ?? 0} row(s) affected.`;
      canExport.value = false;
    }
  } finally {
    running.value = false;
  }
}

async function exportCsv(): Promise<void> {
  const sql = sqlText.value.trim();
  if (!sql) return;

  showToast("Exporting…");

  const res = await request("exportResult", (reqId) => ({
    type: "exportQueryCsv",
    reqId,
    sql,
  }));

  if (res.ok && res.path) showToast(`Exported to ${res.path}`);
  else if (res.error) showToast(res.error, true);
}

export function useSqlConsole() {
  return { sqlText, columns, rows, status, statusError, canExport, running, run, exportCsv };
}
