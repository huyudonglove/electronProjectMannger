<script setup lang="ts">
import UiIcon from './UiIcon.vue'

withDefaults(defineProps<{
  message?: string
  icon?: string
  compact?: boolean
}>(), {
  message: '',
  icon: '',
  compact: false,
})
</script>

<template>
  <div class="empty-panel" :class="{ 'empty-state': !compact, 'empty-panel--compact': compact }">
    <UiIcon v-if="icon" class="empty-state-icon" :name="icon" />
    <slot>
      <span v-if="compact && message">{{ message }}</span>
      <strong v-else-if="message">{{ message }}</strong>
    </slot>
    <slot name="actions" />
  </div>
</template>
