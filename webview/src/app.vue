<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from "vue";

import DataView from "./components/data-view.vue";
import Sidebar from "./components/sidebar.vue";
import SqlConsole from "./components/sql-console.vue";
import StructureView from "./components/structure-view.vue";
import ToastHost from "./components/toast-host.vue";
import { initBridge, schema } from "./composables/use-db";
import { useExplorer, type TabId } from "./composables/use-explorer";
import { useTableData } from "./composables/use-table-data";

const { currentTab, currentTableName, currentTable } = useExplorer();
const { undoEdit, redoEdit } = useTableData();

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "data", label: "Data", icon: "codicon-table" },
  { id: "structure", label: "Structure", icon: "codicon-list-tree" },
  { id: "sql", label: "SQL", icon: "codicon-terminal" },
];

onMounted(initBridge);

watch(schema, (s) => {
  if (s && currentTableName.value === null) {
    const first = s.tables.find((t) => t.kind === "table") ?? s.tables[0];
    if (first) currentTableName.value = first.name;
  }
});

function onKeydown(e: KeyboardEvent): void {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;

  const el = document.activeElement;
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  ) {
    return;
  }
  if (schema.value?.readOnly) return;

  e.preventDefault();
  void (e.shiftKey ? redoEdit() : undoEdit());
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div v-if="schema" class="app">
    <Sidebar />
    <main class="main">
      <template v-if="currentTable">
        <nav class="tabs">
          <button
            v-for="tab in TABS"
            :key="tab.id"
            class="tab"
            :class="{ active: currentTab === tab.id }"
            @click="currentTab = tab.id"
          >
            <i class="codicon" :class="tab.icon" aria-hidden="true"></i>{{ tab.label }}
          </button>
        </nav>
        <DataView v-if="currentTab === 'data'" />
        <StructureView v-else-if="currentTab === 'structure'" />
        <SqlConsole v-else />
      </template>
      <div v-else class="empty">This database has no tables or views.</div>
    </main>
  </div>
  <div v-else class="empty">Loading…</div>
  <ToastHost />
</template>
