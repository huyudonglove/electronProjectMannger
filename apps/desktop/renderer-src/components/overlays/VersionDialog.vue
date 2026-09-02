<script setup lang="ts">
import { versionStatusOptions } from '../../config/ui'
import UiIcon from '../ui/UiIcon.vue'
import UiSelect from '../ui/UiSelect.vue'
import ModalLayer from './ModalLayer.vue'

interface VersionForm {
  label: string
  title: string
  goal: string
  summary: string
  versionStatus: string
  feedback: string
}

const props = defineProps<{
  open: boolean
  busy: boolean
  form: VersionForm
}>()

const emit = defineEmits<{
  close: []
  submit: []
  'update:form': [form: VersionForm]
}>()

function eventValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value
}

function updateForm(patch: Partial<VersionForm>) {
  emit('update:form', { ...props.form, ...patch })
}
</script>

<template>
  <ModalLayer
    :open="open"
    :busy="busy"
    as="form"
    title-id="versionDialogTitle"
    panel-class="record-dialog"
    @close="emit('close')"
    @submit="emit('submit')"
  >
    <div class="project-dialog-head">
      <div>
        <h2 id="versionDialogTitle">创建新版本</h2>
        <p>版本独立管理；创建后可从顶部选择它来记录内容。</p>
      </div>
      <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="关闭" aria-label="关闭" @click="emit('close')">
        <UiIcon name="x" />
      </button>
    </div>
    <div class="record-dialog-grid">
      <label>
        <span>版本名称</span>
        <input :value="form.label" type="text" data-dialog-initial placeholder="v0.2" @input="updateForm({ label: eventValue($event) })" />
      </label>
      <label>
        <span>版本标题</span>
        <input :value="form.title" type="text" placeholder="真实数据联调" @input="updateForm({ title: eventValue($event) })" />
      </label>
    </div>
    <label>
      <span>初始状态</span>
      <UiSelect :model-value="form.versionStatus" :options="versionStatusOptions" aria-label="初始状态" @update:model-value="updateForm({ versionStatus: $event })" />
    </label>
    <label>
      <span>版本目标</span>
      <textarea :value="form.goal" rows="3" placeholder="这一阶段完成后，项目应达到什么状态。" @input="updateForm({ goal: eventValue($event) })"></textarea>
    </label>
    <label>
      <span>内容描述</span>
      <textarea :value="form.summary" rows="3" placeholder="大致包含哪些工作。" @input="updateForm({ summary: eventValue($event) })"></textarea>
    </label>
    <div class="quick-task-actions">
      <span>{{ form.feedback }}</span>
      <button class="btn btn-primary" type="submit">创建版本</button>
    </div>
  </ModalLayer>
</template>
