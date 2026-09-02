<script setup lang="ts">
import UiIconButton from './UiIconButton.vue'

const props = withDefaults(defineProps<{
  status: string
  submitLabel: string
  submitIcon?: string
  disabled?: boolean
}>(), {
  submitIcon: '',
  disabled: false,
})
</script>

<template>
  <div class="quick-task-actions">
    <span>{{ props.status }}</span>
    <slot name="actions" />
    <UiIconButton
      v-if="props.submitIcon"
      :icon="props.submitIcon"
      :label="props.submitLabel"
      variant="primary"
      type="submit"
      :disabled="props.disabled"
    />
    <button v-else class="btn btn-primary" type="submit" :disabled="props.disabled">
      {{ props.submitLabel }}
    </button>
  </div>
</template>
