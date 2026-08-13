import type { TableSchema } from "@shared/protocol";
import { computed, ref } from "vue";

import { schema } from "./use-db";

export type TabId = "data" | "structure" | "sql";

const currentTableName = ref<string | null>(null);
const currentTab = ref<TabId>("data");
const tableNavigationCount = ref(0);
let pendingFilter: { column: string; value: string; exact?: boolean } | null = null;

export const currentTable = computed<TableSchema | undefined>(() =>
  schema.value?.tables.find((t) => t.name === currentTableName.value),
);

function selectTable(name: string): void {
  pendingFilter = null;
  // Data and Structure both re-render for the new table, but the SQL console is a
  // global scratchpad — selecting a table while it's open would change nothing on
  // screen. The query text survives the switch, so returning to SQL is lossless.
  if (currentTab.value === "sql") currentTab.value = "data";
  currentTableName.value = name;
  tableNavigationCount.value++;
}

function navigateToFk(table: string, column: string, value: string): void {
  pendingFilter = { column, value, exact: true };
  currentTab.value = "data";
  currentTableName.value = table;
  tableNavigationCount.value++;
}

function takePendingFilter(): { column: string; value: string; exact?: boolean } | null {
  const f = pendingFilter;
  pendingFilter = null;
  return f;
}

export function useExplorer() {
  return {
    currentTableName,
    currentTab,
    currentTable,
    tableNavigationCount,
    selectTable,
    navigateToFk,
    takePendingFilter,
  };
}
