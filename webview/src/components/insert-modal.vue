<script setup lang="ts">
import type { TableSchema } from "@shared/protocol";
import { computed, reactive, watch } from "vue";

import Dialog from "./dialog/index.vue";
import Tooltip from "./tooltip.vue";

const props = defineProps<{ table: TableSchema; busy?: boolean }>();
const emit = defineEmits<{ submit: [values: Record<string, string | null>] }>();
const open = defineModel<boolean>("open", { default: false });

interface FieldState {
  value: string;
  nulled: boolean;
}
const fields = reactive<Record<string, FieldState>>({});

function reset(): void {
  for (const key of Object.keys(fields)) delete fields[key];
  for (const c of props.table.columns) fields[c.name] = { value: "", nulled: false };
}

const columnsKey = computed(() => props.table.columns.map((c) => c.name).join("\0"));
watch(columnsKey, reset, { immediate: true });
watch(open, (isOpen) => isOpen && reset());

function fieldId(index: number): string {
  return `insert-field-${index}`;
}

function toggleNull(name: string): void {
  const f = fields[name];
  f.nulled = !f.nulled;
  if (f.nulled) f.value = "";
}

function submit(): void {
  if (props.busy) return;
  const values: Record<string, string | null> = {};
  for (const c of props.table.columns) {
    const f = fields[c.name];
    if (f.nulled) values[c.name] = null;
    else if (f.value !== "") values[c.name] = f.value;
    // otherwise omit -> the column default (or NULL) applies
  }
  emit("submit", values);
}
</script>

<template>
  <Dialog v-model:open="open" size="md" :title="`Insert into ${table.name}`">
    <form id="insert-row-form" @submit.prevent="submit">
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
            :disabled="fields[c.name].nulled"
            :placeholder="
              fields[c.name].nulled ? 'NULL' : c.defaultValue ? `default: ${c.defaultValue}` : ''
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
      <button type="submit" form="insert-row-form" :disabled="busy">Insert</button>
    </template>
  </Dialog>
</template>
