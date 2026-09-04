<script setup lang="ts">
withDefaults(defineProps<{
  size?: number | string
}>(), {
  size: 34,
})
</script>

<template>
  <svg
    class="brand-mark"
    :style="{ '--brand-mark-size': typeof size === 'number' ? `${size}px` : size }"
    viewBox="0 0 1024 1024"
    aria-hidden="true"
  >
    <rect x="72" y="72" width="880" height="880" rx="216" fill="#191916" />
    <g transform="rotate(4 536 536)">
      <rect x="256" y="256" width="560" height="560" fill="#6f4cff" />
    </g>
    <g transform="rotate(-4 496 496)">
      <rect x="216" y="216" width="560" height="560" fill="#dfff54" />
      <path d="M354 330H638V416H542V610H450V416H354Z" fill="#171714" />
      <rect x="352" y="656" width="288" height="38" rx="19" fill="#171714" />
      <rect x="352" y="716" width="208" height="38" rx="19" fill="#171714" />
    </g>
  </svg>
</template>

<style scoped>
.brand-mark {
  display: block;
  flex: 0 0 auto;
  width: var(--brand-mark-size);
  height: var(--brand-mark-size);
  overflow: visible;
}
</style>
