<script setup lang="ts">
import type { AnyRecord } from '../../utils/record-formatters'
import DialogHeader from '../ui/DialogHeader.vue'
import FormActions from '../ui/FormActions.vue'
import ModalLayer from './ModalLayer.vue'

interface ReplyForm {
  answer: string
  status: string
}

const props = defineProps<{
  open: boolean
  busy: boolean
  item: AnyRecord | null
  form: ReplyForm
}>()

const emit = defineEmits<{
  close: []
  submit: []
  'update:form': [form: ReplyForm]
}>()

function replyDialogTitle(item: AnyRecord) {
  if (item.status === 'resolved' || item.status === 'expired') return '继续讨论'
  if (item.status === 'decided') return '补充说明'
  return '回复协作问题'
}

function updateAnswer(event: Event) {
  emit('update:form', {
    ...props.form,
    answer: (event.target as HTMLTextAreaElement).value,
  })
}
</script>

<template>
  <ModalLayer
    :open="open"
    :busy="busy"
    as="form"
    title-id="replyDialogTitle"
    panel-class="reply-dialog"
    @close="emit('close')"
    @submit="emit('submit')"
  >
    <template v-if="item">
      <DialogHeader title-id="replyDialogTitle" :title="replyDialogTitle(item)" :subtitle="item.question || '协作内容'" @close="emit('close')" />
      <textarea
        :value="form.answer"
        rows="5"
        data-dialog-initial
        placeholder="写下回复、补充说明或新的问题。"
        @input="updateAnswer"
      ></textarea>
      <FormActions :status="form.status" submit-label="发送回复" submit-icon="check" />
    </template>
  </ModalLayer>
</template>
