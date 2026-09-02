<script setup lang="ts">
import { computed } from 'vue'
import UiIcon from '../ui/UiIcon.vue'
import UiTag from '../ui/UiTag.vue'

type AnyRecord = Record<string, any>
type ResearchTab = 'active' | 'done'
type UiTone = 'neutral' | 'complete' | 'warning' | 'danger'

const props = withDefaults(defineProps<{
  visibleDialogues: AnyRecord[]
  selectedDialogue?: AnyRecord | null
  documents?: AnyRecord[]
  tab: ResearchTab
  tocCollapsed: boolean
  selectedIndex: number
  highlightedIndex?: number
  activeCount: number
  completedCount: number
  totalCount: number
  renderMarkdown: (markdown: string) => string
}>(), {
  selectedDialogue: null,
  documents: () => [],
  highlightedIndex: -1,
})

const emit = defineEmits<{
  'update:tab': [tab: ResearchTab]
  'update:tocCollapsed': [collapsed: boolean]
  select: [index: number]
  delete: [dialogue: AnyRecord]
  copy: [dialogue: AnyRecord]
  openDocument: [document: AnyRecord]
}>()

const activeDialogue = computed(() => (
  props.selectedDialogue
  || props.visibleDialogues[props.selectedIndex]
  || props.visibleDialogues[0]
  || null
))

const activeDocument = computed(() => activeDialogue.value ? dialogueDocument(activeDialogue.value) : null)

function dialogueDisplayTitle(dialogue: AnyRecord) {
  return firstMeaningfulLine(dialogue.recordContent || dialogue.answer || dialogue.title || '') || dialogueTitle(dialogue)
}

function dialogueTitle(dialogue: AnyRecord) {
  return String(dialogue.title || '').replace(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?\s*/, '').trim() || '研究'
}

function firstMeaningfulLine(value: string) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^```/.test(line) && !/^#{1,6}\s+/.test(line) && !/^[-*]\s+/.test(line) && !/^[A-Za-z0-9_-]+::\s*/.test(line))
    || ''
}

function researchModeLabel(mode: string) {
  if (mode === 'depth') return '深度'
  if (mode === 'breadth') return '广度'
  return '未分类'
}

function researchModeIcon(mode: string) {
  return mode === 'depth' ? 'search' : mode === 'breadth' ? 'gitPullRequest' : 'circleDot'
}

function researchStatusText(status: string) {
  return ({
    pending: '待研究',
    doing: '进行中',
    done: '已完成',
    archived: '已归档',
  } as Record<string, string>)[status] || '待研究'
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

function dialogueDocument(dialogue: AnyRecord) {
  const related = new Set(dialogue.relatedDocuments || [])
  return props.documents.find((document) => related.has(document.shortId)) || null
}

function dialogueHasResult(dialogue: AnyRecord) {
  const answer = String(dialogue.answer || '').trim()
  return Boolean(answer && !['待研究。', '待研究', '暂无。', '暂无'].includes(answer))
}

function researchPromptLabel(dialogue: AnyRecord) {
  return ['pending', 'doing'].includes(dialogue.status) ? '复制研究指令' : '复制续研指令'
}

function dialogueTocSummary(dialogue: AnyRecord) {
  const answer = String(dialogue.answer || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim()
  const summary = answer || String(dialogue.recordContent || '').replace(/\s+/g, ' ').trim()
  return summary.length > 44 ? `${summary.slice(0, 44).trimEnd()}...` : summary || formatTime(dialogue.created)
}

function dialogueSummary(dialogue: AnyRecord) {
  const text = String(dialogue.recordContent || dialogue.answer || '').replace(/\s+/g, ' ').trim()
  return text.length > 180 ? `${text.slice(0, 180).trimEnd()}...` : text || '暂无概要。'
}

function dialogueRefsList(dialogue: AnyRecord) {
  return [
    ...(dialogue.relatedTasks || []),
    ...(dialogue.relatedThoughts || []),
    ...(dialogue.relatedDocuments || []),
    ...(dialogue.tags || []).map((tag: string) => `#${tag}`),
  ]
}

function formatTime(value: string) {
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
  <section id="dialogues" class="section view active-view">
    <div class="section-head"><h2>研究</h2><span>{{ props.activeCount }} 条待处理</span></div>
    <div v-if="props.totalCount" class="segmented-control research-tabs" role="tablist" aria-label="研究状态">
      <button type="button" role="tab" :aria-selected="props.tab === 'active'" :class="{ active: props.tab === 'active' }" @click="emit('update:tab', 'active')">待研究 <span>{{ props.activeCount }}</span></button>
      <button type="button" role="tab" :aria-selected="props.tab === 'done'" :class="{ active: props.tab === 'done' }" @click="emit('update:tab', 'done')">已完成 <span>{{ props.completedCount }}</span></button>
    </div>
    <div class="dialogue-layout" :class="{ 'toc-collapsed': props.tocCollapsed }">
      <p v-if="!props.totalCount" class="empty-panel">暂无研究。</p>
      <p v-else-if="!props.visibleDialogues.length" class="empty-panel">{{ props.tab === 'active' ? '暂无待研究事项。' : '暂无已完成研究。' }}</p>
      <template v-else-if="activeDialogue">
        <div class="dialogue-list-wrap">
          <div class="dialogue-list">
            <article
              :key="activeDialogue.id || activeDialogue.shortId || props.selectedIndex"
              class="card dialogue"
              :data-mode="activeDialogue.mode || 'legacy'"
              :class="{ 'dialogue-highlight': props.highlightedIndex === props.selectedIndex }"
            >
              <div class="dialogue-head">
                <div>
                  <span class="task-short-id">{{ activeDialogue.shortId || 'D000' }}</span>
                  <UiTag :label="researchModeLabel(activeDialogue.mode)" :icon-name="researchModeIcon(activeDialogue.mode)" />
                  <UiTag
                    :label="researchStatusText(activeDialogue.status)"
                    :tone="statusTone(activeDialogue.status)"
                    variant="status"
                    :icon-name="statusIcon(activeDialogue.status)"
                  />
                  <strong>{{ dialogueDisplayTitle(activeDialogue) }}</strong>
                </div>
                <div class="dialogue-actions">
                  <small>{{ formatTime(activeDialogue.created) }}</small>
                  <button class="btn icon-button btn-outline-secondary btn-sm" type="button" :title="researchPromptLabel(activeDialogue)" :aria-label="researchPromptLabel(activeDialogue)" @click="emit('copy', activeDialogue)"><UiIcon name="copy" /></button>
                  <button v-if="activeDocument" class="btn icon-button btn-outline-secondary btn-sm" type="button" title="打开详细文档" aria-label="打开详细文档" @click="emit('openDocument', activeDocument)"><UiIcon name="fileText" /></button>
                  <button class="btn icon-button btn-outline-secondary btn-sm delete-action" type="button" title="删除研究" aria-label="删除研究" @click="emit('delete', activeDialogue)"><UiIcon name="trash" /></button>
                </div>
              </div>
              <section class="dialogue-block dialogue-prompt"><strong>概要</strong><p>{{ dialogueSummary(activeDialogue) }}</p></section>
              <section class="dialogue-block dialogue-answer">
                <div class="dialogue-block-head"><strong>{{ dialogueHasResult(activeDialogue) ? '研究结果' : '研究状态' }}</strong><span v-if="activeDocument">{{ activeDocument.shortId }}</span></div>
                <div v-if="dialogueHasResult(activeDialogue)" class="rendered-markdown" v-html="props.renderMarkdown(activeDialogue.answer)" />
                <p v-else>{{ activeDialogue.status === 'doing' ? '正在研究。' : '等待处理。' }}</p>
              </section>
              <section class="dialogue-block dialogue-meta-block"><strong>验收标准</strong><p>{{ activeDialogue.acceptance || '无。' }}</p></section>
              <div v-if="dialogueRefsList(activeDialogue).length" class="dialogue-relations"><UiTag v-for="ref in dialogueRefsList(activeDialogue)" :key="ref" :label="ref" icon-name="link" /></div>
            </article>
          </div>
        </div>
        <aside class="dialogue-index" :class="{ 'is-collapsed': props.tocCollapsed }">
          <div class="section-head compact-head dialogue-index-head">
            <h2>{{ props.tocCollapsed ? '' : '目录' }}</h2>
            <button class="btn icon-button btn-outline-secondary btn-sm" type="button" :title="props.tocCollapsed ? '展开目录' : '收起目录'" :aria-label="props.tocCollapsed ? '展开目录' : '收起目录'" @click="emit('update:tocCollapsed', !props.tocCollapsed)"><UiIcon :name="props.tocCollapsed ? 'panelRightOpen' : 'panelRightClose'" /></button>
          </div>
          <div v-if="!props.tocCollapsed" class="dialogue-toc">
            <button v-for="(dialogue, index) in props.visibleDialogues" :key="dialogue.id || index" class="dialogue-toc-item" :class="{ active: index === props.selectedIndex }" type="button" @click="emit('select', index)">
              <div class="dialogue-toc-meta">
                <span>{{ dialogue.shortId || 'D000' }}</span>
                <span>{{ researchModeLabel(dialogue.mode) }}</span>
                <span>{{ researchStatusText(dialogue.status) }}</span>
              </div>
              <strong>{{ dialogueDisplayTitle(dialogue) }}</strong>
              <small>{{ dialogueTocSummary(dialogue) }}</small>
            </button>
          </div>
        </aside>
      </template>
    </div>
  </section>
</template>
