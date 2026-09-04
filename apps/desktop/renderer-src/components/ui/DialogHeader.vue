<script setup lang="ts">
import UiIconButton from './UiIconButton.vue'

const props = withDefaults(defineProps<{
  titleId: string
  title: string
  subtitle?: string
  closeDisabled?: boolean
  initialFocus?: boolean
  closeLabel?: string
}>(), {
  subtitle: '',
  closeDisabled: false,
  initialFocus: false,
  closeLabel: '关闭',
})

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div class="project-dialog-head">
    <div>
      <slot name="badges" />
      <h2
        :id="props.titleId"
        :tabindex="props.initialFocus ? -1 : undefined"
        :data-dialog-initial="props.initialFocus ? '' : undefined"
      >
        {{ props.title }}
      </h2>
      <p v-if="props.subtitle">{{ props.subtitle }}</p>
    </div>
    <span>
      <slot name="actions" />
      <UiIconButton
        icon="x"
        variant="outline-secondary"
        size="sm"
        :label="props.closeLabel"
        :disabled="props.closeDisabled"
        @click="emit('close')"
      />
    </span>
  </div>
</template>
