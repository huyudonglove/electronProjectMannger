<script setup lang="ts">
import { computed } from 'vue'
import CompanionDetailPage from '../companion/CompanionDetailPage.vue'
import CompanionHeader from '../companion/CompanionHeader.vue'
import CompanionHomeDashboard from '../companion/CompanionHomeDashboard.vue'
import CompanionListPage from '../companion/CompanionListPage.vue'
import UiEmptyState from '../ui/UiEmptyState.vue'
import UiIcon from '../ui/UiIcon.vue'
import type { CompanionPage, CompanionRecordKind } from '../../composables/useCompanionNavigation'
import type { AnyRecord, TaskCounts } from '../companion/types'

const props = defineProps<{
  projectName: string
  initialized: boolean
  busy: boolean
  status: string
  versions: AnyRecord[]
  currentVersion: AnyRecord | null
  selectedVersionId: string
  taskCounts: TaskCounts
  taskProgress: number
  activeTasks: AnyRecord[]
  tasks: AnyRecord[]
  latestThoughts: AnyRecord[]
  thoughts: AnyRecord[]
  latestDialogues: AnyRecord[]
  dialogues: AnyRecord[]
  attentionItems: AnyRecord[]
  allAttentionItems: AnyRecord[]
  attentionCount: number
  latestLogs: AnyRecord[]
  logs: AnyRecord[]
  page: CompanionPage
  detailKind: CompanionRecordKind | null
  detailRecord: AnyRecord | null
  showingDetail: boolean
  canGoBack: boolean
  pinned: boolean
  switching: boolean
}>()

const emit = defineEmits<{
  restore: []
  create: []
  switchProject: []
  togglePinned: []
  refresh: []
  openPage: [page: CompanionPage]
  openRecord: [kind: CompanionRecordKind, record: AnyRecord]
  back: []
  updateTaskStatus: [task: AnyRecord, status: 'todo' | 'doing' | 'done']
  resolveThought: [thought: AnyRecord]
  reopenThought: [thought: AnyRecord]
  updateDialogueStatus: [dialogue: AnyRecord, status: 'pending' | 'doing' | 'done' | 'archived']
  openQuestionTarget: [item: AnyRecord]
  reply: [item: AnyRecord]
  completeQuestion: [item: AnyRecord]
  resolveRisk: [item: AnyRecord]
  selectVersion: [versionId: string]
}>()

const pageTitle = computed(() => {
  if (props.showingDetail) return props.detailRecord?.shortId || '记录详情'
  return ({ home: props.projectName || 'Telance Records', tasks: '当前任务', thoughts: '想法', research: '研究', collaboration: '待处理', logs: '工作记录' })[props.page]
})

const pageSubtitle = computed(() => {
  const versionId = props.currentVersion?.shortId || '当前版本'
  if (props.showingDetail || props.page === 'home') return props.currentVersion?.shortId || ''
  const count = {
    tasks: props.tasks.length,
    thoughts: props.thoughts.length,
    research: props.dialogues.length,
    collaboration: props.allAttentionItems.length,
    logs: props.logs.length,
  }[props.page]
  return `${versionId} · ${count} 条`
})
</script>

<template>
  <main class="companion-shell">
    <CompanionHeader
      :title="pageTitle"
      :subtitle="pageSubtitle"
      :can-go-back="props.canGoBack"
      :busy="props.busy"
      :pinned="props.pinned"
      :switching="props.switching"
      @back="emit('back')"
      @create="emit('create')"
      @switch-project="emit('switchProject')"
      @toggle-pinned="emit('togglePinned')"
      @refresh="emit('refresh')"
      @restore="emit('restore')"
    />

    <div v-if="!props.initialized" class="companion-empty-panel">
      <UiEmptyState message="请恢复完整模式后选择并初始化项目。" />
      <button class="btn btn-primary" type="button" @click="emit('restore')"><UiIcon name="maximize" />恢复完整模式</button>
    </div>

    <CompanionDetailPage
      v-else-if="props.showingDetail && props.detailRecord"
      :kind="props.detailKind"
      :record="props.detailRecord"
      :tasks="props.tasks"
      :busy="props.busy"
      @update-task-status="(task, status) => emit('updateTaskStatus', task, status)"
      @resolve-thought="emit('resolveThought', $event)"
      @reopen-thought="emit('reopenThought', $event)"
      @update-dialogue-status="(dialogue, status) => emit('updateDialogueStatus', dialogue, status)"
      @open-question-target="emit('openQuestionTarget', $event)"
      @reply="emit('reply', $event)"
      @complete-question="emit('completeQuestion', $event)"
      @resolve-risk="emit('resolveRisk', $event)"
    />

    <CompanionListPage
      v-else-if="props.page !== 'home'"
      :page="props.page"
      :tasks="props.tasks"
      :thoughts="props.thoughts"
      :dialogues="props.dialogues"
      :attention-items="props.allAttentionItems"
      :logs="props.logs"
      @open-record="(kind, record) => emit('openRecord', kind, record)"
    />

    <CompanionHomeDashboard
      v-else
      :versions="props.versions"
      :current-version="props.currentVersion"
      :selected-version-id="props.selectedVersionId"
      :busy="props.busy"
      :task-counts="props.taskCounts"
      :task-progress="props.taskProgress"
      :active-tasks="props.activeTasks"
      :latest-thoughts="props.latestThoughts"
      :latest-dialogues="props.latestDialogues"
      :attention-items="props.attentionItems"
      :attention-count="props.attentionCount"
      :latest-logs="props.latestLogs"
      @open-page="emit('openPage', $event)"
      @open-record="(kind, record) => emit('openRecord', kind, record)"
      @select-version="emit('selectVersion', $event)"
    />

    <footer v-if="props.busy || props.status" class="companion-footer" aria-live="polite"><span class="sync-status-dot" :class="{ busy: props.busy }"></span><span>{{ props.status || '正在同步记录' }}</span></footer>
  </main>
</template>
