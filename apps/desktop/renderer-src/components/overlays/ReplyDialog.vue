<script setup lang="ts">
import type { AnyRecord } from '../../utils/record-formatters'
import UiIcon from '../ui/UiIcon.vue'
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
      <div class="project-dialog-head">
        <div>
          <h2 id="replyDialogTitle">{{ replyDialogTitle(item) }}</h2>
          <p>{{ item.question || '协作内容' }}</p>
        </div>
        <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="关闭" aria-label="关闭" @click="emit('close')">
          <UiIcon name="x" />
        </button>
      </div>
      <textarea
        :value="form.answer"
        rows="5"
        data-dialog-initial
        placeholder="写下回复、补充说明或新的问题。"
        @input="updateAnswer"
      ></textarea>
      <div class="quick-task-actions">
        <span>{{ form.status }}</span>
        <button class="btn icon-button btn-primary" type="submit" title="发送回复" aria-label="发送回复">
          <UiIcon name="check" />
        </button>
      </div>
    </template>
  </ModalLayer>
</template>
