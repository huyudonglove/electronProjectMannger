<script setup lang="ts">
import FormActions from '../ui/FormActions.vue'
import UiIconButton from '../ui/UiIconButton.vue'

const props = withDefaults(defineProps<{
  title: string
  targetLabel: string
  ariaLabel: string
  status: string
  submitLabel: string
  submitIcon?: string
}>(), {
  submitIcon: '',
})

const emit = defineEmits<{
  close: []
  submit: []
}>()
</script>

<template>
  <form
    class="card quick-task-panel"
    :aria-label="props.ariaLabel"
    @submit.prevent="emit('submit')"
  >
    <div class="quick-task-head">
      <div class="quick-task-heading">
        <strong>{{ props.title }}</strong>
        <small>记录到 {{ props.targetLabel }}</small>
      </div>
      <UiIconButton icon="x" label="关闭" size="sm" @click="emit('close')" />
    </div>

    <slot />

    <FormActions
      :status="props.status"
      :submit-label="props.submitLabel"
      :submit-icon="props.submitIcon"
    >
      <template #actions>
        <slot name="actions" />
      </template>
    </FormActions>
  </form>
</template>
