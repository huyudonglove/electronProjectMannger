<script setup lang="ts">
import UiEmptyState from '../ui/UiEmptyState.vue'
import UiIcon from '../ui/UiIcon.vue'
import UiStatusTag from '../ui/UiStatusTag.vue'
import UiTag from '../ui/UiTag.vue'
import type { CompanionPage, CompanionRecordKind } from '../../composables/useCompanionNavigation'
import { formatTime } from '../../utils/record-presentation'
import type { AnyRecord, TaskCounts } from './types'

const props = defineProps<{
  projectName: string
  currentVersion: AnyRecord | null
  taskCounts: TaskCounts
  taskProgress: number
  activeTasks: AnyRecord[]
  attentionItems: AnyRecord[]
  attentionCount: number
  latestLogs: AnyRecord[]
}>()

const emit = defineEmits<{
  openPage: [page: CompanionPage]
  openRecord: [kind: CompanionRecordKind, record: AnyRecord]
}>()

function versionStatusText(status: string) {
  return ({ planned: '规划中', active: '进行中', paused: '已暂停', completed: '已完成' } as Record<string, string>)[status] || status
}

function attentionKind(item: AnyRecord): CompanionRecordKind {
  return item.companionTargetKind || (item.status === 'decided' ? 'decision' : 'question')
}
</script>

<template>
  <div class="companion-content">
    <section class="companion-version-card">
      <div class="companion-version-head">
        <span><small>当前版本 · {{ props.currentVersion?.shortId }}</small><strong>{{ props.currentVersion?.label || props.currentVersion?.title || props.projectName }}</strong></span>
        <UiTag :label="versionStatusText(props.currentVersion?.status || 'planned')" :tone="props.currentVersion?.status === 'active' ? 'warning' : props.currentVersion?.status === 'completed' ? 'complete' : 'neutral'" variant="status" icon-name="circleDot" />
      </div>
      <p v-if="props.currentVersion?.goal">{{ props.currentVersion.goal }}</p>
      <div class="companion-progress-copy"><span>任务进度</span><strong>{{ props.taskCounts.done }} / {{ props.taskCounts.total }}</strong></div>
      <div class="companion-progress" role="progressbar" aria-label="任务进度" :aria-valuenow="props.taskProgress" aria-valuemin="0" aria-valuemax="100" :aria-valuetext="`${props.taskCounts.done} / ${props.taskCounts.total}`"><span :style="{ width: `${props.taskProgress}%` }"></span></div>
      <div class="companion-metrics">
        <span><strong>{{ props.taskCounts.doing }}</strong><small>进行中</small></span><span><strong>{{ props.taskCounts.todo }}</strong><small>待处理</small></span><span><strong>{{ props.taskCounts.backlog }}</strong><small>待规划</small></span><span><strong>{{ props.taskCounts.done }}</strong><small>已完成</small></span>
      </div>
    </section>

    <section class="companion-section">
      <button class="companion-section-head" type="button" @click="emit('openPage', 'tasks')"><span><UiIcon name="listChecks" />正在推进</span><small>全部任务</small></button>
      <div v-if="props.activeTasks.length" class="companion-list">
        <button v-for="task in props.activeTasks" :key="task.id" class="companion-row" type="button" @click="emit('openRecord', 'task', task)"><span class="companion-row-main"><small>{{ task.shortId }}</small><strong>{{ task.title }}</strong></span><UiStatusTag :status="task.status" /></button>
      </div>
      <UiEmptyState v-else message="当前没有待推进任务。" compact />
    </section>

    <section class="companion-section">
      <button class="companion-section-head" type="button" @click="emit('openPage', 'collaboration')"><span><UiIcon name="gitPullRequest" />待处理</span><small>{{ props.attentionCount ? `${props.attentionCount} 条` : '暂无' }}</small></button>
      <div v-if="props.attentionItems.length" class="companion-list">
        <button v-for="item in props.attentionItems" :key="item.id" class="companion-row" type="button" @click="emit('openRecord', attentionKind(item), item)"><span class="companion-row-main"><small>{{ item.shortId }} · {{ item.companionKind }}</small><strong>{{ item.title }}</strong></span><UiIcon name="chevronRight" /></button>
      </div>
      <UiEmptyState v-else message="没有等待处理的协作事项。" compact />
    </section>

    <section class="companion-section">
      <button class="companion-section-head" type="button" @click="emit('openPage', 'logs')"><span><UiIcon name="scrollText" />最新记录</span><small>查看全部</small></button>
      <div v-if="props.latestLogs.length" class="companion-list">
        <button v-for="log in props.latestLogs" :key="log.id || log.shortId" class="companion-log-row" type="button" @click="emit('openRecord', 'log', log)"><span><small>{{ log.shortId }} · {{ formatTime(log.created) }}</small><strong>{{ log.title }}</strong></span><p>{{ log.result || log.userGoal || '记录已更新。' }}</p></button>
      </div>
      <UiEmptyState v-else message="当前版本还没有工作记录。" compact />
    </section>
  </div>
</template>
