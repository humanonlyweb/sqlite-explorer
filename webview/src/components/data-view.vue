<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import { useExplorer } from "../composables/use-explorer";
import { useTableData } from "../composables/use-table-data";
import { formatCount } from "../util";

import DataGrid from "./data-grid.vue";
import ConfirmDialog from "./dialog/confirm.vue";
import EditModal from "./edit-modal.vue";
import InsertModal from "./insert-modal.vue";

const { currentTable, navigateToFk } = useExplorer();
const {
  columns,
  rows,
  editable,
  sort,
  filters,
  page,
  pageSize,
  pageCount,
  total,
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
} = useTableData();

onMounted(() => void load());
watch(currentTable, () => syncTable());

const PAGE_SIZES = [100, 500, 1000, 5000, 20000];

const selectedIndexes = ref<number[]>([]);
const showInsert = ref(false);
const inserting = ref(false);
const showDeleteConfirm = ref(false);
const showEdit = ref(false);
const editing = ref(false);

const editIndex = computed(() =>
  selectedIndexes.value.length === 1 ? selectedIndexes.value[0] : -1,
);
const editValues = computed<Record<string, unknown>>(() => {
  const i = editIndex.value;
  if (i < 0) return {};
  const row = rows.value[i];
  const out: Record<string, unknown> = {};
  columns.value.forEach((c, ci) => (out[c.name] = row?.[ci]));
  return out;
});

const rangeLabel = computed(() => {
  const from = total.value === 0 ? 0 : page.value * pageSize.value + 1;
  const to = Math.min(total.value, (page.value + 1) * pageSize.value);
  return `${formatCount(from)}–${formatCount(to)} of ${formatCount(total.value)}`;
});

async function onDeleteConfirmed(): Promise<void> {
  await deleteRowsByIndex(selectedIndexes.value);
  selectedIndexes.value = [];
}

async function onEditSubmit(values: Record<string, string | null>): Promise<void> {
  if (editing.value || editIndex.value < 0) return;
  editing.value = true;
  try {
    if (await updateRow(editIndex.value, values)) showEdit.value = false;
  } finally {
    editing.value = false;
  }
}

async function onInsert(values: Record<string, string | null>): Promise<void> {
  if (inserting.value) return;
  inserting.value = true;
  try {
    if (await insertRow(values)) showInsert.value = false;
  } finally {
    inserting.value = false;
  }
}
</script>

<template>
  <div class="tab-body">
    <div class="toolbar">
      <template v-if="editable">
        <button @click="showInsert = true">
          <i class="codicon codicon-add" aria-hidden="true"></i>Add row
        </button>
        <button class="secondary" :disabled="selectedIndexes.length !== 1" @click="showEdit = true">
          <i class="codicon codicon-edit" aria-hidden="true"></i>Edit row
        </button>
        <button
          class="secondary"
          :disabled="selectedIndexes.length === 0"
          @click="showDeleteConfirm = true"
        >
          <i class="codicon codicon-trash" aria-hidden="true"></i>
          {{ selectedIndexes.length ? `Delete (${selectedIndexes.length})` : "Delete" }}
        </button>
      </template>
      <span v-else-if="currentTable && !currentTable.hasRowId" class="muted">
        read-only (no rowid)
      </span>
      <button class="secondary" @click="load">
        <i class="codicon codicon-refresh" aria-hidden="true"></i>Refresh
      </button>
      <button
        class="secondary"
        title="Export as CSV, SQL inserts, or JSON (pick the format in the save dialog)"
        @click="exportCsv(selectedIndexes)"
      >
        <i class="codicon codicon-desktop-download" aria-hidden="true"></i>
        {{ selectedIndexes.length ? `Export selected (${selectedIndexes.length})` : "Export" }}
      </button>
      <div class="spacer"></div>
    </div>

    <DataGrid
      :columns="columns"
      :rows="rows"
      :editable="editable"
      :sortable="true"
      :show-filters="true"
      :sort="sort"
      :filters="filters"
      @sort="toggleSort"
      @filter="setFilters"
      @edit="commitEdit"
      @fk="navigateToFk"
      @selection="(indexes) => (selectedIndexes = indexes)"
    />

    <div class="toolbar">
      <button class="secondary" :disabled="page <= 0" @click="setPage(page - 1)">
        <i class="codicon codicon-chevron-left" aria-hidden="true"></i>Prev
      </button>
      <button class="secondary" :disabled="page >= pageCount - 1" @click="setPage(page + 1)">
        Next<i class="codicon codicon-chevron-right" aria-hidden="true"></i>
      </button>
      <span class="muted">{{ rangeLabel }}</span>
      <div class="spacer"></div>
      <span class="muted">Rows per page:</span>
      <select
        :value="pageSize"
        @change="setPageSize(Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }}</option>
      </select>
      <span class="muted">Page {{ page + 1 }} / {{ pageCount }}</span>
    </div>

    <InsertModal
      v-if="currentTable"
      v-model:open="showInsert"
      :table="currentTable"
      :busy="inserting"
      @submit="onInsert"
    />

    <ConfirmDialog
      v-model:open="showDeleteConfirm"
      title="Delete rows?"
      :description="`Permanently delete ${selectedIndexes.length} row${
        selectedIndexes.length === 1 ? '' : 's'
      }? This writes to the database immediately and can't be undone.`"
      confirm-text="Delete"
      danger
      @confirm="onDeleteConfirmed"
    />

    <EditModal
      v-if="currentTable"
      v-model:open="showEdit"
      :table="currentTable"
      :values="editValues"
      :busy="editing"
      @submit="onEditSubmit"
    />
  </div>
</template>
