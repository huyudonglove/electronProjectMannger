<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRef, watch } from 'vue'
import { darkTheme, NConfigProvider } from 'naive-ui'
import BrandMark from './components/ui/BrandMark.vue'
import AppSidebar from './components/layout/AppSidebar.vue'
import AppTopbar from './components/layout/AppTopbar.vue'
import MarkdownDialog from './components/overlays/MarkdownDialog.vue'
import ProjectInitDialog from './components/overlays/ProjectInitDialog.vue'
import ProjectPickerDialog from './components/overlays/ProjectPickerDialog.vue'
import QuickCreatePanel from './components/overlays/QuickCreatePanel.vue'
import QuestionDialog from './components/overlays/QuestionDialog.vue'
import ReplyDialog from './components/overlays/ReplyDialog.vue'
import TaskDetailModal from './components/overlays/TaskDetailModal.vue'
import VersionDialog from './components/overlays/VersionDialog.vue'
import CollaborationView from './components/views/CollaborationView.vue'
import CompanionView from './components/views/CompanionView.vue'
import ConstraintsView from './components/views/ConstraintsView.vue'
import DocumentsView from './components/views/DocumentsView.vue'
import KnowledgeView from './components/views/KnowledgeView.vue'
import OverviewView from './components/views/OverviewView.vue'
import ResearchView from './components/views/ResearchView.vue'
import TaskBoardView from './components/views/TaskBoardView.vue'
import ThoughtsView from './components/views/ThoughtsView.vue'
import VersionsView from './components/views/VersionsView.vue'
import WorkLogsView from './components/views/WorkLogsView.vue'
import { useCollaborationCommands } from './composables/useCollaborationCommands'
import { useCompanionMode } from './composables/useCompanionMode'
import { useCompanionNavigation } from './composables/useCompanionNavigation'
import { useCompanionViewModel } from './composables/useCompanionViewModel'
import { useDashboardReconciliation } from './composables/useDashboardReconciliation'
import { useGlobalDismiss } from './composables/useGlobalDismiss'
import { useModalCoordinator } from './composables/useModalCoordinator'
import { useProjectUiActions } from './composables/useProjectUiActions'
import { useProjectWorkspace } from './composables/useProjectWorkspace'
import { useQuickCreateController } from './composables/useQuickCreateController'
import { useRecordCommands } from './composables/useRecordCommands'
import { useRecordCollections } from './composables/useRecordCollections'
import { useRecordNavigation } from './composables/useRecordNavigation'
import { useResourceLibrary } from './composables/useResourceLibrary'
import { useTheme } from './composables/useTheme'
import { useToasts } from './composables/useToasts'
import { useVersionCommands } from './composables/useVersionCommands'
import { useVersionContext } from './composables/useVersionContext'
import {
  boardColumns,
  createLabels,
  defaultPageMeta,
  knowledgeNavigationItem,
  navigationGroups,
  pageMetaBySection,
  versionScopedSections,
  versionStatusOptions,
} from './config/ui'
import { naiveThemeOverrides } from './ui/naive-theme'
import { renderReadableMarkdown } from './utils/markdown'
import {
  projectDisplayName,
  type AnyRecord,
} from './utils/record-formatters'

const { theme, activeThemeIcon, toggleTheme } = useTheme()
const { toasts, showToast } = useToasts()
const workspaceReady = ref(false)

const state = reactive({
  projectRoot: '',
  initialized: false,
  dashboard: null as AnyRecord | null,
  recentProjects: [] as AnyRecord[],
  projectOverlayOpen: false,
  doneExpanded: false,
  secondaryTasksExpanded: false,
  section: 'overview',
  busy: false,
  autoRefreshing: false,
  selectedDialogueIndex: 0,
  selectedLogIndex: 0,
  selectedCollabIndex: 0,
  logQuery: '',
  knowledgeQuery: '',
  documentQuery: '',
  constraintQuery: '',
  selectedVersionId: '',
  selectedVersionByProject: {} as Record<string, string>,
  versionMenuOpen: false,
  collabTab: 'open' as 'open' | 'decided' | 'risks' | 'history',
  dialogueTocCollapsed: false,
  researchTab: 'active' as 'active' | 'done',
  markdownDocument: null as AnyRecord | null,
  selectedTask: null as AnyRecord | null,
  status: '等待选择项目',
  highlightedTask: '',
  highlightedThought: '',
  highlightedDialogue: -1,
  highlightedLog: -1,
})

const {
  ensureReady,
  runAction,
  restoreLastProject,
  loadRecentProjects,
  pickProject,
  openProject,
  removeRecentProject: removeRecentProjectRecord,
  initializeProject,
  refreshDashboard,
  openRecordRoot,
} = useProjectWorkspace({
  state,
  applyProjectResult: (result) => applyProjectResult(result),
  replaceDashboard: (nextDashboard) => replaceDashboard(nextDashboard),
})

const dashboard = computed(() => state.dashboard)
const {
  versions,
  selectedVersion,
  creationVersionId,
  creationDisabledReason,
  setSelectedVersion,
  resetForProject,
  syncSelectedVersion,
  validateCreationVersion,
} = useVersionContext({
  dashboard,
  projectRoot: toRef(state, 'projectRoot'),
  selectedVersionId: toRef(state, 'selectedVersionId'),
  selectedVersionByProject: state.selectedVersionByProject,
})
const {
  currentVersion: companionCurrentVersion,
  currentVersionId: companionVersionId,
  versionTasks: companionVersionTasks,
  taskCounts: companionTaskCounts,
  taskProgress: companionTaskProgress,
  activeTasks: companionActiveTasks,
  versionThoughts: companionVersionThoughts,
  latestThoughts: companionLatestThoughts,
  attentionItems: companionAttentionItems,
  allAttentionItems: companionAllAttentionItems,
  attentionCount: companionAttentionCount,
  latestLogs: companionLatestLogs,
  versionLogs: companionVersionLogs,
} = useCompanionViewModel({
  dashboard,
  selectedVersionId: toRef(state, 'selectedVersionId'),
})
const { applyProjectResult, replaceDashboard } = useDashboardReconciliation({
  projectRoot: toRef(state, 'projectRoot'),
  initialized: toRef(state, 'initialized'),
  dashboard: toRef(state, 'dashboard'),
  selectedTask: toRef(state, 'selectedTask'),
  resetForProject,
  syncSelectedVersion,
})
const {
  openRecentProjects,
  closeRecentProjects,
  openProjectPicker,
  openProjectPath,
  removeRecentProject,
  initializeCurrentProject,
  openDataRoot,
  openKnowledgeRoot,
  copyRecordSkill,
} = useProjectUiActions({
  initialized: toRef(state, 'initialized'),
  busy: toRef(state, 'busy'),
  dashboard,
  projectOverlayOpen: toRef(state, 'projectOverlayOpen'),
  runAction,
  loadRecentProjects,
  pickProject,
  applyProjectResult,
  openProject,
  removeRecentProjectRecord,
  initializeProject,
  openRecordRoot,
  setStatus: (message) => { state.status = message },
  showToast,
})
const {
  quickOpen,
  quickCreateMode,
  quickCreateVersionId,
  quickCreateVersionLabel,
  taskForm: quickTaskForm,
  thoughtForm: quickThoughtForm,
  dialogueForm: quickDialogueForm,
  constraintForm: quickConstraintForm,
  openPrimaryCreate,
  openCompanionCreate,
  selectMode: selectQuickCreate,
  close: closeQuickTask,
} = useQuickCreateController({
  section: toRef(state, 'section'),
  versions,
  requireCreationVersion: (form, requestedVersionId) => requireCreationVersion(form, requestedVersionId),
  openCollaborationCreate: () => openQuestionDialog(),
  hasActiveModal: () => Boolean(activeModal.value),
})
const {
  allTasks,
  allThoughts,
  allLogs,
  knowledge,
  questions,
  risks,
  tasks,
  thoughts,
  dialogues,
  documents,
  userConstraints,
  systemConstraints,
  constraints,
  activeDialogues,
  completedDialogues,
  visibleDialogues,
  logs,
  openQuestions,
  pendingDecisions,
  activeRisks,
  activeCollabItems,
  collabAttentionCount,
} = useRecordCollections({
  dashboard,
  selectedVersionId: toRef(state, 'selectedVersionId'),
  researchTab: toRef(state, 'researchTab'),
  collaborationTab: toRef(state, 'collabTab'),
  logQuery: toRef(state, 'logQuery'),
})
const {
  knowledgeViewItems,
  documentViewItems,
  constraintViewItems,
  systemConstraintViewItems,
  deleteResourceViewItem,
  openMarkdownDocument,
  closeMarkdownDocument,
  markdownDialogTitle,
  markdownDialogSubtitle,
  markdownDialogOrigin,
  markdownDialogBadges,
  markdownDialogContentHtml,
} = useResourceLibrary({
  dashboard,
  projectRoot: toRef(state, 'projectRoot'),
  knowledge,
  documents,
  userConstraints,
  systemConstraints,
  knowledgeQuery: toRef(state, 'knowledgeQuery'),
  documentQuery: toRef(state, 'documentQuery'),
  constraintQuery: toRef(state, 'constraintQuery'),
  markdownDocument: toRef(state, 'markdownDocument'),
  deleteKnowledgeNote: (note) => deleteKnowledgeNote(note),
  deleteDocumentNote: (note) => deleteDocumentNote(note),
  deleteConstraintRecord: (constraint) => deleteConstraintRecord(constraint),
})
const {
  createTask,
  saveThought,
  saveDialogue,
  saveConstraint,
  deleteConstraintRecord,
  deleteThought,
  deleteTask,
  deleteDialogueRecord,
  deleteDocumentNote,
  deleteKnowledgeNote,
  updateTaskStatus,
} = useRecordCommands({
  state,
  quickCreateVersionId,
  taskForm: quickTaskForm,
  thoughtForm: quickThoughtForm,
  dialogueForm: quickDialogueForm,
  constraintForm: quickConstraintForm,
  runAction,
  ensureReady,
  requireCreationVersion,
  replaceDashboard,
  closeQuickCreate: closeQuickTask,
  closeTaskDetail,
  closeMarkdownDocument,
  showToast,
})
const {
  versionDialogOpen,
  versionForm,
  openVersionDialog,
  closeVersionDialog,
  saveVersion,
  changeVersionStatus,
} = useVersionCommands({
  versions,
  selectedVersionId: toRef(state, 'selectedVersionId'),
  runAction,
  ensureReady: () => {
    const api = ensureReady()
    return api ? { api, projectRoot: state.projectRoot } : null
  },
  replaceDashboard,
  showToast,
  setStatus: (message) => { state.status = message },
  onSelectedVersionCompleted: () => {
    closeQuickTask()
    closeQuestionDialog()
  },
})
const {
  replyItem,
  replyForm,
  questionDialogOpen,
  questionForm,
  openReplyDialog,
  closeReplyDialog,
  submitReply,
  openQuestionDialog,
  closeQuestionDialog,
  submitQuestion: saveQuestion,
  completeQuestion,
  resolveRisk,
} = useCollaborationCommands({
  requireCreationVersion,
  runAction,
  ensureReady,
  projectRoot: toRef(state, 'projectRoot'),
  replaceDashboard,
  showToast,
  setStatus: (message) => { state.status = message },
  onReplySaved: () => { state.collabTab = 'decided' },
  onQuestionSaved: () => { state.collabTab = 'decided' },
})
const {
  selectedDialogue,
  selectedCollabItem,
  visibleLog,
  setActiveSection,
  selectVersion,
  setTaskRef,
  setThoughtRef,
  openBoardTask,
  openThought,
  openDialogue,
  openWorkLog,
  openCollabItem,
  openQuestionTarget,
  boardItems,
  hiddenDoneCount,
  secondaryTaskGroups,
} = useRecordNavigation({
  state: {
    section: toRef(state, 'section'),
    selectedDialogueIndex: toRef(state, 'selectedDialogueIndex'),
    selectedLogIndex: toRef(state, 'selectedLogIndex'),
    selectedCollabIndex: toRef(state, 'selectedCollabIndex'),
    highlightedTask: toRef(state, 'highlightedTask'),
    highlightedThought: toRef(state, 'highlightedThought'),
    highlightedDialogue: toRef(state, 'highlightedDialogue'),
    highlightedLog: toRef(state, 'highlightedLog'),
    doneExpanded: toRef(state, 'doneExpanded'),
    secondaryTasksExpanded: toRef(state, 'secondaryTasksExpanded'),
  },
  collections: { allTasks, allThoughts, allLogs, tasks, visibleDialogues, logs, activeCollabItems },
  versionContext: { versions, setSelectedVersion },
  projectRoot: toRef(state, 'projectRoot'),
  selectedVersionId: toRef(state, 'selectedVersionId'),
  researchTab: toRef(state, 'researchTab'),
  collaborationTab: toRef(state, 'collabTab'),
  logQuery: toRef(state, 'logQuery'),
  versionMenuOpen: toRef(state, 'versionMenuOpen'),
  closeQuestionDialog,
  showToast,
})
const { activeModal } = useModalCoordinator({
  projectOverlayOpen: toRef(state, 'projectOverlayOpen'),
  selectedTask: toRef(state, 'selectedTask'),
  replyItem,
  versionDialogOpen,
  questionDialogOpen,
  markdownDocument: toRef(state, 'markdownDocument'),
  projectRoot: toRef(state, 'projectRoot'),
  initialized: toRef(state, 'initialized'),
  closeQuickCreate: () => closeQuickTask({ restoreFocus: false }),
  versionMenuOpen: toRef(state, 'versionMenuOpen'),
})
const { closeVersionMenu } = useGlobalDismiss({
  activeModal,
  quickOpen,
  closeQuickCreate: closeQuickTask,
  versionMenuOpen: toRef(state, 'versionMenuOpen'),
})
const {
  companionMode,
  companionPinned,
  companionSwitching,
  companionStateReady,
  setCompanionMode,
  toggleCompanionPinned,
} = useCompanionMode({
  beforeEnter: prepareCompanionMode,
  showToast,
})
const {
  page: companionPage,
  detailKind: companionDetailKind,
  detailRecord: companionDetailRecord,
  showingDetail: companionShowingDetail,
  canGoBack: companionCanGoBack,
  openPage: openCompanionPage,
  openRecord: openCompanionRecord,
  openQuestionTarget: openCompanionQuestionTarget,
  back: backInCompanion,
  reset: resetCompanionNavigation,
} = useCompanionNavigation({
  currentVersion: companionCurrentVersion,
  tasks: companionVersionTasks,
  thoughts: companionVersionThoughts,
  collaborationItems: companionAllAttentionItems,
  logs: companionVersionLogs,
  showToast,
})
watch(() => state.projectRoot, resetCompanionNavigation)
watch(
  [companionMode, () => state.selectedVersionId, companionVersionId],
  ([enabled]) => {
    if (enabled) ensureCompanionVersionSelection()
  },
)
const projectName = computed(() => dashboard.value?.config?.name || projectDisplayName(state.projectRoot) || '')
const pageMeta = computed(() => pageMetaBySection[state.section] || defaultPageMeta)
const showVersionSwitcher = computed(() => versionScopedSections.has(state.section))
const showCreate = computed(() => Boolean(createLabels[state.section]))
const createLabel = computed(() => createLabels[state.section] || '新建')

const statusTitle = computed(() => {
  if (!state.projectRoot) return '选择任意项目开始'
  if (!state.initialized || !dashboard.value) return '项目尚未初始化'
  return dashboard.value.config?.name || projectDisplayName(state.projectRoot)
})

const statusDescription = computed(() => {
  if (!state.projectRoot) return '选择项目文件夹后，会创建 Markdown 主数据和本地记录索引。'
  if (!state.initialized || !dashboard.value) return ''
  return selectedVersion.value?.goal || selectedVersion.value?.summary || ''
})

onMounted(async () => {
  if (window.electronManager) {
    await restoreLastProject()
  } else {
    state.status = 'preload API 未注入，请重新启动 Electron。'
  }
  workspaceReady.value = true
})

function requireCreationVersion(form?: { status: string }, requestedVersionId = creationVersionId.value) {
  const { versionId, reason } = validateCreationVersion(requestedVersionId)
  if (!reason) return requestedVersionId
  if (form) form.status = reason
  state.status = reason
  showToast(reason)
  return versionId
}

function openTaskDetail(task: AnyRecord) {
  state.selectedTask = task
}

function closeTaskDetail() {
  state.selectedTask = null
}

function prepareCompanionMode() {
  closeQuickTask({ restoreFocus: false })
  closeTaskDetail()
  closeReplyDialog()
  closeVersionDialog()
  closeQuestionDialog()
  closeMarkdownDocument()
  state.projectOverlayOpen = false
  state.versionMenuOpen = false
  ensureCompanionVersionSelection()
  resetCompanionNavigation()
}

function ensureCompanionVersionSelection() {
  const hasConcreteSelection = versions.value.some(
    (version: AnyRecord) => version.shortId === state.selectedVersionId,
  )
  if (!hasConcreteSelection && companionVersionId.value) {
    setSelectedVersion(companionVersionId.value)
  }
}

async function leaveCompanionMode() {
  closeQuickTask({ restoreFocus: false })
  closeReplyDialog()
  closeQuestionDialog()
  resetCompanionNavigation()
  await setCompanionMode(false)
}

function openCompanionCreateMenu() {
  openCompanionCreate(companionVersionId.value)
}

function openCompanionCollaborationCreate() {
  closeQuickTask({ restoreFocus: false })
  openQuestionDialog(companionVersionId.value)
}

function selectCompanionVersion(versionId: string) {
  selectVersion(versionId)
}

async function copyResearchPrompt(dialogue: AnyRecord) {
  const isActive = ['pending', 'doing'].includes(dialogue.status)
  const prompt = [
    `请${isActive ? '处理' : '继续'}当前项目研究 ${dialogue.shortId}。`,
    isActive
      ? `先从 versions/${dialogue.version || '对应版本'}/研究.md 读取该记录，按 mode:: ${dialogue.mode || 'legacy'} 与验收标准执行。`
      : `该记录已完成或归档，不在 activeResearch；请从对应版本研究.md 读取记录、已有回答和关联文档，再按 mode:: ${dialogue.mode || 'legacy'} 与验收标准继续。`,
    `${isActive ? '开始' : '继续'}前将 status 改为 doing；短结果直接写回 D 记录，长结果完成后再创建并关联 W 文档；完成后改为 done，并只为本次实际研究写一条 L 工作记录。`,
  ].join('\n')
  try {
    await navigator.clipboard.writeText(prompt)
    showToast('研究指令已复制')
  } catch {
    showToast('复制失败')
  }
}

</script>

<template>
  <NConfigProvider
    :theme="theme === 'dark' ? darkTheme : null"
    :theme-overrides="naiveThemeOverrides"
    preflight-style-disabled
  >
  <main v-if="!companionStateReady || !workspaceReady" class="companion-boot-shell" aria-label="正在准备窗口" aria-busy="true">
    <BrandMark :size="32" />
    <span class="companion-boot-copy">
      <strong>Telance Records</strong>
      <small>正在准备窗口…</small>
    </span>
  </main>

  <CompanionView
    v-else-if="companionMode"
    :inert="Boolean(activeModal) || quickOpen"
    :aria-hidden="activeModal || quickOpen ? 'true' : undefined"
    :project-name="projectName"
    :initialized="state.initialized"
    :busy="state.busy || state.autoRefreshing"
    :status="state.status"
    :versions="versions"
    :current-version="companionCurrentVersion"
    :selected-version-id="companionVersionId"
    :task-counts="companionTaskCounts"
    :task-progress="companionTaskProgress"
    :active-tasks="companionActiveTasks"
    :tasks="companionVersionTasks"
    :latest-thoughts="companionLatestThoughts"
    :thoughts="companionVersionThoughts"
    :attention-items="companionAttentionItems"
    :all-attention-items="companionAllAttentionItems"
    :attention-count="companionAttentionCount"
    :latest-logs="companionLatestLogs"
    :logs="companionVersionLogs"
    :page="companionPage"
    :detail-kind="companionDetailKind"
    :detail-record="companionDetailRecord"
    :showing-detail="companionShowingDetail"
    :can-go-back="companionCanGoBack"
    :pinned="companionPinned"
    :switching="companionSwitching"
    @restore="leaveCompanionMode"
    @create="openCompanionCreateMenu"
    @switch-project="openRecentProjects"
    @toggle-pinned="toggleCompanionPinned"
    @refresh="refreshDashboard({ quiet: false })"
    @select-version="selectCompanionVersion"
    @open-page="openCompanionPage"
    @open-record="openCompanionRecord"
    @back="backInCompanion"
    @update-task-status="(task, status) => updateTaskStatus(task.id, status)"
    @open-question-target="openCompanionQuestionTarget"
    @reply="openReplyDialog"
    @complete-question="completeQuestion"
    @resolve-risk="resolveRisk"
  />

  <main v-else class="page-shell" :inert="Boolean(activeModal)" :aria-hidden="activeModal ? 'true' : undefined">
    <AppSidebar
      :navigation-groups="navigationGroups"
      :knowledge-item="knowledgeNavigationItem"
      :active-section="state.section"
      :collab-attention-count="collabAttentionCount"
      :project-name="projectName"
      :initialized="state.initialized"
      :theme="theme"
      :active-theme-icon="activeThemeIcon"
      :disabled="state.busy"
      @select-section="setActiveSection"
      @open-projects="openRecentProjects"
      @toggle-theme="toggleTheme"
      @enter-companion-mode="setCompanionMode(true)"
    />

    <section class="content">
      <AppTopbar
        :status="state.status"
        :page-title="pageMeta.title"
        :show-version-switcher="showVersionSwitcher"
        :show-create="showCreate"
        :create-label="createLabel"
        :create-disabled-reason="creationDisabledReason"
        :quick-open="quickOpen"
        :initialized="state.initialized"
        :busy="state.busy"
        :versions="versions"
        :selected-version-id="state.selectedVersionId"
        :selected-version="selectedVersion"
        :version-menu-open="state.versionMenuOpen"
        @toggle-version-menu="state.versionMenuOpen = !state.versionMenuOpen"
        @close-version-menu="closeVersionMenu"
        @select-version="selectVersion"
        @create="openPrimaryCreate"
        @refresh="refreshDashboard({ quiet: false })"
      />

      <OverviewView
        v-if="state.section === 'overview'"
        :initialized="state.initialized"
        :status-title="statusTitle"
        :status-description="statusDescription"
        :selected-version-title="selectedVersion?.title || ''"
        :counts="{
          tasks: tasks.length,
          thoughts: thoughts.length,
          dialogues: dialogues.length,
          knowledge: knowledge.length,
          questions: openQuestions.length,
          logs: logs.length,
          constraints: constraints.length,
        }"
        :data-root="dashboard?.recordSummary?.dataRoot || ''"
        :knowledge-root="dashboard?.recordSummary?.knowledgeRoot || ''"
        :record-skill-path="dashboard?.recordSummary?.recordSkillPath || ''"
        :busy="state.busy"
        @open-data-root="openDataRoot"
        @open-knowledge-root="openKnowledgeRoot"
        @copy-record-skill="copyRecordSkill"
        @navigate="setActiveSection"
      />

      <ThoughtsView
        v-if="state.section === 'capture'"
        :thoughts="thoughts"
        :highlighted-thought="state.highlightedThought"
        :set-thought-ref="setThoughtRef"
        @delete-thought="deleteThought"
      />

      <TaskBoardView
        v-if="state.section === 'board'"
        :columns="boardColumns"
        :tasks="tasks"
        :board-items="boardItems"
        :secondary-groups="secondaryTaskGroups()"
        :secondary-expanded="state.secondaryTasksExpanded"
        :hidden-done-count="hiddenDoneCount"
        :done-expanded="state.doneExpanded"
        :highlighted-task="state.highlightedTask"
        :selected-version-label="selectedVersion ? (state.selectedVersionId === 'all' ? '全部版本' : `${selectedVersion.shortId} · ${selectedVersion.label}`) : ''"
        :set-task-ref="setTaskRef"
        @open-task="openTaskDetail"
        @delete-task="deleteTask"
        @toggle-done="state.doneExpanded = !state.doneExpanded"
        @toggle-secondary="state.secondaryTasksExpanded = !state.secondaryTasksExpanded"
        @task-status-action="(task, status) => updateTaskStatus(task.id, status)"
      />

      <ResearchView
        v-if="state.section === 'dialogues'"
        :visible-dialogues="visibleDialogues"
        :selected-dialogue="selectedDialogue"
        :documents="documents"
        :tab="state.researchTab"
        :toc-collapsed="state.dialogueTocCollapsed"
        :selected-index="state.selectedDialogueIndex"
        :highlighted-index="state.highlightedDialogue"
        :active-count="activeDialogues.length"
        :completed-count="completedDialogues.length"
        :total-count="dialogues.length"
        :render-markdown="renderReadableMarkdown"
        @update:tab="state.researchTab = $event"
        @update:toc-collapsed="state.dialogueTocCollapsed = $event"
        @select="openDialogue"
        @delete="deleteDialogueRecord"
        @copy="copyResearchPrompt"
        @open-document="openMarkdownDocument($event, 'document')"
      />

      <VersionsView
        v-if="state.section === 'versions'"
        :versions="versions"
        :selected-version-id="state.selectedVersionId"
        :all-tasks="allTasks"
        :all-thoughts="allThoughts"
        :all-logs="allLogs"
        :questions="questions"
        :version-status-options="versionStatusOptions"
        :busy="state.busy"
        @open-version-dialog="openVersionDialog"
        @change-version-status="changeVersionStatus"
      />

      <CollaborationView
        v-if="state.section === 'collaboration'"
        :selected-version="selectedVersion"
        :collab-tab="state.collabTab"
        :open-questions="openQuestions"
        :pending-decisions="pendingDecisions"
        :active-risks="activeRisks"
        :active-collab-items="activeCollabItems"
        :selected-collab-item="selectedCollabItem"
        :selected-collab-index="state.selectedCollabIndex"
        :versions="versions"
        :questions="questions"
        :risks="risks"
        @update:collab-tab="state.collabTab = $event"
        @open-collab-item="openCollabItem"
        @open-question-target="openQuestionTarget"
        @open-reply-dialog="openReplyDialog"
        @complete-question="completeQuestion"
        @resolve-risk="resolveRisk"
      />

      <WorkLogsView
        v-if="state.section === 'work-logs'"
        :logs="logs"
        :tasks="tasks"
        :visible-log="visibleLog"
        :selected-log-index="state.selectedLogIndex"
        :highlighted-log="state.highlightedLog"
        :log-query="state.logQuery"
        @update:log-query="state.logQuery = $event"
        @open-work-log="openWorkLog"
      />

      <KnowledgeView
        v-if="state.section === 'knowledge'"
        :query="state.knowledgeQuery"
        :items="knowledgeViewItems"
        :total-count="knowledge.length"
        @update:query="state.knowledgeQuery = $event"
        @open="openMarkdownDocument($event.record, 'knowledge')"
        @delete="deleteResourceViewItem('knowledge', $event)"
      />

      <DocumentsView
        v-if="state.section === 'documents'"
        :query="state.documentQuery"
        :items="documentViewItems"
        :total-count="documents.length"
        @update:query="state.documentQuery = $event"
        @open="openMarkdownDocument($event.record, 'document')"
        @delete="deleteResourceViewItem('document', $event)"
      />

      <ConstraintsView
        v-if="state.section === 'constraints'"
        :query="state.constraintQuery"
        :items="constraintViewItems"
        :system-items="systemConstraintViewItems"
        @update:query="state.constraintQuery = $event"
        @open="openMarkdownDocument($event.record, 'constraint')"
        @delete="deleteResourceViewItem('constraint', $event)"
      />
    </section>
  </main>

  <QuickCreatePanel
    v-if="companionStateReady"
    :open="!activeModal && quickOpen"
    :compact="companionMode"
    :mode="quickCreateMode"
    :target-version-label="quickCreateVersionLabel"
    :task-form="quickTaskForm"
    :thought-form="quickThoughtForm"
    :dialogue-form="quickDialogueForm"
    :constraint-form="quickConstraintForm"
    @close="closeQuickTask"
    @select-mode="selectQuickCreate"
    @submit-task="createTask"
    @submit-thought="saveThought"
    @submit-dialogue="saveDialogue"
    @submit-constraint="saveConstraint"
    @create-collaboration="openCompanionCollaborationCreate"
    @update:task-form="Object.assign(quickTaskForm, $event)"
    @update:thought-form="Object.assign(quickThoughtForm, $event)"
    @update:dialogue-form="Object.assign(quickDialogueForm, $event)"
    @update:constraint-form="Object.assign(quickConstraintForm, $event)"
  />

  <div class="toast-stack" aria-live="polite" aria-atomic="false">
    <div v-for="toast in toasts" :key="toast.id" class="toast-message" :class="{ 'is-leaving': toast.leaving }">{{ toast.message }}</div>
  </div>

  <TaskDetailModal v-if="companionStateReady && !companionMode" :task="state.selectedTask" @close="closeTaskDetail" />

  <ProjectInitDialog
    v-if="companionStateReady && !companionMode"
    :open="Boolean(state.projectRoot && !state.initialized && !state.projectOverlayOpen)"
    :busy="state.busy"
    :can-initialize="Boolean(state.projectRoot && !state.initialized)"
    @initialize="initializeCurrentProject"
    @choose-project="openRecentProjects"
  />

  <ProjectPickerDialog
    v-if="companionStateReady"
    :open="state.projectOverlayOpen"
    :busy="state.busy"
    :projects="state.recentProjects"
    @close="closeRecentProjects"
    @open-project="openProjectPath"
    @remove-project="removeRecentProject"
    @browse="openProjectPicker"
  />

  <ReplyDialog
    v-if="companionStateReady"
    :open="Boolean(replyItem)"
    :busy="state.busy"
    :item="replyItem"
    :form="replyForm"
    @close="closeReplyDialog"
    @submit="submitReply"
    @update:form="Object.assign(replyForm, $event)"
  />

  <VersionDialog
    v-if="companionStateReady && !companionMode"
    :open="versionDialogOpen"
    :busy="state.busy"
    :form="versionForm"
    @close="closeVersionDialog"
    @submit="saveVersion"
    @update:form="Object.assign(versionForm, $event)"
  />

  <QuestionDialog
    v-if="companionStateReady"
    :open="questionDialogOpen"
    :busy="state.busy"
    :form="questionForm"
    @close="closeQuestionDialog"
    @submit="saveQuestion"
    @update:form="Object.assign(questionForm, $event)"
  />

  <MarkdownDialog
    v-if="companionStateReady && !companionMode"
    :open="Boolean(state.markdownDocument)"
    :busy="state.busy"
    :title="markdownDialogTitle"
    :subtitle="markdownDialogSubtitle"
    :origin="markdownDialogOrigin"
    :badges="markdownDialogBadges"
    :content-html="markdownDialogContentHtml"
    @close="closeMarkdownDocument"
  />
  </NConfigProvider>
</template>
