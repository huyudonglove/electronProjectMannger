<script setup lang="ts">
import { NSelect } from 'naive-ui'

type SelectOption = {
  label: string
  value: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue: string
  options: SelectOption[]
  ariaLabel?: string
  disabled?: boolean
  compact?: boolean
}>(), {
  ariaLabel: '',
  disabled: false,
  compact: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

function updateValue(value: string | null) {
  if (value !== null) emit('update:modelValue', value)
}
</script>

<template>
  <NSelect
    class="ui-select"
    :class="{ 'ui-select--compact': props.compact }"
    :value="props.modelValue"
    :options="props.options"
    :disabled="props.disabled"
    :aria-label="props.ariaLabel || undefined"
    :consistent-menu-width="false"
    size="small"
    @update:value="updateValue"
  />
</template>
