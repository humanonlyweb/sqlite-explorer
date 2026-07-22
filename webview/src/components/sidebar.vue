<script setup lang="ts">
import { computed } from "vue";

import { schema } from "../composables/use-db";
import { useExplorer } from "../composables/use-explorer";
import { formatCount } from "../util";

const { currentTableName, selectTable } = useExplorer();
const tables = computed(() => schema.value?.tables.filter((t) => t.kind === "table") ?? []);
const views = computed(() => schema.value?.tables.filter((t) => t.kind === "view") ?? []);
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <span class="db-name">
        <i class="codicon codicon-database" aria-hidden="true"></i>{{ schema?.fileName }}
      </span>
      <span v-if="schema?.readOnly" class="read-only-badge">
        <i class="codicon codicon-lock" aria-hidden="true"></i>read-only
      </span>
    </div>

    <div class="sidebar-group-label">Tables</div>
    <div
      v-for="t in tables"
      :key="t.name"
      class="tree-item"
      :class="{ active: currentTableName === t.name }"
      :title="t.name"
      @click="selectTable(t.name)"
    >
      <i class="codicon codicon-table icon" aria-hidden="true"></i>
      <span class="name">{{ t.name }}</span>
      <span class="count">{{ t.rowCount >= 0 ? formatCount(t.rowCount) : "" }}</span>
    </div>

    <template v-if="views.length">
      <div class="sidebar-group-label">Views</div>
      <div
        v-for="t in views"
        :key="t.name"
        class="tree-item"
        :class="{ active: currentTableName === t.name }"
        :title="t.name"
        @click="selectTable(t.name)"
      >
        <i class="codicon codicon-eye icon" aria-hidden="true"></i>
        <span class="name">{{ t.name }}</span>
        <span class="count">{{ t.rowCount >= 0 ? formatCount(t.rowCount) : "" }}</span>
      </div>
    </template>
  </aside>
</template>
