<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from "vue";

const {
  title,
  description,
  size = "md",
  dismissible = true,
  closeOnBackdrop = true,
  showCloseButton = true,
  autoFocus = true,
} = defineProps<{
  title?: string;
  description?: string;
  dismissible?: boolean;
  size?: "sm" | "md" | "lg";
  closeOnBackdrop?: boolean;
  showCloseButton?: boolean;
  autoFocus?: boolean;
}>();

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const emit = defineEmits<{ close: [] }>();

const open = defineModel<boolean>("open", { default: false });

const dialogRef = useTemplateRef("dialogRef");
const panelRef = useTemplateRef("panelRef");
const titleId = useId();
const descId = useId();

const everOpened = ref(open.value);

watch(open, (isOpen) => {
  if (isOpen) everOpened.value = true;
  const el = dialogRef.value;
  if (!el) return;
  if (isOpen && !el.open) {
    el.showModal();
    void focusFirstField();
  } else if (!isOpen && el.open) {
    el.close();
  }
});

onMounted(() => {
  if (open.value) {
    dialogRef.value?.showModal();
    void focusFirstField();
  }
});

async function focusFirstField(): Promise<void> {
  if (!autoFocus) return;
  await nextTick();
  const body = panelRef.value?.querySelector<HTMLElement>('[data-part="body"]');
  body?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
}

onBeforeUnmount(() => {
  if (dialogRef.value?.open) dialogRef.value.close();
});

function close(): void {
  if (dismissible) open.value = false;
}

function onClose(): void {
  if (open.value) open.value = false;
  emit("close");
}

function onCancel(event: Event): void {
  if (!dismissible) event.preventDefault();
}

function onDialogClick(event: MouseEvent): void {
  if (!closeOnBackdrop || !dialogRef.value?.open) return;

  const panel = panelRef.value;
  if (!panel) return;

  const r = panel.getBoundingClientRect();
  const outside =
    event.clientX < r.left ||
    event.clientX > r.right ||
    event.clientY < r.top ||
    event.clientY > r.bottom;

  if (outside) close();
}
</script>

<template>
  <dialog
    ref="dialogRef"
    data-part="dialog"
    :data-dialog-size="size"
    :aria-labelledby="title ? titleId : undefined"
    :aria-describedby="description ? descId : undefined"
    @close="onClose"
    @cancel="onCancel"
    @click="onDialogClick"
  >
    <div ref="panelRef" data-part="panel">
      <header v-if="title || $slots.header" data-part="header">
        <slot name="header">
          <div data-part="header-text">
            <h2 :id="titleId" data-part="title">{{ title }}</h2>
            <p v-if="description" :id="descId" data-part="description">{{ description }}</p>
          </div>
        </slot>

        <button
          v-if="showCloseButton"
          type="button"
          data-part="close"
          aria-label="Close"
          @click="close"
        >
          <slot name="close-icon"><i class="codicon codicon-close" aria-hidden="true"></i></slot>
        </button>
      </header>

      <div v-if="everOpened" data-part="body">
        <slot :close="close" />
      </div>

      <footer v-if="$slots.footer" data-part="footer">
        <slot name="footer" :close="close" />
      </footer>
    </div>
  </dialog>
</template>
