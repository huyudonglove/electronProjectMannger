<script setup lang="ts">
import { computed } from 'vue'
import { questionKindOptions, questionScopeOptions } from '../../config/ui'
import type { EditableRecordKind, RecordEditForm } from '../../composables/useRecordEditController'
import DialogHeader from '../ui/DialogHeader.vue'
import FormActions from '../ui/FormActions.vue'
import UiSelect from '../ui/UiSelect.vue'
import ModalLayer from './ModalLayer.vue'

const props = withDefaults(defineProps<{
  open: boolean
  busy: boolean
  kind: EditableRecordKind | null
  form: RecordEditForm
  compact?: boolean
}>(), {
  compact: false,
})

const emit = defineEmits<{
  close: []
  submit: []
  'update:form': [form: RecordEditForm]
}>()

const dialogTitle = computed(() => `编辑${({
  task: '任务',
  thought: '想法',
  research: '研究',
  constraint: '约束',
  version: '版本',
  question: '协作记录',
} as Record<EditableRecordKind, string>)[props.kind || 'task']}`)

const priorityOptions = [
  { label: '普通', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '低', value: 'low' },
]

const workLevelOptions = [
  { label: '轻量', value: 'light' },
  { label: '标准', value: 'standard' },
  { label: '深度', value: 'deep' },
]

const depthReasonOptions = [
  { label: '架构', value: 'architecture' },
  { label: '迁移', value: 'migration' },
  { label: '跨系统', value: 'cross_system' },
  { label: '权限安全', value: 'security' },
  { label: '不可逆', value: 'irreversible' },
  { label: '方案取舍', value: 'decision' },
]

const researchModeOptions = [
  { label: '广度', value: 'breadth' },
  { label: '深度', value: 'depth' },
]

function updateForm(patch: Partial<RecordEditForm>) {
  emit('update:form', { ...props.form, ...patch })
}

function eventValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value
}

function eventChecked(event: Event) {
  return (event.target as HTMLInputElement).checked
}
</script>

<template>
  <ModalLayer
    :open="props.open"
    :busy="props.busy"
    :dismissible="!props.busy"
    as="form"
    title-id="recordEditDialogTitle"
    overlay-class="record-edit-overlay"
    :panel-class="['record-dialog', 'record-edit-dialog', { 'is-compact': props.compact }]"
    @close="emit('close')"
    @submit="emit('submit')"
  >
    <DialogHeader
      title-id="recordEditDialogTitle"
      :title="dialogTitle"
      :close-disabled="props.busy"
      @close="emit('close')"
    />

    <div class="record-edit-fields">
      <template v-if="props.kind === 'task'">
        <label><span>任务标题</span><input :value="props.form.title" type="text" data-dialog-initial :disabled="props.busy" @input="updateForm({ title: eventValue($event) })" /></label>
        <label><span>用户原话</span><textarea :value="props.form.userOriginal" rows="2" :disabled="props.busy" @input="updateForm({ userOriginal: eventValue($event) })"></textarea></label>
        <label><span>执行定义</span><textarea :value="props.form.detail" rows="3" :disabled="props.busy" @input="updateForm({ detail: eventValue($event) })"></textarea></label>
        <label><span>验收标准</span><textarea :value="props.form.acceptance" rows="2" :disabled="props.busy" @input="updateForm({ acceptance: eventValue($event) })"></textarea></label>
        <div class="record-dialog-grid">
          <label><span>优先级</span><UiSelect :model-value="props.form.priority" :options="priorityOptions" aria-label="优先级" :disabled="props.busy" @update:model-value="updateForm({ priority: $event })" /></label>
          <label><span>工作等级</span><UiSelect :model-value="props.form.workLevel" :options="workLevelOptions" aria-label="工作等级" :disabled="props.busy" @update:model-value="updateForm({ workLevel: $event as RecordEditForm['workLevel'] })" /></label>
        </div>
        <template v-if="props.form.workLevel === 'deep'">
          <label><span>深度原因</span><UiSelect :model-value="props.form.depthReason" :options="depthReasonOptions" aria-label="深度原因" :disabled="props.busy" @update:model-value="updateForm({ depthReason: $event })" /></label>
          <label><span>关键约束</span><textarea :value="props.form.constraints" rows="2" :disabled="props.busy" @input="updateForm({ constraints: eventValue($event) })"></textarea></label>
          <label><span>方案、取舍与回退</span><textarea :value="props.form.planRollback" rows="3" :disabled="props.busy" @input="updateForm({ planRollback: eventValue($event) })"></textarea></label>
        </template>
      </template>

      <template v-else-if="props.kind === 'thought'">
        <label><span>内容</span><textarea :value="props.form.content" rows="6" data-dialog-initial :disabled="props.busy" @input="updateForm({ content: eventValue($event) })"></textarea></label>
        <label><span>处理说明</span><textarea :value="props.form.answer" rows="4" :disabled="props.busy" placeholder="未处理时可留空" @input="updateForm({ answer: eventValue($event) })"></textarea></label>
      </template>

      <template v-else-if="props.kind === 'research'">
        <label><span>研究模式</span><UiSelect :model-value="props.form.mode" :options="researchModeOptions" aria-label="研究模式" :disabled="props.busy" @update:model-value="updateForm({ mode: $event as RecordEditForm['mode'] })" /></label>
        <label><span>研究内容</span><textarea :value="props.form.content" rows="5" data-dialog-initial :disabled="props.busy" @input="updateForm({ content: eventValue($event) })"></textarea></label>
        <label><span>研究结果</span><textarea :value="props.form.answer" rows="6" :disabled="props.busy" placeholder="尚未研究时可留空" @input="updateForm({ answer: eventValue($event) })"></textarea></label>
        <label><span>验收标准</span><textarea :value="props.form.acceptance" rows="3" :disabled="props.busy" @input="updateForm({ acceptance: eventValue($event) })"></textarea></label>
      </template>

      <template v-else-if="props.kind === 'constraint'">
        <label><span>约束标题</span><input :value="props.form.title" type="text" data-dialog-initial :disabled="props.busy" @input="updateForm({ title: eventValue($event) })" /></label>
        <label><span>约束内容</span><textarea :value="props.form.content" rows="8" :disabled="props.busy" @input="updateForm({ content: eventValue($event) })"></textarea></label>
      </template>

      <template v-else-if="props.kind === 'version'">
        <div class="record-dialog-grid">
          <label><span>版本号</span><input :value="props.form.label" type="text" data-dialog-initial :disabled="props.busy" @input="updateForm({ label: eventValue($event) })" /></label>
          <label><span>标题</span><input :value="props.form.title" type="text" :disabled="props.busy" @input="updateForm({ title: eventValue($event) })" /></label>
        </div>
        <label><span>版本目标</span><textarea :value="props.form.goal" rows="4" :disabled="props.busy" @input="updateForm({ goal: eventValue($event) })"></textarea></label>
        <label><span>内容描述</span><textarea :value="props.form.summary" rows="4" :disabled="props.busy" @input="updateForm({ summary: eventValue($event) })"></textarea></label>
      </template>

      <template v-else-if="props.kind === 'question'">
        <label><span>标题</span><input :value="props.form.title" type="text" data-dialog-initial :disabled="props.busy" @input="updateForm({ title: eventValue($event) })" /></label>
        <label><span>内容</span><textarea :value="props.form.question" rows="3" :disabled="props.busy" @input="updateForm({ question: eventValue($event) })"></textarea></label>
        <label><span>背景</span><textarea :value="props.form.background" rows="2" :disabled="props.busy" @input="updateForm({ background: eventValue($event) })"></textarea></label>
        <label><span>建议</span><textarea :value="props.form.recommendation" rows="2" :disabled="props.busy" @input="updateForm({ recommendation: eventValue($event) })"></textarea></label>
        <div class="record-dialog-grid">
          <label><span>类型</span><UiSelect :model-value="props.form.kind" :options="questionKindOptions" aria-label="类型" :disabled="props.busy" @update:model-value="updateForm({ kind: $event })" /></label>
          <label><span>范围</span><UiSelect :model-value="props.form.scope" :options="questionScopeOptions" aria-label="范围" :disabled="props.busy" @update:model-value="updateForm({ scope: $event })" /></label>
        </div>
        <label class="checkbox-row"><input :checked="props.form.blocking" type="checkbox" :disabled="props.busy" @change="updateForm({ blocking: eventChecked($event) })" /><span>阻塞当前工作</span></label>
      </template>
    </div>

    <FormActions
      :status="props.form.feedback"
      submit-label="保存修改"
      submit-icon="check"
      :disabled="props.busy"
    />
  </ModalLayer>
</template>

<style scoped>
.record-edit-dialog {
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  box-shadow: var(--shadow-dialog);
}

.record-edit-fields {
  display: grid;
  min-height: 0;
  gap: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 1px 3px 2px 1px;
}

.record-edit-fields textarea {
  resize: vertical;
}

.record-edit-dialog.is-compact {
  width: 100%;
  max-height: calc(100dvh - 16px);
  padding: 14px;
}

.record-edit-dialog.is-compact .record-edit-fields {
  gap: 10px;
}

@media (max-width: 480px) {
  .record-edit-overlay {
    padding: 8px;
  }

  .record-edit-dialog {
    width: 100%;
    max-height: calc(100dvh - 16px);
    padding: 14px;
  }

  .record-edit-dialog :deep(.record-dialog-grid) {
    grid-template-columns: 1fr;
  }
}
</style>
