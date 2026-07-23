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

  let frame = 0;
  function scheduleUpdate(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  }

  let resizeObserver: ResizeObserver | undefined;

  onMounted(() => {
    const c = container.value;
    if (!c) return;
    c.addEventListener("scroll", scheduleUpdate, { passive: true });
    resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(c);
    update();
  });
  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    container.value?.removeEventListener("scroll", scheduleUpdate);
  });

  watch(total, () => {
    if (container.value) container.value.scrollTop = 0;
    update();
  });

  return { start, end, update };
}
