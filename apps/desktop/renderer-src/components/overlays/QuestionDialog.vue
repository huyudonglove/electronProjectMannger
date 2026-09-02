<script setup lang="ts">
import { questionKindOptions, questionScopeOptions } from '../../config/ui'
import UiIcon from '../ui/UiIcon.vue'
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
    <div class="project-dialog-head">
      <div><h2 id="questionDialogTitle">发起协作记录</h2><p>提交后会进入“待跟进”。</p></div>
      <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="关闭" aria-label="关闭" @click="emit('close')"><UiIcon name="x" /></button>
    </div>
    <label><span>标题</span><input :value="form.title" type="text" data-dialog-initial placeholder="需要继续跟进什么" @input="updateForm({ title: eventValue($event) })" /></label>
    <label><span>内容</span><textarea :value="form.question" rows="3" placeholder="写下问题、决定或需要落实的事项。" @input="updateForm({ question: eventValue($event) })"></textarea></label>
    <label><span>背景</span><textarea :value="form.background" rows="2" placeholder="补充必要的上下文。" @input="updateForm({ background: eventValue($event) })"></textarea></label>
    <label><span>建议</span><textarea :value="form.recommendation" rows="2" placeholder="可选：你倾向的处理方式。" @input="updateForm({ recommendation: eventValue($event) })"></textarea></label>
    <div class="record-dialog-grid">
      <label><span>类型</span><UiSelect :model-value="form.kind" :options="questionKindOptions" aria-label="类型" @update:model-value="updateForm({ kind: $event })" /></label>
      <label><span>范围</span><UiSelect :model-value="form.scope" :options="questionScopeOptions" aria-label="范围" @update:model-value="updateForm({ scope: $event })" /></label>
    </div>
    <label class="checkbox-row"><input :checked="form.blocking" type="checkbox" @change="updateForm({ blocking: eventChecked($event) })" /><span>阻塞当前工作</span></label>
    <div class="quick-task-actions"><span>{{ form.status }}</span><button class="btn btn-primary" type="submit">提交记录</button></div>
  </ModalLayer>
</template>
