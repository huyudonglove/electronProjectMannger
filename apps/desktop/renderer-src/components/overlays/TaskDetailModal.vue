<script setup lang="ts">
import UiIcon from '../ui/UiIcon.vue'
import UiTag from '../ui/UiTag.vue'
import ModalLayer from './ModalLayer.vue'

type UiTone = 'neutral' | 'complete' | 'warning' | 'danger'

interface TaskDetailRecord {
  id?: string
  shortId?: string
  title?: string
  priority?: string
  workLevel?: string
  depthReason?: string
  status?: string
  updated?: string
  userOriginal?: string
  detail?: string
  acceptance?: string
  constraints?: string
  planRollback?: string
  [key: string]: unknown
}

defineProps<{
  task: TaskDetailRecord | null
}>()

defineEmits<{
  close: []
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

function statusText(status = '') {
  return statusLabels[status] || String(status || 'Todo')
}

function statusTone(status = ''): UiTone {
  if (['done', 'handled', 'resolved'].includes(status)) return 'complete'
  if (['doing', 'pending'].includes(status)) return 'warning'
  if (['abandoned', 'failed', 'blocked'].includes(status)) return 'danger'
  return 'neutral'
}

function statusIcon(status = '') {
  if (['done', 'handled', 'resolved'].includes(status)) return 'circleCheck'
  if (['doing', 'pending'].includes(status)) return 'clock'
  if (['abandoned', 'failed', 'blocked'].includes(status)) return 'circleX'
  return 'circleDot'
}

function priorityTone(priority = ''): UiTone {
  if (priority === 'high') return 'danger'
  if (priority === 'medium') return 'warning'
  return 'neutral'
}

function priorityIcon(priority = '') {
  return priority === 'high' ? 'alertTriangle' : 'circleDot'
}

function workLevelText(level = '') {
  return ({ light: '轻量', standard: '标准', deep: '深度' } as Record<string, string>)[level] || '标准'
}

function depthReasonText(reason = '') {
  return ({
    architecture: '架构',
    migration: '迁移',
    cross_system: '跨系统',
    security: '权限安全',
    irreversible: '不可逆',
    decision: '方案取舍',
  } as Record<string, string>)[reason] || '未说明'
}

function workLevelIcon(level = '') {
  if (level === 'deep') return 'search'
  if (level === 'standard') return 'layers'
  return 'circleDot'
}

function renderTextBlock(value = '') {
  const paragraphs = String(value).split(/\n{2,}/).map((text) => text.trim()).filter(Boolean)
  return paragraphs.length
    ? paragraphs.map((text) => `<p>${text.split('\n').map(renderInlineMarkdown).join('<br>')}</p>`).join('')
    : ''
}

function renderListTextBlock(value = '') {
  const lines = String(value).split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return ''
  if (lines.some((line) => /^[-*]\s+/.test(line))) {
    return `<ul>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`
  }
  return renderTextBlock(value)
}

function renderInlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function formatTime(value = '') {
  if (!value) return '未知时间'
  const date = parseDisplayDate(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function parseDisplayDate(value: unknown) {
  if (value instanceof Date) return value
  const text = String(value || '').trim()
  const localMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/)
  if (localMatch && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    return new Date(
      Number(localMatch[1]),
      Number(localMatch[2]) - 1,
      Number(localMatch[3]),
      Number(localMatch[4] || 0),
      Number(localMatch[5] || 0),
    )
  }
  return new Date(text)
}
</script>

<template>
  <ModalLayer
    :open="Boolean(task)"
    title-id="taskDetailTitle"
    panel-class="task-detail-dialog"
    @close="$emit('close')"
  >
    <template v-if="task">
      <div class="project-dialog-head">
        <div>
          <div class="task-detail-badges">
            <span v-if="task.shortId" class="task-short-id">{{ task.shortId }}</span>
            <UiTag :label="task.priority || 'medium'" :tone="priorityTone(task.priority)" :icon-name="priorityIcon(task.priority)" />
            <UiTag :label="task.workLevel === 'deep' ? `深度 · ${depthReasonText(task.depthReason)}` : workLevelText(task.workLevel)" :icon-name="workLevelIcon(task.workLevel)" />
            <UiTag :label="statusText(task.status)" :tone="statusTone(task.status)" variant="status" :icon-name="statusIcon(task.status)" />
          </div>
          <h2 id="taskDetailTitle" tabindex="-1" data-dialog-initial>{{ task.title || '未命名任务' }}</h2>
          <p>{{ task.updated ? `更新于 ${formatTime(task.updated)} · ${workLevelText(task.workLevel)}` : `未标注更新时间 · ${workLevelText(task.workLevel)}` }}</p>
        </div>
        <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="关闭" aria-label="关闭" @click="$emit('close')"><UiIcon name="x" /></button>
      </div>
      <div class="task-detail-body">
        <section>
          <strong>用户原话</strong>
          <div v-if="task.userOriginal" v-html="renderTextBlock(task.userOriginal)" />
          <p v-else>暂无记录</p>
        </section>
        <section>
          <strong>执行定义</strong>
          <div v-if="task.detail" v-html="renderTextBlock(task.detail)" />
          <p v-else>暂无执行定义</p>
        </section>
        <section>
          <strong>验收标准</strong>
          <div v-if="task.acceptance" v-html="renderListTextBlock(task.acceptance)" />
          <p v-else>暂无验收标准</p>
        </section>
        <section v-if="task.workLevel === 'deep'">
          <strong>关键约束</strong>
          <div v-if="task.constraints" v-html="renderTextBlock(task.constraints)" />
          <p v-else>暂无关键约束</p>
        </section>
        <section v-if="task.workLevel === 'deep'">
          <strong>方案与回退</strong>
          <div v-if="task.planRollback" v-html="renderTextBlock(task.planRollback)" />
          <p v-else>暂无方案与回退</p>
        </section>
      </div>
    </template>
  </ModalLayer>
</template>
