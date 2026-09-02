<script setup lang="ts">
import UiIcon from '../ui/UiIcon.vue'
import UiTag from '../ui/UiTag.vue'

type ThoughtItem = Record<string, any>
type UiTone = 'neutral' | 'complete' | 'warning' | 'danger'

defineProps<{
  thoughts: ThoughtItem[]
  highlightedThought: string
  setThoughtRef: (thoughtId: string, element: Element | null) => void
}>()

const emit = defineEmits<{
  deleteThought: [thoughtId: string]
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

function thoughtDisplayTitle(thought: ThoughtItem) {
  const title = String(thought.title || '').replace(/\s*想法\s*$/, '').trim()
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?$/.test(title) ? '' : title
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
</script>

<template>
  <section id="capture" class="section view active-view">
    <div class="section-head"><h2>想法</h2><span></span></div>
    <div class="thoughts">
      <p v-if="!thoughts.length" class="empty-panel">暂无想法</p>
      <article
        v-for="thought in thoughts"
        :key="thought.id || thought.shortId"
        :ref="(element) => setThoughtRef(thought.id || thought.shortId || '', element as Element | null)"
        class="card thought"
        :class="{ 'thought-highlight': highlightedThought === (thought.id || thought.shortId) }"
      >
        <div class="thought-header">
          <div class="thought-title">
            <div class="thought-title-row">
              <span v-if="thought.shortId" class="thought-short-id">{{ thought.shortId }}</span>
              <strong v-if="thoughtDisplayTitle(thought)">{{ thoughtDisplayTitle(thought) }}</strong>
              <UiTag
                :label="statusText(thought.status)"
                :tone="statusTone(thought.status)"
                variant="status"
                :icon-name="statusIcon(thought.status)"
              />
            </div>
          </div>
          <button class="btn icon-button btn-outline-secondary btn-sm delete-action" type="button" title="删除输入" aria-label="删除输入" @click="emit('deleteThought', thought.id)"><UiIcon name="trash" /></button>
        </div>
        <p>{{ thought.content }}</p>
        <div v-if="thought.answer" class="answer"><span>摘要</span><p>{{ thought.answer }}</p></div>
        <small>{{ formatTime(thought.created) || '未标注日期' }}</small>
      </article>
    </div>
  </section>
</template>
