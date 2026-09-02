<script setup lang="ts">
import { useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  title: string
  countText?: string
}>(), {
  countText: '',
})

const attrs = useAttrs()
</script>

<template>
  <div v-bind="attrs" class="section-head compact-head">
    <h2>{{ props.title }}</h2>
    <span v-if="props.countText">{{ props.countText }}</span>
    <slot name="actions" />
  </div>
</template>
