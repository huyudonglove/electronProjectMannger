<script setup lang="ts">
import UiIcon from '../ui/UiIcon.vue'
import UiTag from '../ui/UiTag.vue'

type RecordItem = Record<string, any>
type UiTone = 'neutral' | 'complete' | 'warning' | 'danger'

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

const statusLabels: Record<string, string> = {
  backlog: '待规划',
  todo: 'Todo',
  doing: 'Doing',
  done: 'Done',
  abandoned: '已放弃',
  inbox: 'Inbox',
  handled: 'Done',
  pending: '待研究',
  archived: '已归档',
}

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

function statusText(status: string) {
  return statusLabels[status] || String(status || 'Todo')
}

function statusTone(status: string): UiTone {
  if (['done', 'handled', 'resolved'].includes(status)) return 'complete'
  if (['doing', 'pending'].includes(status)) return 'warning'
  if (['abandoned', 'failed', 'blocked'].includes(status)) return 'danger'
  return 'neutral'
}

function statusIcon(status: string) {
  if (['done', 'handled', 'resolved'].includes(status)) return 'circleCheck'
  if (['doing', 'pending'].includes(status)) return 'clock'
  if (['abandoned', 'failed', 'blocked'].includes(status)) return 'circleX'
  return 'circleDot'
}

function logLevelText(level: string) {
  return { light: '轻量', standard: '标准', deep: '深度' }[level] || '标准'
}

function logLevelIcon(level: string) {
  if (level === 'deep') return 'search'
  if (level === 'standard') return 'layers'
  return 'circleDot'
}

function renderTextBlock(value: string) {
  const paragraphs = String(value || '').split(/\n{2,}/).map((text) => text.trim()).filter(Boolean)
  return paragraphs.length ? paragraphs.map((text) => `<p>${text.split('\n').map(renderInlineMarkdown).join('<br>')}</p>`).join('') : ''
}

function renderListTextBlock(value: string) {
  const lines = String(value || '').split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return ''
  if (lines.some((line) => /^[-*]\s+/.test(line))) {
    return `<ul>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`
  }
  return renderTextBlock(value)
}

function renderInlineMarkdown(value: string) {
  return escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function formatTime(value: string) {
  if (!value) return '未知时间'
  const date = parseDisplayDate(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function parseDisplayDate(value: any) {
  if (value instanceof Date) return value
  const text = String(value || '').trim()
  const localMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/)
  if (localMatch && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    return new Date(Number(localMatch[1]), Number(localMatch[2]) - 1, Number(localMatch[3]), Number(localMatch[4] || 0), Number(localMatch[5] || 0))
  }
  return new Date(text)
}

function escapeHtml(value: any) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
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
          <p v-if="!logs.length" class="empty-panel">{{ logQuery.trim() ? '没有匹配的工作记录。' : '暂无工作记录。' }}</p>
          <button v-for="(log, index) in logs" :key="log.id || index" class="work-log-toc-item" :class="{ active: index === selectedLogIndex }" type="button" @click="emit('openWorkLog', index)">
            <span class="work-log-toc-meta">
              <span v-if="log.shortId" class="task-short-id">{{ log.shortId }}</span>
              <UiTag v-if="log.status && log.status !== 'done'" :label="statusText(log.status)" :tone="statusTone(log.status)" variant="status" :icon-name="statusIcon(log.status)" />
              <UiTag :label="logLevelText(log.recordLevel)" :icon-name="logLevelIcon(log.recordLevel)" />
            </span>
            <span class="work-log-toc-relations"><UiTag v-if="!resolveLogTasks(log).length" label="general" icon-name="tag" /><span v-for="task in resolveLogTasks(log)" :key="task.shortId" class="task-short-id">{{ task.shortId }}</span></span>
            <strong>{{ primaryLogPrompt(log) }}</strong>
            <small>{{ log.title }} · {{ formatTime(log.created) || '未标注日期' }}</small>
          </button>
        </div>
      </aside>
      <div class="work-log-list-wrap">
        <div class="work-log-list work-log-detail">
          <p v-if="!visibleLog" class="empty-panel">选择一条工作记录查看详情。</p>
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
                  <UiTag :label="statusText(visibleLog.status || 'done')" :tone="statusTone(visibleLog.status || 'done')" variant="status" :icon-name="statusIcon(visibleLog.status || 'done')" />
                  <UiTag :label="logLevelText(visibleLog.recordLevel)" :icon-name="logLevelIcon(visibleLog.recordLevel)" />
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
