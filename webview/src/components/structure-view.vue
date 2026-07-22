<script setup lang="ts">
import { useExplorer } from "../composables/use-explorer";

const { currentTable } = useExplorer();
</script>

<template>
  <div v-if="currentTable" class="structure">
    <h3>
      <i class="codicon codicon-symbol-structure" aria-hidden="true"></i>Columns —
      {{ currentTable.name }}
    </h3>
    <table class="meta">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Not Null</th>
          <th>Default</th>
          <th>PK</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in currentTable.columns" :key="c.name">
          <td>{{ c.name }}</td>
          <td>{{ c.type || "—" }}</td>
          <td>
            <i v-if="c.notNull" class="codicon codicon-check" role="img" aria-label="not null"></i>
          </td>
          <td>{{ c.defaultValue ?? "—" }}</td>
          <td>
            <i
              v-if="c.pk > 0"
              class="codicon codicon-key pk-key"
              role="img"
              :aria-label="`primary key ${c.pk}`"
              :title="`primary key (position ${c.pk})`"
            ></i>
          </td>
        </tr>
      </tbody>
    </table>

    <template v-if="currentTable.foreignKeys.length">
      <h3><i class="codicon codicon-references" aria-hidden="true"></i>Foreign Keys</h3>
      <table class="meta">
        <thead>
          <tr>
            <th>Column</th>
            <th>References</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(fk, i) in currentTable.foreignKeys" :key="i">
            <td>{{ fk.from }}</td>
            <td>
              <i class="codicon codicon-arrow-small-right" aria-hidden="true"></i>{{ fk.table }}.{{
                fk.to
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-if="currentTable.indexes.length">
      <h3><i class="codicon codicon-list-ordered" aria-hidden="true"></i>Indexes</h3>
      <table class="meta">
        <thead>
          <tr>
            <th>Name</th>
            <th>Unique</th>
            <th>Columns</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="idx in currentTable.indexes" :key="idx.name">
            <td>{{ idx.name }}</td>
            <td><span v-if="idx.unique" class="pill">unique</span></td>
            <td>{{ idx.columns.join(", ") }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
