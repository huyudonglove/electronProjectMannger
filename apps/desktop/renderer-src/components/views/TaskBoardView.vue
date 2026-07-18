<script setup lang="ts">
import UiTag from '../ui/UiTag.vue'

type TaskItem = Record<string, any>
type BoardColumn = readonly [string, string]

const props = defineProps<{
  columns: readonly BoardColumn[]
  tasks: TaskItem[]
  boardItems: (status: string) => TaskItem[]
  boardSummary: string[]
  hiddenDoneCount: (status: string) => number
  doneExpanded: boolean
  highlightedTask: string
  setTaskRef: (taskId: string, el: Element | null) => void
  icon: (name: string) => string
}>()

const emit = defineEmits<{
  openTask: [task: TaskItem]
  deleteTask: [taskId: string]
  toggleDone: []
}>()

function priorityTone(priority: string): 'neutral' | 'warning' | 'danger' {
  if (priority === 'high') return 'danger'
  if (priority === 'medium') return 'warning'
  return 'neutral'
}

function priorityIcon(priority: string) {
  return priority === 'high' ? 'alertTriangle' : 'circleDot'
}
</script>

<template>
  <section id="board" class="section view active-view">
    <div class="section-head"><h2>任务</h2><span></span></div>
    <div v-if="props.boardSummary.length" class="board-summary"><span v-for="part in props.boardSummary" :key="part">{{ part }}</span></div>
    <div class="board">
      <section v-for="[status, label] in props.columns" :key="status" class="card column">
        <div class="column-head"><h3>{{ label }}</h3><span class="column-count">{{ props.tasks.filter((task) => task.status === status).length }}</span></div>
        <div class="tasks">
          <p v-if="!props.boardItems(status).length" class="empty">暂无任务</p>
          <article
            v-for="task in props.boardItems(status)"
            :key="task.id"
            :ref="(el) => props.setTaskRef(task.id, el as Element | null)"
            class="task"
            :data-priority="task.priority || 'medium'"
            :data-status="task.status || status"
            :class="{ done: task.status === 'done', 'task-highlight': props.highlightedTask === task.id }"
            role="button"
            tabindex="0"
            @click="emit('openTask', task)"
            @keydown.enter.prevent="emit('openTask', task)"
            @keydown.space.prevent="emit('openTask', task)"
          >
            <div class="task-head">
              <div class="task-title"><span v-if="task.shortId" class="task-short-id">{{ task.shortId }}</span><span>{{ task.title }}</span></div>
              <button class="btn icon-button btn-outline-secondary btn-sm task-delete-button" type="button" title="删除任务" aria-label="删除任务" @click.stop="emit('deleteTask', task.id)" v-html="props.icon('trash')" />
            </div>
            <div class="task-meta">
              <UiTag
                :label="task.priority || 'medium'"
                :tone="priorityTone(task.priority)"
                :icon-svg="props.icon(priorityIcon(task.priority))"
              />
              <UiTag :label="task.area || 'tool'" :icon-svg="props.icon('tag')" />
            </div>
            <p v-if="task.detail">{{ String(task.detail).slice(0, 180) }}{{ String(task.detail).length > 180 ? '...' : '' }}</p>
          </article>
          <button v-if="status === 'done' && props.tasks.filter((task) => task.status === 'done').length > 6" class="done-toggle" type="button" @click="emit('toggleDone')">
            {{ props.doneExpanded ? '收起已完成任务' : `展开 ${props.hiddenDoneCount(status)} 个已完成任务` }}
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
