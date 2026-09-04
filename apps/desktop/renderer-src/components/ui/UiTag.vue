<script setup lang="ts">
import UiIcon from './UiIcon.vue'

withDefaults(defineProps<{
  label: string
  iconName?: string
  tone?: 'neutral' | 'complete' | 'warning' | 'danger'
  variant?: 'meta' | 'status'
}>(), {
  iconName: '',
  tone: 'neutral',
  variant: 'meta',
})
</script>

<template>
  <span class="ui-tag" :class="[`ui-tag--${variant}`, `ui-tag--${tone}`]">
    <UiIcon v-if="iconName" class="ui-tag-icon" :name="iconName" :size="12" />
    <span>{{ label }}</span>
  </span>
</template>
