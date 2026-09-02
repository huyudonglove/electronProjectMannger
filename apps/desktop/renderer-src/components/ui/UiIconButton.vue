<script setup lang="ts">
import { useAttrs } from 'vue'
import UiIcon from './UiIcon.vue'

type ButtonVariant = 'primary' | 'outline-primary' | 'outline-secondary' | 'ghost'
type ButtonSize = 'sm' | 'default'
type ButtonType = 'button' | 'submit' | 'reset'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  label: string
  icon: string
  variant?: ButtonVariant
  size?: ButtonSize
  type?: ButtonType
  disabled?: boolean
}>(), {
  variant: 'outline-secondary',
  size: 'default',
  type: 'button',
  disabled: false,
})

const attrs = useAttrs()
</script>

<template>
  <button
    v-bind="attrs"
    class="btn icon-button"
    :class="[`btn-${props.variant}`, { 'btn-sm': props.size === 'sm' }]"
    :type="props.type"
    :disabled="props.disabled"
    :title="props.label"
    :aria-label="props.label"
  >
    <UiIcon :name="props.icon" />
  </button>
</template>
