<script setup lang="ts">
import type { TableSchema } from "@shared/protocol";
import { computed, reactive, watch } from "vue";

import { stringifyCell } from "../util";

import Dialog from "./dialog/index.vue";
import Tooltip from "./tooltip.vue";

const props = defineProps<{
  table: TableSchema;
  values: Record<string, unknown>;
  busy?: boolean;
}>();
const emit = defineEmits<{ submit: [values: Record<string, string | null>] }>();
const open = defineModel<boolean>("open", { default: false });

interface FieldState {
  value: string;
  nulled: boolean;
  origValue: string;
  origNulled: boolean;
  isBlob: boolean;
}
const fields = reactive<Record<string, FieldState>>({});

function isBlob(v: unknown): boolean {
  return typeof v === "object" && v !== null;
}

function seed(): void {
  for (const key of Object.keys(fields)) delete fields[key];
  for (const c of props.table.columns) {
    const v = props.values[c.name];
    const nulled = v === null || v === undefined;
    const blob = isBlob(v);
    const str = nulled || blob ? "" : stringifyCell(v);
    fields[c.name] = { value: str, nulled, origValue: str, origNulled: nulled, isBlob: blob };
  }
}

const columnsKey = computed(() => props.table.columns.map((c) => c.name).join("\0"));
watch(columnsKey, seed, { immediate: true });
watch(open, (isOpen) => isOpen && seed());

function fieldId(index: number): string {
  return `edit-field-${index}`;
}

function toggleNull(name: string): void {
  const f = fields[name];
  f.nulled = !f.nulled;
  if (f.nulled) f.value = "";
}

function submit(): void {
  if (props.busy) return;
  const changed: Record<string, string | null> = {};
  for (const c of props.table.columns) {
    const f = fields[c.name];
    if (f.isBlob) continue;
    if (f.nulled !== f.origNulled || f.value !== f.origValue) {
      changed[c.name] = f.nulled ? null : f.value;
    }
  }
  emit("submit", changed);
}
</script>

<template>
  <Dialog v-model:open="open" size="md" title="Edit row" :description="`In ${table.name}`">
    <form id="edit-row-form" @submit.prevent="submit">
      <div v-for="(c, i) in table.columns" :key="c.name" class="form-row">
        <label :for="fieldId(i)" :title="`${c.name} ${c.type}`">
          {{ c.name }}
          <Tooltip v-if="c.pk" text="Primary key" placement="bottom">
            <i class="codicon codicon-key pk-key" role="img" aria-label="Primary key"></i>
          </Tooltip>
        </label>
        <div class="field">
          <input
            :id="fieldId(i)"
            v-model="fields[c.name].value"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :disabled="fields[c.name].nulled || fields[c.name].isBlob"
            :placeholder="
              fields[c.name].isBlob ? '[blob — not editable]' : fields[c.name].nulled ? 'NULL' : ''
            "
          />
          <Tooltip
            :text="fields[c.name].nulled ? 'Unset NULL' : 'Set value to NULL'"
            placement="bottom"
            align="end"
          >
            <button
              type="button"
              class="secondary"
              :class="{ active: fields[c.name].nulled }"
              :disabled="fields[c.name].isBlob"
              :aria-label="fields[c.name].nulled ? 'Unset NULL' : 'Set value to NULL'"
              :aria-pressed="fields[c.name].nulled"
              @click="toggleNull(c.name)"
            >
              <i class="codicon codicon-circle-slash" aria-hidden="true"></i>
            </button>
          </Tooltip>
        </div>
      </div>
    </form>

    <template #footer>
      <button type="button" class="secondary" @click="open = false">Cancel</button>
      <button type="submit" form="edit-row-form" :disabled="busy">Save</button>
    </template>
  </Dialog>
</template>
