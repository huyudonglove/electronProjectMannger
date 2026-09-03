<script setup lang="ts">
import UiIcon from '../ui/UiIcon.vue'
import UiIconButton from '../ui/UiIconButton.vue'
import UiSelect from '../ui/UiSelect.vue'
import QuickCreateFormShell from './QuickCreateFormShell.vue'

type QuickCreateMode = 'task' | 'thought' | 'dialogue' | 'constraint'

interface QuickTaskForm {
  title: string
  priority: string
  workLevel: string
  depthReason: string
  detail: string
  acceptance: string
  constraints: string
  planRollback: string
  status: string
}

interface QuickThoughtForm {
  content: string
  status: string
}

interface QuickDialogueForm {
  content: string
  acceptance: string
  mode: 'breadth' | 'depth'
  status: string
}

interface QuickConstraintForm {
  title: string
  content: string
  status: string
}

const props = defineProps<{
  open: boolean
  mode: string
  targetVersionLabel: string
  taskForm: QuickTaskForm
  thoughtForm: QuickThoughtForm
  dialogueForm: QuickDialogueForm
  constraintForm: QuickConstraintForm
  compact?: boolean
}>()

const emit = defineEmits<{
  close: []
  selectMode: [mode: QuickCreateMode]
  submitTask: []
  submitThought: []
  submitDialogue: []
  submitConstraint: []
  createCollaboration: []
  'update:taskForm': [form: QuickTaskForm]
  'update:thoughtForm': [form: QuickThoughtForm]
  'update:dialogueForm': [form: QuickDialogueForm]
  'update:constraintForm': [form: QuickConstraintForm]
}>()

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

function eventValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value
}

function updateTaskForm(patch: Partial<QuickTaskForm>) {
  emit('update:taskForm', { ...props.taskForm, ...patch })
}

function updateThoughtForm(patch: Partial<QuickThoughtForm>) {
  emit('update:thoughtForm', { ...props.thoughtForm, ...patch })
}

function updateDialogueForm(patch: Partial<QuickDialogueForm>) {
  emit('update:dialogueForm', { ...props.dialogueForm, ...patch })
}

function updateConstraintForm(patch: Partial<QuickConstraintForm>) {
  emit('update:constraintForm', { ...props.constraintForm, ...patch })
}
</script>

<template>
  <div v-if="open" class="quick-task is-open" :class="{ 'is-companion': compact }" :data-mode="mode">
    <div v-if="!mode" class="card quick-create-menu" aria-label="新建类型">
      <div v-if="compact" class="quick-create-menu-head">
        <strong>新增记录</strong>
        <UiIconButton icon="x" label="关闭" size="sm" @click="emit('close')" />
      </div>
      <button class="btn btn-outline-primary quick-create-option" type="button" @click="emit('selectMode', 'task')"><UiIcon class="quick-create-icon" name="listChecks" /><span>任务</span></button>
      <button class="btn btn-outline-primary quick-create-option" type="button" @click="emit('selectMode', 'thought')"><UiIcon class="quick-create-icon" name="messageCircle" /><span>想法</span></button>
      <button class="btn btn-outline-primary quick-create-option" type="button" @click="emit('selectMode', 'dialogue')"><UiIcon class="quick-create-icon" name="messagesSquare" /><span>研究</span></button>
      <button class="btn btn-outline-primary quick-create-option" type="button" @click="emit('createCollaboration')"><UiIcon class="quick-create-icon" name="gitPullRequest" /><span>协作</span></button>
      <button v-if="!compact" class="btn btn-outline-primary quick-create-option" type="button" @click="emit('selectMode', 'constraint')"><UiIcon class="quick-create-icon" name="shield" /><span>约束</span></button>
    </div>

    <QuickCreateFormShell
      v-if="mode === 'task'"
      title="任务"
      :target-label="targetVersionLabel"
      aria-label="快速新建任务"
      :status="taskForm.status"
      submit-label="保存任务"
      submit-icon="check"
      @close="emit('close')"
      @submit="emit('submitTask')"
    >
      <input :value="taskForm.title" type="text" placeholder="任务标题" @input="updateTaskForm({ title: eventValue($event) })" />
      <textarea :value="taskForm.detail" rows="3" placeholder="范围与执行定义" @input="updateTaskForm({ detail: eventValue($event) })"></textarea>
      <textarea :value="taskForm.acceptance" rows="2" placeholder="验收标准" @input="updateTaskForm({ acceptance: eventValue($event) })"></textarea>
      <div class="quick-task-grid">
        <UiSelect :model-value="taskForm.priority" :options="priorityOptions" aria-label="优先级" @update:model-value="updateTaskForm({ priority: $event })" />
        <UiSelect :model-value="taskForm.workLevel" :options="workLevelOptions" aria-label="工作等级" @update:model-value="updateTaskForm({ workLevel: $event })" />
      </div>
      <template v-if="taskForm.workLevel === 'deep'">
        <UiSelect :model-value="taskForm.depthReason" :options="depthReasonOptions" aria-label="深度原因" @update:model-value="updateTaskForm({ depthReason: $event })" />
        <textarea :value="taskForm.constraints" rows="2" placeholder="关键约束" @input="updateTaskForm({ constraints: eventValue($event) })"></textarea>
        <textarea :value="taskForm.planRollback" rows="3" placeholder="方案、取舍与回退" @input="updateTaskForm({ planRollback: eventValue($event) })"></textarea>
      </template>
    </QuickCreateFormShell>

    <QuickCreateFormShell
      v-if="mode === 'thought'"
      title="想法"
      :target-label="targetVersionLabel"
      aria-label="快速保存想法"
      :status="thoughtForm.status"
      submit-label="保存想法"
      submit-icon="check"
      @close="emit('close')"
      @submit="emit('submitThought')"
    >
      <textarea :value="thoughtForm.content" rows="5" placeholder="想法、问题或下一步" @input="updateThoughtForm({ content: eventValue($event) })"></textarea>
    </QuickCreateFormShell>

    <QuickCreateFormShell
      v-if="mode === 'dialogue'"
      title="研究"
      :target-label="targetVersionLabel"
      aria-label="快速研究"
      :status="dialogueForm.status"
      submit-label="研究"
      submit-icon="check"
      @close="emit('close')"
      @submit="emit('submitDialogue')"
    >
      <div class="research-mode-control" role="group" aria-label="研究模式">
        <button type="button" :class="{ active: dialogueForm.mode === 'breadth' }" :aria-pressed="dialogueForm.mode === 'breadth'" title="覆盖多个方向并比较筛选" @click="updateDialogueForm({ mode: 'breadth' })">广度</button>
        <button type="button" :class="{ active: dialogueForm.mode === 'depth' }" :aria-pressed="dialogueForm.mode === 'depth'" title="聚焦一个方向并追踪证据与实现" @click="updateDialogueForm({ mode: 'depth' })">深度</button>
      </div>
      <textarea :value="dialogueForm.content" rows="6" :placeholder="dialogueForm.mode === 'depth' ? '核心问题' : '探索范围'" @input="updateDialogueForm({ content: eventValue($event) })"></textarea>
      <textarea :value="dialogueForm.acceptance" rows="2" :placeholder="dialogueForm.mode === 'depth' ? '验证要求（可选）' : '比较维度（可选）'" @input="updateDialogueForm({ acceptance: eventValue($event) })"></textarea>
    </QuickCreateFormShell>

    <QuickCreateFormShell
      v-if="mode === 'constraint'"
      title="约束"
      :target-label="targetVersionLabel"
      aria-label="快速保存约束"
      :status="constraintForm.status"
      submit-label="保存约束"
      submit-icon="check"
      @close="emit('close')"
      @submit="emit('submitConstraint')"
    >
      <input :value="constraintForm.title" type="text" placeholder="约束标题" @input="updateConstraintForm({ title: eventValue($event) })" />
      <textarea :value="constraintForm.content" rows="6" placeholder="长期规则、边界或偏好" @input="updateConstraintForm({ content: eventValue($event) })"></textarea>
    </QuickCreateFormShell>
  </div>
</template>
