<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  iconSvg?: string
  tone?: 'neutral' | 'complete' | 'warning' | 'danger'
  variant?: 'meta' | 'status'
}>(), {
  iconSvg: '',
  tone: 'neutral',
  variant: 'meta',
})
</script>

<template>
  <span class="ui-tag" :class="[`ui-tag--${variant}`, `ui-tag--${tone}`]">
    <span v-if="iconSvg" class="ui-tag-icon" aria-hidden="true" v-html="iconSvg" />
    <span>{{ label }}</span>
  </span>
</template>
