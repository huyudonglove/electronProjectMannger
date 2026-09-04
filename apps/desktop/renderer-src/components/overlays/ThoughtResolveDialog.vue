<script setup lang="ts">
import { thoughtDisplayTitle, type AnyRecord } from '../../utils/record-formatters'
import DialogHeader from '../ui/DialogHeader.vue'
import FormActions from '../ui/FormActions.vue'
import ModalLayer from './ModalLayer.vue'

type ThoughtResolveForm = {
  answer: string
  status: string
}

const props = defineProps<{
  open: boolean
  busy: boolean
  thought: AnyRecord | null
  form: ThoughtResolveForm
}>()

const emit = defineEmits<{
  close: []
  submit: []
  'update:form': [form: ThoughtResolveForm]
}>()

function updateAnswer(event: Event) {
  emit('update:form', {
    ...props.form,
    answer: (event.target as HTMLTextAreaElement).value,
  })
}
</script>

<template>
  <ModalLayer
    :open="props.open"
    :busy="props.busy"
    as="form"
    title-id="thoughtResolveDialogTitle"
    panel-class="reply-dialog thought-resolve-dialog"
    @close="emit('close')"
    @submit="emit('submit')"
  >
    <template v-if="props.thought">
      <DialogHeader
        title-id="thoughtResolveDialogTitle"
        title="处理想法"
        :subtitle="`${props.thought.shortId || ''} ${thoughtDisplayTitle(props.thought)}`.trim()"
        @close="emit('close')"
      />
      <textarea
        :value="props.form.answer"
        rows="6"
        data-dialog-initial
        placeholder="记录结论、处理方式或下一步…"
        @input="updateAnswer"
      ></textarea>
      <FormActions
        :status="props.form.status"
        submit-label="标记已处理"
        submit-icon="check"
        :disabled="!props.form.answer.trim() || props.busy"
      />
    </template>
  </ModalLayer>
</template>
