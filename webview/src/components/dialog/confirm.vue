<script setup lang="ts">
import Dialog from "./index.vue";

const {
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = false,
} = defineProps<{
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}>();

const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ confirm: []; cancel: [] }>();

// Distinguish an explicit choice from a dismiss (Esc), so onClose can report the
// dismiss as a cancel without double-emitting on the button paths.
let decided = false;

function confirm(): void {
  decided = true;
  emit("confirm");
  open.value = false;
}

function cancel(): void {
  decided = true;
  emit("cancel");
  open.value = false;
}

function onClose(): void {
  if (!decided) emit("cancel");
  decided = false;
}
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="title"
    :description="description"
    :close-on-backdrop="false"
    :show-close-button="false"
    @close="onClose"
  >
    <slot />

    <template #footer>
      <button type="button" class="secondary" @click="cancel">{{ cancelText }}</button>
      <button type="button" :class="{ danger }" :autofocus="!danger" @click="confirm">
        {{ confirmText }}
      </button>
    </template>
  </Dialog>
</template>
