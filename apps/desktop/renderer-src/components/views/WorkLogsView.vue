<script setup lang="ts">
import UiIcon from '../ui/UiIcon.vue'
import UiEmptyState from '../ui/UiEmptyState.vue'
import UiTag from '../ui/UiTag.vue'
import { renderInlineMarkdown, renderListTextBlock, renderTextBlock } from '../../utils/markdown'
import {
  formatTime,
  logLevelIcon,
  logLevelLabel,
  statusIcon,
  statusLabel,
  statusTone,
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

function updateLogQuery(event: Event) {
  emit('update:logQuery', (event.target as HTMLInputElement).value)
}

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
          <div class="section-head compact-head"><h2>目录</h2><span>{{ logs.length }} 条</span></div>
          <label class="work-log-search">
            <UiIcon name="search" />
            <input :value="logQuery" type="search" placeholder="搜索记录、任务或内容" aria-label="搜索工作记录" @input="updateLogQuery" />
          </label>
        </div>
        <div class="work-log-toc">
          <UiEmptyState v-if="!logs.length" :message="logQuery.trim() ? '没有匹配的工作记录。' : '暂无工作记录。'" compact />
          <button v-for="(log, index) in logs" :key="log.id || index" class="work-log-toc-item" :class="{ active: index === selectedLogIndex }" type="button" @click="emit('openWorkLog', index)">
            <span class="work-log-toc-meta">
              <span v-if="log.shortId" class="task-short-id">{{ log.shortId }}</span>
              <UiTag v-if="log.status && log.status !== 'done'" :label="statusLabel(log.status)" :tone="statusTone(log.status)" variant="status" :icon-name="statusIcon(log.status)" />
              <UiTag :label="logLevelLabel(log.recordLevel)" :icon-name="logLevelIcon(log.recordLevel)" />
            </span>
            <span class="work-log-toc-relations"><UiTag v-if="!resolveLogTasks(log).length" label="general" icon-name="tag" /><span v-for="task in resolveLogTasks(log)" :key="task.shortId" class="task-short-id">{{ task.shortId }}</span></span>
            <strong>{{ primaryLogPrompt(log) }}</strong>
            <small>{{ log.title }} · {{ formatTime(log.created) || '未标注日期' }}</small>
          </button>
        </div>
      </aside>
      <div class="work-log-list-wrap">
        <div class="work-log-list work-log-detail">
          <UiEmptyState v-if="!visibleLog" message="选择一条工作记录查看详情。" compact />
          <article
            v-else
            :key="visibleLog.id || visibleLog.shortId || selectedLogIndex"
            class="card collab-log work-log-card"
            :data-record-level="visibleLog.recordLevel || 'light'"
            :class="{ active: true, 'collab-log-highlight': highlightedLog === selectedLogIndex }"
          >
            <div class="collab-card-head collab-card-head--meta">
              <div>
                <div class="log-badges">
                  <span v-if="visibleLog.shortId" class="task-short-id">{{ visibleLog.shortId }}</span>
                  <UiTag :label="statusLabel(visibleLog.status || 'done')" :tone="statusTone(visibleLog.status || 'done')" variant="status" :icon-name="statusIcon(visibleLog.status || 'done')" />
                  <UiTag :label="logLevelLabel(visibleLog.recordLevel)" :icon-name="logLevelIcon(visibleLog.recordLevel)" />
                  <UiTag v-if="visibleLog.source" :label="visibleLog.source" icon-name="tag" />
                </div>
                <h3>{{ visibleLog.title }}</h3>
                <small>{{ formatTime(visibleLog.created) || '未标注日期' }}</small>
              </div>
              <div class="log-task-relations"><UiTag v-if="!resolveLogTasks(visibleLog).length" label="general" icon-name="tag" /><span v-for="task in resolveLogTasks(visibleLog)" :key="task.shortId" class="task-short-id">{{ task.shortId }}</span></div>
            </div>
            <section v-if="visibleLog.userGoal" class="user-goal"><strong>用户目标</strong><div v-html="renderTextBlock(visibleLog.userGoal)" /></section>
            <section :class="{ 'missing-field': !visibleLog.result }"><strong>结果</strong><div v-if="visibleLog.result" v-html="renderListTextBlock(visibleLog.result)" /><p v-else>未记录</p></section>
            <section v-if="visibleLog.recordLevel === 'deep' && visibleLog.decisions?.length"><strong>关键判断</strong><ul><li v-for="item in visibleLog.decisions" :key="item" v-html="renderInlineMarkdown(item)" /></ul></section>
            <section v-for="[title, items] in [['修改文件', visibleLog.changedFiles], ['验证', visibleLog.verification]]" :key="title" :class="{ 'missing-field': !(items && items.length) }">
              <strong>{{ title }}</strong>
              <ul v-if="items && items.length"><li v-for="item in items" :key="item" v-html="renderInlineMarkdown(item)" /></ul>
              <p v-else>未记录</p>
            </section>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>
