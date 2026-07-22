<script setup lang="ts">
import { useToast } from "../composables/use-toast";

const { toasts } = useToast();
</script>

<template>
  <TransitionGroup name="toast">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="{ error: t.isError }" role="status">
      <i
        class="codicon"
        :class="t.isError ? 'codicon-error' : 'codicon-check'"
        aria-hidden="true"
      ></i>
      <span>{{ t.message }}</span>
    </div>
  </TransitionGroup>
</template>
