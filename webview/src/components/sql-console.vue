<script setup lang="ts">
import { computed } from "vue";

import { useExplorer } from "../composables/use-explorer";
import { useSqlConsole } from "../composables/use-sql-console";

import DataGrid from "./data-grid.vue";

const { currentTableName } = useExplorer();
const { sqlText, columns, rows, status, statusError, canExport, running, run, exportCsv } =
  useSqlConsole();

const placeholder = computed(
  () => `SELECT * FROM ${currentTableName.value ?? "…"}    (Cmd/Ctrl+Enter to run)`,
);
const canRun = computed(() => sqlText.value.trim() !== "");

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    void run();
  }
}
</script>

<template>
  <div class="sql-tab">
    <textarea
      v-model="sqlText"
      class="sql-editor"
      :placeholder="placeholder"
      spellcheck="false"
      @keydown="onKeydown"
    ></textarea>

    <div class="toolbar">
      <button :disabled="!canRun || running" @click="run">
        Run<i class="codicon codicon-play" aria-hidden="true"></i>
      </button>
      <button
        class="secondary"
        :disabled="!canExport"
        title="Export as CSV, SQL inserts, or JSON (pick the format in the save dialog)"
        @click="exportCsv"
      >
        <i class="codicon codicon-desktop-download" aria-hidden="true"></i>Export
      </button>
      <div class="spacer"></div>
    </div>

    <DataGrid
      :columns="columns"
      :rows="rows"
      :editable="false"
      :sortable="false"
      :show-filters="false"
      :sort="null"
      :filters="[]"
    />

    <div class="status-line" :class="{ error: statusError, muted: !statusError }">
      {{ status }}
    </div>
  </div>
</template>
