<script setup lang="ts">
import { questionKindOptions, questionScopeOptions } from '../../config/ui'
import DialogHeader from '../ui/DialogHeader.vue'
import FormActions from '../ui/FormActions.vue'
import UiSelect from '../ui/UiSelect.vue'
import ModalLayer from './ModalLayer.vue'

interface QuestionForm {
  title: string
  question: string
  background: string
  recommendation: string
  kind: string
  scope: string
  blocking: boolean
  status: string
}

const props = withDefaults(defineProps<{
  open: boolean
  form: QuestionForm
  busy?: boolean
}>(), {
  busy: false,
})

const emit = defineEmits<{
  close: []
  submit: []
  'update:form': [form: QuestionForm]
}>()

function eventValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value
}

function eventChecked(event: Event) {
  return (event.target as HTMLInputElement).checked
}

function updateForm(patch: Partial<QuestionForm>) {
  emit('update:form', { ...props.form, ...patch })
}
</script>

<template>
  <ModalLayer
    :open="open"
    :busy="busy"
    as="form"
    title-id="questionDialogTitle"
    panel-class="record-dialog"
    @close="emit('close')"
    @submit="emit('submit')"
  >
    <DialogHeader title-id="questionDialogTitle" title="发起协作" @close="emit('close')" />
    <label><span>标题</span><input :value="form.title" type="text" data-dialog-initial @input="updateForm({ title: eventValue($event) })" /></label>
    <label><span>内容</span><textarea :value="form.question" rows="3" placeholder="需要讨论或落实什么？" @input="updateForm({ question: eventValue($event) })"></textarea></label>
    <label><span>背景</span><textarea :value="form.background" rows="2" placeholder="必要上下文" @input="updateForm({ background: eventValue($event) })"></textarea></label>
    <label><span>建议</span><textarea :value="form.recommendation" rows="2" placeholder="处理建议（可选）" @input="updateForm({ recommendation: eventValue($event) })"></textarea></label>
    <div class="record-dialog-grid">
      <label><span>类型</span><UiSelect :model-value="form.kind" :options="questionKindOptions" aria-label="类型" @update:model-value="updateForm({ kind: $event })" /></label>
      <label><span>范围</span><UiSelect :model-value="form.scope" :options="questionScopeOptions" aria-label="范围" @update:model-value="updateForm({ scope: $event })" /></label>
    </div>
    <label class="checkbox-row"><input :checked="form.blocking" type="checkbox" @change="updateForm({ blocking: eventChecked($event) })" /><span>阻塞当前工作</span></label>
    <FormActions :status="form.status" submit-label="提交记录" submit-icon="check" />
  </ModalLayer>
</template>
