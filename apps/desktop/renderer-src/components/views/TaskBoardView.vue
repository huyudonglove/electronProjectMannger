<script setup lang="ts">
import UiTag from '../ui/UiTag.vue'

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
  setTaskRef: (taskId: string, el: Element | null) => void
  icon: (name: string) => string
}>()

const emit = defineEmits<{
  openTask: [task: TaskItem]
  deleteTask: [taskId: string]
  toggleDone: []
  toggleSecondary: []
}>()

function priorityTone(priority: string): 'neutral' | 'warning' | 'danger' {
  if (priority === 'high') return 'danger'
  if (priority === 'medium') return 'warning'
  return 'neutral'
}

function priorityIcon(priority: string) {
  return priority === 'high' ? 'alertTriangle' : 'circleDot'
}

function workLevelLabel(task: TaskItem) {
  if (task.workLevel === 'deep') {
    const reason = {
      architecture: '架构',
      migration: '迁移',
      cross_system: '跨系统',
      security: '权限安全',
      irreversible: '不可逆',
      decision: '方案取舍',
    }[task.depthReason] || '未说明'
    return `深度 · ${reason}`
  }
  return task.workLevel === 'standard' ? '标准' : '轻量'
}

function workLevelIcon(level: string) {
  if (level === 'deep') return 'search'
  if (level === 'standard') return 'layers'
  return 'circleDot'
}
</script>

<template>
  <section id="board" class="section view active-view">
    <div class="section-head"><h2>任务</h2><span></span></div>
    <button
      v-if="props.secondaryGroups.length"
      class="board-secondary-toggle"
      type="button"
      :aria-expanded="props.secondaryExpanded"
      @click="emit('toggleSecondary')"
    >
      <span class="board-secondary-title"><span class="board-secondary-icon" v-html="props.icon('archive')" />其他任务</span>
      <span class="board-secondary-counts">
        <span v-for="group in props.secondaryGroups" :key="group.status">{{ group.label }} {{ group.count }}</span>
      </span>
      <span class="board-secondary-chevron" :class="{ expanded: props.secondaryExpanded }" v-html="props.icon('chevronDown')" />
    </button>
    <div v-if="props.secondaryExpanded && props.secondaryGroups.length" class="board-secondary-panel">
      <section v-for="group in props.secondaryGroups" :key="group.status" class="board-secondary-group">
        <div class="column-head"><h3>{{ group.label }}</h3><span class="column-count">{{ group.count }}</span></div>
        <div class="board-secondary-grid">
          <article
            v-for="task in props.boardItems(group.status)"
            :key="task.id"
            :ref="(el) => props.setTaskRef(task.id, el as Element | null)"
            class="task"
            :data-priority="task.priority || 'medium'"
            :data-status="task.status || group.status"
            :class="{ 'task-highlight': props.highlightedTask === task.id }"
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
              <UiTag :label="task.priority || 'medium'" :tone="priorityTone(task.priority)" :icon-svg="props.icon(priorityIcon(task.priority))" />
              <UiTag :label="workLevelLabel(task)" :icon-svg="props.icon(workLevelIcon(task.workLevel))" />
            </div>
            <p v-if="task.detail">{{ String(task.detail).slice(0, 180) }}{{ String(task.detail).length > 180 ? '...' : '' }}</p>
          </article>
        </div>
      </section>
    </div>
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
              <UiTag :label="workLevelLabel(task)" :icon-svg="props.icon(workLevelIcon(task.workLevel))" />
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
