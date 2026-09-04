<script setup lang="ts">
import UiIconButton from '../ui/UiIconButton.vue'
import UiTag from '../ui/UiTag.vue'
import {
  priorityIcon,
  priorityLabel,
  priorityTone,
  workLevelIcon,
  workLevelLabel,
  workLevelLabelWithReason,
} from '../../utils/record-presentation'

type TaskItem = Record<string, any>
type NextTaskStatus = 'doing' | 'done'

const props = withDefaults(defineProps<{
  task: TaskItem
  highlighted: boolean
  fallbackStatus: string
  showDoneState?: boolean
  registerRef: (taskId: string, element: Element | null) => void
}>(), {
  showDoneState: false,
})

const emit = defineEmits<{
  open: [task: TaskItem]
  delete: [taskId: string]
  statusAction: [task: TaskItem, status: NextTaskStatus]
}>()

function taskWorkLevelLabel(task: TaskItem) {
  if (task.workLevel === 'deep') return workLevelLabelWithReason(task.workLevel, task.depthReason)
  return task.workLevel === 'standard' ? workLevelLabel('standard') : workLevelLabel('light')
}

function nextTaskStatus(task: TaskItem): NextTaskStatus | null {
  if (task.status === 'todo') return 'doing'
  if (task.status === 'doing') return 'done'
  return null
}

function statusActionLabel(task: TaskItem) {
  return task.status === 'todo' ? '开始任务' : '完成任务'
}

function handleTaskKeydown(event: KeyboardEvent) {
  if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return
  event.preventDefault()
  emit('open', props.task)
}
</script>

<template>
  <article
    :ref="(element) => props.registerRef(props.task.id, element as Element | null)"
    class="task"
    :data-priority="props.task.priority || 'medium'"
    :data-status="props.task.status || props.fallbackStatus"
    :class="{
      done: props.showDoneState && props.task.status === 'done',
      'task-highlight': props.highlighted,
    }"
    role="button"
    tabindex="0"
    @click="emit('open', props.task)"
    @keydown="handleTaskKeydown"
  >
    <div class="task-head">
      <div class="task-title"><span v-if="props.task.shortId" class="task-short-id">{{ props.task.shortId }}</span><span>{{ props.task.title }}</span></div>
      <div class="task-actions">
        <UiIconButton
          v-if="nextTaskStatus(props.task)"
          class="task-status-button"
          variant="outline-primary"
          size="sm"
          :icon="props.task.status === 'todo' ? 'play' : 'check'"
          :label="statusActionLabel(props.task)"
          @click.stop="emit('statusAction', props.task, nextTaskStatus(props.task)!)"
        />
        <UiIconButton class="task-delete-button delete-action" icon="trash" label="删除任务" size="sm" @click.stop="emit('delete', props.task.id)" />
      </div>
    </div>
    <div class="task-meta">
      <UiTag
        :label="priorityLabel(props.task.priority)"
        :tone="priorityTone(props.task.priority)"
        :icon-name="priorityIcon(props.task.priority)"
      />
      <UiTag :label="taskWorkLevelLabel(props.task)" :icon-name="workLevelIcon(props.task.workLevel)" />
    </div>
    <p v-if="props.task.detail">{{ String(props.task.detail).slice(0, 180) }}{{ String(props.task.detail).length > 180 ? '...' : '' }}</p>
  </article>
</template>
