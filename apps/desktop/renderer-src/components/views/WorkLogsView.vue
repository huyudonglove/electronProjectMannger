<script setup lang="ts">
import WorkLogDetail from '../details/WorkLogDetail.vue'
import IndexPaneHeader from '../ui/IndexPaneHeader.vue'
import RecordIndexButton from '../ui/RecordIndexButton.vue'
import UiEmptyState from '../ui/UiEmptyState.vue'
import UiSearchField from '../ui/UiSearchField.vue'
import UiTag from '../ui/UiTag.vue'
import UiStatusTag from '../ui/UiStatusTag.vue'
import {
  formatTime,
  logLevelIcon,
  logLevelLabel,
} from '../../utils/record-presentation'

type RecordItem = Record<string, any>

const props = defineProps<{
  logs: RecordItem[]
  tasks: RecordItem[]
  visibleLog: RecordItem | null | undefined
  selectedLogIndex: number
  highlightedLog: number
  logQuery: string
}>()

const emit = defineEmits<{
  'update:logQuery': [value: string]
  openWorkLog: [index: number]
}>()

function resolveLogTasks(log: RecordItem) {
  return (log.relatedTasks || []).map((task: RecordItem) => {
    const matched = props.tasks.find((item) => item.shortId === task.shortId)
    return {
      shortId: task.shortId || matched?.shortId || '',
      id: task.id || matched?.id || '',
      title: task.title || matched?.title || '',
      status: task.status || matched?.status || '',
    }
  })
}

function primaryLogPrompt(log: RecordItem) {
  return log.userGoal || log.result || log.title
}

</script>

<template>
  <section id="work-logs" class="section view active-view">
    <div class="work-log-layout">
      <aside class="work-log-index">
        <div class="work-log-index-head">
          <IndexPaneHeader title="目录" :count-text="`${logs.length} 条`" />
          <UiSearchField :model-value="logQuery" class="work-log-search" placeholder="搜索记录、任务或内容" aria-label="搜索工作记录" @update:model-value="emit('update:logQuery', $event)" />
        </div>
        <div class="work-log-toc">
          <UiEmptyState v-if="!logs.length" :message="logQuery.trim() ? '没有匹配的工作记录。' : '暂无工作记录。'" compact />
          <RecordIndexButton v-for="(log, index) in logs" :key="log.id || index" class="work-log-toc-item" :active="index === selectedLogIndex" @click="emit('openWorkLog', index)">
            <span class="work-log-toc-meta">
              <span v-if="log.shortId" class="task-short-id">{{ log.shortId }}</span>
              <UiStatusTag v-if="log.status && log.status !== 'done'" :status="log.status" />
              <UiTag :label="logLevelLabel(log.recordLevel)" :icon-name="logLevelIcon(log.recordLevel)" />
            </span>
            <span class="work-log-toc-relations"><UiTag v-if="!resolveLogTasks(log).length" label="general" icon-name="tag" /><span v-for="task in resolveLogTasks(log)" :key="task.shortId" class="task-short-id">{{ task.shortId }}</span></span>
            <strong>{{ primaryLogPrompt(log) }}</strong>
            <small>{{ log.title }} · {{ formatTime(log.created) || '未标注日期' }}</small>
          </RecordIndexButton>
        </div>
      </aside>
      <div class="work-log-list-wrap">
        <div class="work-log-list work-log-detail">
          <UiEmptyState v-if="!visibleLog" message="选择一条工作记录查看详情。" compact />
          <WorkLogDetail
            v-else
            :key="visibleLog.id || visibleLog.shortId || selectedLogIndex"
            :log="visibleLog"
            :tasks="tasks"
            :highlighted="highlightedLog === selectedLogIndex"
          />
        </div>
      </div>
    </div>
  </section>
</template>
