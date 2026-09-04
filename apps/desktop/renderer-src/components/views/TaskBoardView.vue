<script setup lang="ts">
import UiIcon from '../ui/UiIcon.vue'
import TaskCard from './TaskCard.vue'

type TaskItem = Record<string, any>
type BoardColumn = readonly [string, string]
type SecondaryGroup = { status: string; label: string; count: number }

const props = defineProps<{
  columns: readonly BoardColumn[]
  tasks: TaskItem[]
  boardItems: (status: string) => TaskItem[]
  secondaryGroups: SecondaryGroup[]
  secondaryExpanded: boolean
  hiddenDoneCount: (status: string) => number
  doneExpanded: boolean
  highlightedTask: string
  selectedVersionLabel?: string
  setTaskRef: (taskId: string, el: Element | null) => void
}>()

const emit = defineEmits<{
  openTask: [task: TaskItem]
  deleteTask: [taskId: string]
  toggleDone: []
  toggleSecondary: []
  taskStatusAction: [task: TaskItem, status: 'doing' | 'done']
}>()

</script>

<template>
  <section id="board" class="section view active-view">
    <div class="board">
      <section v-for="[status, label] in props.columns" :key="status" class="column">
        <div class="column-head"><h3>{{ label }}</h3><span class="column-count">{{ props.tasks.filter((task) => task.status === status).length }}</span></div>
        <div class="tasks">
          <TaskCard
            v-for="task in props.boardItems(status)"
            :key="task.id"
            :task="task"
            :highlighted="props.highlightedTask === task.id"
            :fallback-status="status"
            :register-ref="props.setTaskRef"
            show-done-state
            @open="emit('openTask', $event)"
            @delete="emit('deleteTask', $event)"
            @status-action="(item, nextStatus) => emit('taskStatusAction', item, nextStatus)"
          />
          <button v-if="status === 'done' && props.tasks.filter((task) => task.status === 'done').length > 6" class="done-toggle" type="button" @click="emit('toggleDone')">
            <UiIcon name="chevronDown" :class="{ expanded: props.doneExpanded }" />
            {{ props.doneExpanded ? '收起已完成任务' : `展开 ${props.hiddenDoneCount(status)} 个已完成任务` }}
          </button>
        </div>
      </section>
    </div>
    <button
      v-if="props.secondaryGroups.length"
      class="board-secondary-toggle"
      type="button"
      :aria-expanded="props.secondaryExpanded"
      @click="emit('toggleSecondary')"
    >
      <span class="board-secondary-title"><UiIcon class="board-secondary-icon" name="archive" />其他任务</span>
      <span class="board-secondary-counts">
        <span v-for="group in props.secondaryGroups" :key="group.status">{{ group.label }} {{ group.count }}</span>
      </span>
      <UiIcon class="board-secondary-chevron" :class="{ expanded: props.secondaryExpanded }" name="chevronDown" />
    </button>
    <div v-if="props.secondaryExpanded && props.secondaryGroups.length" class="board-secondary-panel">
      <section v-for="group in props.secondaryGroups" :key="group.status" class="board-secondary-group">
        <div class="column-head"><h3>{{ group.label }}</h3><span class="column-count">{{ group.count }}</span></div>
        <div class="board-secondary-grid">
          <TaskCard
            v-for="task in props.boardItems(group.status)"
            :key="task.id"
            :task="task"
            :highlighted="props.highlightedTask === task.id"
            :fallback-status="group.status"
            :register-ref="props.setTaskRef"
            @open="emit('openTask', $event)"
            @delete="emit('deleteTask', $event)"
            @status-action="(item, nextStatus) => emit('taskStatusAction', item, nextStatus)"
          />
        </div>
      </section>
    </div>
  </section>
</template>
