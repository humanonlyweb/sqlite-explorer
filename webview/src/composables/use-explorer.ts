import type { TableSchema } from "@shared/protocol";
import { computed, ref } from "vue";

import { schema } from "./use-db";

export type TabId = "data" | "structure" | "sql";

const currentTableName = ref<string | null>(null);
const currentTab = ref<TabId>("data");
let pendingFilter: { column: string; value: string } | null = null;

export const currentTable = computed<TableSchema | undefined>(() =>
  schema.value?.tables.find((t) => t.name === currentTableName.value),
);

function selectTable(name: string): void {
  pendingFilter = null;
  currentTableName.value = name;
}

function navigateToFk(table: string, column: string, value: string): void {
  pendingFilter = { column, value };
  currentTab.value = "data";
  currentTableName.value = table;
}

function takePendingFilter(): { column: string; value: string } | null {
  const f = pendingFilter;
  pendingFilter = null;
  return f;
}

export function useExplorer() {
  return {
    currentTableName,
    currentTab,
    currentTable,
    selectTable,
    navigateToFk,
    takePendingFilter,
  };
}
