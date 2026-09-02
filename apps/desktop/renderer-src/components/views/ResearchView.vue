<script setup lang="ts">
import { computed } from 'vue'
import UiEmptyState from '../ui/UiEmptyState.vue'
import UiIconButton from '../ui/UiIconButton.vue'
import UiTag from '../ui/UiTag.vue'
import { dialogueDisplayTitle } from '../../utils/record-formatters'
import { formatTime, statusIcon, statusLabel, statusTone } from '../../utils/record-presentation'

type AnyRecord = Record<string, any>
type ResearchTab = 'active' | 'done'

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

function researchModeLabel(mode: string) {
  if (mode === 'depth') return '深度'
  if (mode === 'breadth') return '广度'
  return '未分类'
}

function researchModeIcon(mode: string) {
  return mode === 'depth' ? 'search' : mode === 'breadth' ? 'gitPullRequest' : 'circleDot'
}

function researchStatusText(status: string) {
  return statusLabel(status, 'research')
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

</script>

<template>
  <section id="dialogues" class="section view active-view">
    <div class="section-head"><h2>研究</h2><span>{{ props.activeCount }} 条待处理</span></div>
    <div v-if="props.totalCount" class="segmented-control research-tabs" role="tablist" aria-label="研究状态">
      <button type="button" role="tab" :aria-selected="props.tab === 'active'" :class="{ active: props.tab === 'active' }" @click="emit('update:tab', 'active')">待研究 <span>{{ props.activeCount }}</span></button>
      <button type="button" role="tab" :aria-selected="props.tab === 'done'" :class="{ active: props.tab === 'done' }" @click="emit('update:tab', 'done')">已完成 <span>{{ props.completedCount }}</span></button>
    </div>
    <div class="dialogue-layout" :class="{ 'toc-collapsed': props.tocCollapsed }">
      <UiEmptyState v-if="!props.totalCount" message="暂无研究。" compact />
      <UiEmptyState v-else-if="!props.visibleDialogues.length" :message="props.tab === 'active' ? '暂无待研究事项。' : '暂无已完成研究。'" compact />
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
                  <UiIconButton icon="copy" :label="researchPromptLabel(activeDialogue)" size="sm" @click="emit('copy', activeDialogue)" />
                  <UiIconButton v-if="activeDocument" icon="fileText" label="打开详细文档" size="sm" @click="emit('openDocument', activeDocument)" />
                  <UiIconButton class="delete-action" icon="trash" label="删除研究" size="sm" @click="emit('delete', activeDialogue)" />
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
            <UiIconButton :icon="props.tocCollapsed ? 'panelRightOpen' : 'panelRightClose'" :label="props.tocCollapsed ? '展开目录' : '收起目录'" size="sm" @click="emit('update:tocCollapsed', !props.tocCollapsed)" />
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
