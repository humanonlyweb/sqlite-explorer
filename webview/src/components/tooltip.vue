<script setup lang="ts">
const {
  text,
  placement = "top",
  align = "center",
} = defineProps<{
  text?: string;
  placement?: "top" | "bottom";
  align?: "start" | "center" | "end";
}>();
</script>

<template>
  <div data-part="tooltip-root">
    <slot />
    <span
      v-if="text"
      data-part="tooltip"
      :data-tooltip-placement="placement"
      :data-tooltip-align="align"
      role="tooltip"
      aria-hidden="true"
    >
      {{ text }}
    </span>
  </div>
</template>
