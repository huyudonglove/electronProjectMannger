<script setup lang="ts">
import { computed, useAttrs } from 'vue'

type AriaCurrent = boolean | 'page' | 'step' | 'location' | 'date' | 'time'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  active?: boolean
  ariaCurrent?: AriaCurrent
  disabled?: boolean
}>(), {
  active: false,
  disabled: false,
})

const attrs = useAttrs()
const resolvedAriaCurrent = computed(() => (
  props.ariaCurrent === undefined
    ? (props.active ? 'true' : undefined)
    : String(props.ariaCurrent)
))
</script>

<template>
  <button
    v-bind="attrs"
    type="button"
    :class="{ active: props.active }"
    :aria-current="resolvedAriaCurrent"
    :disabled="props.disabled"
  >
    <slot />
  </button>
</template>
