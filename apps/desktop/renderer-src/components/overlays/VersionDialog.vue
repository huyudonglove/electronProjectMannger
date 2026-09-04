<script setup lang="ts">
import { versionStatusOptions } from '../../config/ui'
import DialogHeader from '../ui/DialogHeader.vue'
import FormActions from '../ui/FormActions.vue'
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
    <DialogHeader title-id="versionDialogTitle" title="创建版本" @close="emit('close')" />
    <div class="record-dialog-grid">
      <label>
        <span>版本号</span>
        <input :value="form.label" type="text" data-dialog-initial placeholder="v0.2" @input="updateForm({ label: eventValue($event) })" />
      </label>
      <label>
        <span>标题</span>
        <input :value="form.title" type="text" placeholder="真实数据联调" @input="updateForm({ title: eventValue($event) })" />
      </label>
    </div>
    <label>
      <span>初始状态</span>
      <UiSelect :model-value="form.versionStatus" :options="versionStatusOptions" aria-label="初始状态" @update:model-value="updateForm({ versionStatus: $event })" />
    </label>
    <label>
      <span>版本目标</span>
      <textarea :value="form.goal" rows="3" placeholder="本版本要达成什么？" @input="updateForm({ goal: eventValue($event) })"></textarea>
    </label>
    <label>
      <span>内容描述</span>
      <textarea :value="form.summary" rows="3" placeholder="包含哪些工作？" @input="updateForm({ summary: eventValue($event) })"></textarea>
    </label>
    <FormActions :status="form.feedback" submit-label="创建版本" submit-icon="plus" />
  </ModalLayer>
</template>
