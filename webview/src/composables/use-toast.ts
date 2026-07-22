import { readonly, ref } from "vue";

export interface Toast {
  id: number;
  message: string;
  isError: boolean;
}

const toasts = ref<Toast[]>([]);
let seq = 0;

export function showToast(message: string, isError = false): void {
  const id = ++seq;
  toasts.value = [{ id, message, isError }];

  window.setTimeout(
    () => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    },
    isError ? 6000 : 2500,
  );
}

export function useToast() {
  return { toasts: readonly(toasts) };
}
