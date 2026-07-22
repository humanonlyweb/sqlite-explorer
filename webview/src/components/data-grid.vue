<script setup lang="ts">
import type { Filter, SortDir } from "@shared/protocol";
import { computed, nextTick, reactive, ref, watch, useTemplateRef } from "vue";

import { ROW_HEIGHT, useVirtualRows } from "../composables/use-virtual-rows";
import type { GridColumn } from "../types";
import { stringifyCell } from "../util";

const props = defineProps<{
  columns: GridColumn[];
  rows: unknown[][];
  editable: boolean;
  sortable: boolean;
  showFilters: boolean;
  sort: { column: string; dir: SortDir } | null;
  filters: Filter[];
}>();

const emit = defineEmits<{
  sort: [column: string];
  filter: [filters: Filter[]];
  edit: [rowIndex: number, column: string, value: string | null];
  fk: [table: string, column: string, value: string];
  selection: [indexes: number[]];
}>();

const scroller = useTemplateRef("scroller");
const total = computed(() => props.rows.length);
const { start, end } = useVirtualRows(scroller, total);

const visible = computed(() => {
  const out: number[] = [];
  for (let i = start.value; i < end.value; i++) out.push(i);
  return out;
});

// ---- Selection --------------------------------------------------------

const selected = ref<Set<number>>(new Set());
const allSelected = computed(
  () => props.rows.length > 0 && selected.value.size === props.rows.length,
);

function emitSelection(): void {
  emit("selection", [...selected.value]);
}
function toggleRow(i: number, checked: boolean): void {
  const next = new Set(selected.value);
  if (checked) next.add(i);
  else next.delete(i);
  selected.value = next;
  emitSelection();
}
function toggleAll(checked: boolean): void {
  selected.value = checked ? new Set(props.rows.map((_, i) => i)) : new Set();
  emitSelection();
}

watch(
  () => props.rows,
  () => {
    selected.value = new Set();
    emitSelection();
  },
);

// ---- Filters ----------------------------------------------------------

const filterModel = reactive<Record<string, string>>({});
let filterTimer: number | undefined;

// Resync inputs from props only when the set of columns changes (table switch
// or FK jump), never on the reloads triggered by typing — so focus is kept.
const columnsKey = computed(() => props.columns.map((c) => c.name).join(""));
watch(
  columnsKey,
  () => {
    for (const key of Object.keys(filterModel)) delete filterModel[key];
    for (const f of props.filters) filterModel[f.column] = f.value;
  },
  { immediate: true },
);

function onFilterInput(): void {
  clearTimeout(filterTimer);
  filterTimer = window.setTimeout(() => {
    const next: Filter[] = [];
    for (const col of props.columns) {
      const value = filterModel[col.name];
      if (value) next.push({ column: col.name, value });
    }
    emit("filter", next);
  }, 250);
}

// ---- Inline editing ---------------------------------------------------

const editing = ref<{ row: number; col: number } | null>(null);
const editDraft = ref("");
const editInputs = useTemplateRef("editInput");
let committed = false;

function isEditing(row: number, col: number): boolean {
  return editing.value?.row === row && editing.value.col === col;
}

function beginEdit(row: number, col: number): void {
  if (!props.editable) return;
  const v = props.rows[row][col];
  editDraft.value = v === null || v === undefined ? "" : stringifyCell(v);
  committed = false;
  editing.value = { row, col };
  void nextTick(() => {
    const input = editInputs.value?.[0];
    input?.focus();
    input?.select();
  });
}

function commit(value: string | null): void {
  if (committed || !editing.value) return;
  committed = true;
  const { row, col } = editing.value;
  editing.value = null;
  emit("edit", row, props.columns[col].name, value);
}

function onEditKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter") {
    e.preventDefault();
    commit(e.metaKey || e.ctrlKey ? null : editDraft.value);
  } else if (e.key === "Escape") {
    e.preventDefault();
    committed = true;
    editing.value = null;
  }
}

// ---- Cell presentation ------------------------------------------------

function isBlob(v: unknown): boolean {
  return typeof v === "object" && v !== null;
}
function blobLabel(v: unknown): string {
  return `[blob ${v instanceof Uint8Array ? v.length : 0} bytes]`;
}
function cellClasses(col: GridColumn, v: unknown): Record<string, boolean> {
  return {
    numeric: col.numeric,
    editable: props.editable,
    "null-value": v === null || v === undefined,
    "blob-value": isBlob(v),
  };
}
</script>

<template>
  <div ref="scroller" class="grid">
    <div class="grid-header">
      <div v-if="editable" class="hcell-checkbox">
        <input
          type="checkbox"
          :checked="allSelected"
          @change="toggleAll(($event.target as HTMLInputElement).checked)"
        />
      </div>
      <div
        v-for="col in columns"
        :key="col.name"
        class="hcell"
        :class="{ sortable }"
        :title="`${col.name} ${col.type}`"
        :role="sortable ? 'button' : undefined"
        :tabindex="sortable ? 0 : undefined"
        :aria-label="sortable ? `Sort by ${col.name}` : undefined"
        @click="sortable && emit('sort', col.name)"
        @keydown.enter.prevent="sortable && emit('sort', col.name)"
        @keydown.space.prevent="sortable && emit('sort', col.name)"
      >
        <span class="name">{{ col.name }}</span>
        <i
          v-if="col.pk"
          class="codicon codicon-key pk-key"
          role="img"
          aria-label="primary key"
          title="primary key"
        ></i>
        <span v-if="col.type" class="type">{{ col.type }}</span>
        <span v-if="sort?.column === col.name" class="sort-arrow">
          <i
            class="codicon"
            :class="sort.dir === 'asc' ? 'codicon-chevron-up' : 'codicon-chevron-down'"
            aria-hidden="true"
          ></i>
        </span>
      </div>
    </div>

    <div v-if="showFilters" class="grid-filters">
      <div v-if="editable" class="cell-checkbox"></div>
      <div v-for="col in columns" :key="col.name" class="fcell">
        <input
          v-model="filterModel[col.name]"
          type="text"
          placeholder="filter…"
          @input="onFilterInput"
        />
      </div>
    </div>

    <div class="grid-body" :style="{ height: `${rows.length * ROW_HEIGHT}px` }">
      <div
        v-for="i in visible"
        :key="i"
        class="grid-row"
        :class="{ selected: selected.has(i) }"
        :style="{ top: `${i * ROW_HEIGHT}px` }"
      >
        <div v-if="editable" class="cell-checkbox">
          <input
            type="checkbox"
            :checked="selected.has(i)"
            @change="toggleRow(i, ($event.target as HTMLInputElement).checked)"
          />
        </div>
        <div
          v-for="(col, ci) in columns"
          :key="ci"
          class="cell"
          :class="cellClasses(col, rows[i][ci])"
          @dblclick="beginEdit(i, ci)"
        >
          <input
            v-if="isEditing(i, ci)"
            ref="editInput"
            v-model="editDraft"
            class="cell-input"
            type="text"
            title="Enter to save · Esc to cancel · Cmd/Ctrl+Enter for NULL"
            @keydown="onEditKeydown"
            @blur="commit(editDraft)"
          />
          <template v-else-if="rows[i][ci] === null || rows[i][ci] === undefined">NULL</template>
          <template v-else-if="isBlob(rows[i][ci])">{{ blobLabel(rows[i][ci]) }}</template>
          <span
            v-else-if="col.fk"
            class="fk-link"
            role="link"
            tabindex="0"
            :title="`Go to ${col.fk.table}.${col.fk.to}`"
            :aria-label="`Go to ${col.fk.table}.${col.fk.to}: ${stringifyCell(rows[i][ci])}`"
            @click.stop="emit('fk', col.fk.table, col.fk.to, stringifyCell(rows[i][ci]))"
            @keydown.enter.stop.prevent="
              emit('fk', col.fk.table, col.fk.to, stringifyCell(rows[i][ci]))
            "
          >
            {{ stringifyCell(rows[i][ci]) }}
          </span>
          <template v-else>{{ stringifyCell(rows[i][ci]) }}</template>
        </div>
      </div>
    </div>
  </div>
</template>
