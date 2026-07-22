import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Ref } from "vue";

export const ROW_HEIGHT = 26;
const OVERSCAN = 8;

export function useVirtualRows(container: Ref<HTMLElement | null>, total: Ref<number>) {
  const start = ref(0);
  const end = ref(0);

  function update(): void {
    const c = container.value;
    if (!c) {
      start.value = 0;
      end.value = 0;
      return;
    }
    const scrollTop = c.scrollTop;
    const viewport = c.clientHeight || 400;
    start.value = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    end.value = Math.min(total.value, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  }

  const onScroll = () => update();

  onMounted(() => {
    container.value?.addEventListener("scroll", onScroll, { passive: true });
    update();
  });
  onBeforeUnmount(() => container.value?.removeEventListener("scroll", onScroll));

  watch(total, () => {
    if (container.value) container.value.scrollTop = 0;
    update();
  });

  return { start, end, update };
}
