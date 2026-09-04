<script setup lang="ts">
import type { InputHTMLAttributes } from 'vue'
import { useAttrs } from 'vue'
import UiIcon from './UiIcon.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  inputAttrs?: InputHTMLAttributes
}>(), {
  placeholder: '',
  ariaLabel: '',
  disabled: false,
  inputAttrs: () => ({}),
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
}>()

const attrs = useAttrs()

function updateValue(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <label v-bind="attrs">
    <UiIcon name="search" />
    <input
      v-bind="props.inputAttrs"
      :value="props.modelValue"
      type="search"
      :placeholder="props.placeholder"
      :aria-label="props.ariaLabel || undefined"
      :disabled="props.disabled"
      @blur="emit('blur', $event)"
      @focus="emit('focus', $event)"
      @input="updateValue"
    />
  </label>
</template>
