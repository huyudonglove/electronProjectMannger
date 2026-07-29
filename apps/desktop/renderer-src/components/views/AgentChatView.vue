<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import UiTag from '../ui/UiTag.vue'
import { buildAgentTimeline, humanizeAgentSummary, type AgentTimelineGroup } from '../../agent-timeline'

type TaskItem = {
  id: string
  shortId?: string
  title: string
  status?: string
  detail?: string
  userOriginal?: string
  acceptance?: string
  workLevel?: string
}

type RunTask = Pick<TaskItem, 'id' | 'shortId' | 'title' | 'status'>

type RunView = {
  runId: string
  status: string
  phase?: string
  objective?: string
  updatedAt?: string
  startedAt?: string
  nextAction?: string
  graph?: {
    revision: string
    currentNode: string
    historyCount: number
  }
  checklist?: {
    revision: number
    planId?: string
    summary?: string
    progress: { total: number; todo: number; doing: number; done: number; blocked: number; skipped: number }
    items: Array<{
      id: string
      title: string
      kind: 'inspect' | 'change' | 'verify'
      status: 'todo' | 'doing' | 'done' | 'blocked' | 'skipped'
      dependsOn: string[]
      attempt: number
      result?: string
      error?: string
    }>
  }
  task?: RunTask
  waiting?: {
    id: string
    kind: 'plan_approval' | 'tool_approval' | 'user_input'
    summary: string
  }
  resume?: {
    kind: string
    reason: string
  }
  progress?: {
    inspectedFiles?: number
    changedFiles?: string[]
    verificationPassed?: number
    verificationFailed?: number
    modelAttempts?: number
  }
  diff?: {
    summary?: string
    changedFiles?: string[]
    outputRef?: string
  }
  outputRefs?: string[]
  memory?: {
    projectMemoryRevision?: string
    hasProjectMemorySnapshot: boolean
    compactions: {
      count: number
      latest?: {
        strategy: 'deterministic' | 'model'
        trigger: 'compact_threshold' | 'hard_stop'
        beforeTokens: number
        afterTokens: number
        createdAt: string
        summary: {
          knownFacts: number
          decisions: number
          failures: number
          unresolved: number
          observations: number
          sourceRefs: number
          hasNextAction: boolean
        }
      }
    }
  }
  diagnostics?: {
    rejectedActions: number
    failedModelAttempts: number
    recentErrors: Array<{ sequence: number; at: string; type: string; phase: string; summary: string; errorCategory?: string }>
  }
}

type ProjectMemoryStatus = {
  enabled: boolean
  profile: {
    id: string
    revision: string
    mode: 'minimal' | 'balanced' | 'extended'
    sourceBudgets: { runFacts: number; session: number; project: number; user: number }
  }
  sources: {
    total: number
    byKind: { constraints: number; documents: number; knowledge: number }
    byTrust: { trustedProject: number; untrusted: number }
  }
}

type ProjectMaps = {
  codeMap: {
    revision: string
    generatedAt: string
    updatedAt: string
    totalFiles: number
    analyzedFiles: number
    sourceFiles: number
    testFiles: number
    configFiles: number
    dependencyEdges: number
    exportedSymbols: number
    languages: Record<string, number>
  }
  taskMap: {
    revision: string
    updatedAt: string
    taskCount: number
    runCount: number
    conversationCount: number
    activeCount: number
    completedCount: number
    tasks: Array<{
      taskId: string
      shortId: string
      title: string
      status: string
      rounds: Array<{
        runId: string
        status: string
        phase?: string
        updatedAt?: string
        stepCount: number
        eventCount: number
        changedFiles: string[]
        verificationPassed: number
        verificationFailed: number
        graph?: { currentNode?: string; historyCount?: number }
        checklist?: { progress?: { total?: number; done?: number; doing?: number; blocked?: number } }
        result?: string
        diagnostics?: {
          rejectedActions: number
          failedModelAttempts: number
          recentErrors: Array<{ sequence: number; at: string; type: string; phase: string; summary: string; errorCategory?: string }>
        }
      }>
    }>
  }
}

type RunEvent = {
  sequence: number
  at?: string
  type?: string
  phase?: string
  summary: string
  payload?: Record<string, unknown>
}

type RunDetail = {
  run: RunView
  events: RunEvent[]
}

type CredentialStatus = 'configured' | 'missing' | 'loading' | 'error'

type ModelDiagnostic = {
  at: string
  level: 'info' | 'error'
  event: string
  providerId: string
  model: string
  runId: string
  durationMs?: number
  status?: number
  actionShape?: string
  error?: string
  attempt?: number
  errorCategory?: string
}

type LocalChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

type ChatConversation = {
  id: string
  title: string
  updatedAt: string
  messages: LocalChatMessage[]
}

const props = withDefaults(defineProps<{
  projectId?: string
  chats?: ChatConversation[]
  currentChat?: ChatConversation | null
  currentTask: TaskItem | null
  runDetail: RunDetail | null
  runs: RunView[]
  runsLoaded?: boolean
  busy: boolean
  status?: string
  credentialStatus: CredentialStatus
  credentialLabel?: string
  diagnostics?: ModelDiagnostic[]
  localMessages?: LocalChatMessage[]
  memoryStatus?: ProjectMemoryStatus | null
  projectMaps?: ProjectMaps | null
  diagnosticReportBusy?: boolean
}>(), {
  projectId: '',
  chats: () => [],
  currentChat: null,
  runsLoaded: false,
  status: '',
  credentialLabel: '',
  diagnostics: () => [],
  localMessages: () => [],
  memoryStatus: null,
  projectMaps: null,
  diagnosticReportBusy: false,
})

const emit = defineEmits<{
  selectChat: [conversationId: string]
  deleteChat: [conversationId: string]
  start: [taskId: string, instruction?: string]
  advance: [runId: string, instruction?: string]
  approve: [runId: string]
  deny: [runId: string]
  cancel: [runId: string]
  openOutput: [ref: string, label: string]
  newChat: []
  send: [message: string]
  copyDiagnostics: []
}>()

const draft = ref('')
const messageStream = ref<HTMLElement | null>(null)
const filesExpanded = ref(false)
const stopRequested = ref(false)
const now = ref(Date.now())
const FILE_PREVIEW_LIMIT = 6
let messageScrollFrame = 0
let runClock = 0
let wasNearMessageBottom = true
let pendingMessageScrollRestore = false

const run = computed(() => props.runDetail?.run || latestTaskRun.value || null)
const events = computed(() => props.runDetail?.events || [])
const timeline = computed(() => buildAgentTimeline(events.value, [
  ...(run.value?.progress?.changedFiles || []),
  ...(run.value?.diff?.changedFiles || []),
]))
const isTerminal = computed(() => !!run.value && ['completed', 'blocked', 'failed', 'cancelled'].includes(run.value.status))
const waiting = computed(() => run.value?.waiting || null)
const canStopRun = computed(() => !!run.value && !isTerminal.value)
const showRunControl = computed(() => canStopRun.value && (props.busy || ['running', 'awaiting_approval'].includes(run.value?.status || '')))
const activeChecklistItem = computed(() => run.value?.checklist?.items.find((item) => item.status === 'doing'))
const latestRunEvent = computed(() => events.value.at(-1))
const runElapsed = computed(() => formatElapsed(run.value?.startedAt, now.value))
const liveActivityTitle = computed(() => {
  if (stopRequested.value) return '正在停止 Agent'
  if (waiting.value) return waiting.value.kind === 'plan_approval' ? '等待方案确认' : '等待操作确认'
  if (activeChecklistItem.value) return activeChecklistItem.value.title
  if (props.busy) return `${phaseLabel(run.value?.graph?.currentNode || run.value?.phase)}中`
  return '运行已暂停，可以继续或停止'
})
const liveActivityDetail = computed(() => {
  if (stopRequested.value) return '正在中断当前模型或工具请求，并保存可恢复检查点。'
  if (activeChecklistItem.value) return `${checklistStatusLabel(activeChecklistItem.value.status)} · 第 ${run.value?.stepCount || 0} 步`
  const event = latestRunEvent.value
  if (props.busy && event?.type === 'tool.requested') return `正在执行：${event.summary}`
  if (props.busy) return `正在等待本轮模型决策 · 已完成 ${run.value?.progress?.modelAttempts || 0} 次模型调用`
  return run.value?.nextAction || event?.summary || '当前状态已保存。'
})
const canCompose = computed(() => props.credentialStatus === 'configured' && !props.busy && !waiting.value)
const outputRefs = computed(() => run.value?.outputRefs || [])
const nonDiffOutputRefs = computed(() => outputRefs.value.filter((ref) => ref !== run.value?.diff?.outputRef))
const visibleChangedFiles = computed(() => filesExpanded.value
  ? timeline.value.changedFiles
  : timeline.value.changedFiles.slice(0, FILE_PREVIEW_LIMIT))
const hiddenChangedFileCount = computed(() => Math.max(0, timeline.value.changedFiles.length - FILE_PREVIEW_LIMIT))
const messageScrollKey = computed(() => {
  const selection = props.currentChat?.id
    ? `chat:${props.currentChat.id}`
    : props.currentTask?.id
      ? `task:${props.currentTask.id}`
      : 'new'
  return `electron-manager:agent-chat:scroll:${encodeURIComponent(props.projectId || 'unknown')}:${selection}`
})
const taskPromptMessageIndex = computed(() => {
  if (!props.currentTask) return -1
  const prompt = String(props.currentTask.userOriginal || props.currentTask.detail || props.currentTask.title || '').trim()
  for (let index = props.localMessages.length - 1; index >= 0; index -= 1) {
    const message = props.localMessages[index]
    if (message?.role === 'user' && message.content.trim() === prompt) return index
  }
  return -1
})
const taskLeadingMessages = computed(() => taskPromptMessageIndex.value < 0
  ? []
  : props.localMessages.slice(0, taskPromptMessageIndex.value))
const remainingLocalMessages = computed(() => {
  if (!props.currentTask) return props.localMessages
  return taskPromptMessageIndex.value < 0
    ? props.localMessages
    : props.localMessages.slice(taskPromptMessageIndex.value + 1)
})
const runMemory = computed(() => run.value?.memory || null)
const currentTaskMap = computed(() => {
  if (!props.currentTask || !props.projectMaps) return null
  return props.projectMaps.taskMap.tasks.find((task) => task.taskId === props.currentTask?.id || task.shortId === props.currentTask?.shortId) || null
})
const codeMapLanguages = computed(() => Object.entries(props.projectMaps?.codeMap.languages || {})
  .filter(([language]) => language !== 'other')
  .sort((left, right) => right[1] - left[1])
  .slice(0, 5)
  .map(([language, count]) => `${language} ${count}`)
  .join(' · '))
const runDiagnostics = computed(() => {
  const matching = (props.diagnostics || [])
    .filter((entry) => !run.value?.runId || entry.runId === run.value.runId)
  const routeAttempts = matching.filter((entry) => entry.event.startsWith('route.attempt.'))
  return (routeAttempts.length ? routeAttempts : matching).slice(0, 8)
})
const canRestartTerminal = computed(() => !!run.value
  && ['blocked', 'failed', 'cancelled'].includes(run.value.status)
  && !!props.currentTask
  && ['todo', 'doing'].includes(props.currentTask.status || ''))
const restartReason = computed(() => run.value?.resume?.kind === 'blocked'
  ? run.value.resume.reason
  : `上次运行${runStatusLabel(run.value?.status)}，任务已回到待办，可以从新运行重新开始。`)
const activitySummary = computed(() => {
  if (props.busy && run.value) return `${phaseLabel(run.value.phase)}中`
  const toolCount = timeline.value.activity
    .filter((group) => ['tool.completed', 'tool.requested'].includes(group.event.type || ''))
    .reduce((total, group) => total + group.count, 0)
  const parts = [
    toolCount ? `${toolCount} 个工具` : '',
    run.value?.progress?.inspectedFiles ? `检查 ${run.value.progress.inspectedFiles} 个文件` : '',
    run.value?.progress?.modelAttempts ? `${run.value.progress.modelAttempts} 次模型调用` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : `执行过程 · ${timeline.value.activity.length} 项`
})

const latestTaskRun = computed(() => {
  if (!props.currentTask) return null
  return props.runs.find((item) => item.task?.id === props.currentTask?.id || item.task?.shortId === props.currentTask?.shortId) || null
})

const credentialCopy = computed(() => ({
  configured: props.credentialLabel || '后台模型已就绪',
  missing: '需要先选择桌面可用的后台模型',
  loading: '正在检查后台模型…',
  error: '后台模型状态不可用',
})[props.credentialStatus])

const composerPlaceholder = computed(() => {
  if (props.credentialStatus !== 'configured') return '请先在左下角“设置”中选择后台已配置的 Provider 与模型'
  if (waiting.value) return '请先处理上方的审批请求'
  return props.currentTask
    ? '继续当前运行，或明确描述另一项要执行的工作…'
    : '可以先聊聊；明确要求检查、修改或运行时才会创建任务…'
})

const sendLabel = computed(() => {
  if (props.busy) return '处理中…'
  return '发送'
})

watch(messageScrollKey, async () => {
  filesExpanded.value = false
  pendingMessageScrollRestore = localStorage.getItem(messageScrollKey.value) !== null
  await nextTick()
  if (!pendingMessageScrollRestore || messageScrollContentReady()) {
    restoreMessageScroll()
    pendingMessageScrollRestore = false
  }
}, { immediate: true, flush: 'post' })

watch(
  () => [props.localMessages.length, events.value.length, waiting.value?.id, run.value?.status, props.runsLoaded],
  async () => {
    await nextTick()
    if (pendingMessageScrollRestore) {
      if (!messageScrollContentReady()) return
      restoreMessageScroll()
      pendingMessageScrollRestore = false
      return
    }
    if ((wasNearMessageBottom || props.busy) && messageStream.value) {
      messageStream.value.scrollTop = messageStream.value.scrollHeight
      saveMessageScroll()
    }
  },
  { flush: 'post' },
)

watch(
  () => [run.value?.runId, run.value?.status, props.busy],
  () => {
    if (!props.busy || isTerminal.value) stopRequested.value = false
  },
)

onMounted(() => {
  runClock = window.setInterval(() => { now.value = Date.now() }, 1_000)
})

onBeforeUnmount(() => {
  if (messageScrollFrame) cancelAnimationFrame(messageScrollFrame)
  if (runClock) window.clearInterval(runClock)
})

function requestRunStop() {
  if (!run.value || stopRequested.value) return
  stopRequested.value = true
  emit('cancel', run.value.runId)
}

function handleMessageScroll() {
  const stream = messageStream.value
  if (!stream) return
  if (pendingMessageScrollRestore) return
  wasNearMessageBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 72
  if (messageScrollFrame) return
  messageScrollFrame = requestAnimationFrame(() => {
    messageScrollFrame = 0
    saveMessageScroll()
  })
}

function saveMessageScroll() {
  if (!messageStream.value) return
  localStorage.setItem(messageScrollKey.value, String(Math.max(0, Math.round(messageStream.value.scrollTop))))
}

function restoreMessageScroll() {
  const stream = messageStream.value
  if (!stream) return
  const raw = localStorage.getItem(messageScrollKey.value)
  const stored = raw === null ? Number.NaN : Number(raw)
  const target = Number.isFinite(stored)
    ? Math.min(Math.max(0, stored), Math.max(0, stream.scrollHeight - stream.clientHeight))
    : stream.scrollHeight
  const scrollBehavior = stream.style.scrollBehavior
  stream.style.scrollBehavior = 'auto'
  stream.scrollTop = target
  stream.style.scrollBehavior = scrollBehavior
  wasNearMessageBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 72
}

function messageScrollContentReady() {
  if (props.currentChat) return true
  if (props.currentTask) return props.runsLoaded && (!run.value || events.value.length > 0)
  return true
}

function submitMessage() {
  if (props.credentialStatus !== 'configured') return
  const message = draft.value.trim()
  if (!message || props.busy || waiting.value) return
  wasNearMessageBottom = true
  emit('send', message)
  draft.value = ''
}

function startRun() {
  if (!props.currentTask || props.busy) return
  if (props.credentialStatus !== 'configured') return
  emit('start', props.currentTask.id)
}

function runStatusLabel(status?: string) {
  return ({
    running: '运行中',
    awaiting_approval: '等待审批',
    completed: '已完成',
    blocked: '已阻塞',
    failed: '失败',
    cancelled: '已取消',
  } as Record<string, string>)[status || ''] || status || '未启动'
}

function runStatusTone(status?: string): 'neutral' | 'complete' | 'warning' | 'danger' {
  if (status === 'completed') return 'complete'
  if (status === 'running' || status === 'awaiting_approval') return 'warning'
  if (['blocked', 'failed'].includes(status || '')) return 'danger'
  return 'neutral'
}

function phaseLabel(phase?: string) {
  return ({
    created: '准备',
    loading_context: '加载上下文',
    inspecting: '检查项目',
    planning: '制定方案',
    acting: '执行修改',
    awaiting_approval: '等待审批',
    verifying: '验证结果',
    repairing: '修复问题',
    finalizing: '整理结果',
    completed: '完成',
    blocked: '阻塞',
    failed: '失败',
    cancelled: '已取消',
  } as Record<string, string>)[phase || ''] || phase || '尚未开始'
}

function checklistStatusLabel(status: string) {
  if (status === 'doing') return '进行中'
  if (status === 'done') return '完成'
  if (status === 'blocked') return '阻塞'
  if (status === 'skipped') return '跳过'
  return '待处理'
}

function formatTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatElapsed(startedAt: string | undefined, currentTime: number) {
  const started = Date.parse(String(startedAt || ''))
  if (!Number.isFinite(started)) return ''
  const seconds = Math.max(0, Math.floor((currentTime - started) / 1_000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes} 分 ${String(remainder).padStart(2, '0')} 秒`
}

function diagnosticSummary(entry: ModelDiagnostic) {
  if (entry.event === 'route.attempt.failed') {
    return `第 ${entry.attempt || '?'} 次结构化响应无效${entry.errorCategory ? `（${entry.errorCategory}）` : ''}${entry.error ? `：${entry.error}` : ''}`
  }
  if (entry.event === 'route.attempt.succeeded') return `第 ${entry.attempt || '?'} 次结构化动作已接收`
  if (entry.event === 'route.attempt.cancelled') return `第 ${entry.attempt || '?'} 次模型尝试已取消`
  if (entry.error) return entry.error
  if (entry.actionShape) return `响应结构：${entry.actionShape}`
  if (entry.status) return `HTTP ${entry.status}${entry.durationMs !== undefined ? ` · ${entry.durationMs} ms` : ''}`
  return entry.event === 'request.started' ? '请求已发送到本机 Provider' : entry.event
}

function eventPayload(event: RunEvent) {
  return event.payload ? JSON.stringify(event.payload, null, 2) : ''
}

function activityLabel(group: AgentTimelineGroup) {
  const event = group.event
  const tool = typeof event.payload?.tool === 'string' ? event.payload.tool : ''
  if (event.type === 'run.started') return '开始执行任务'
  if (event.type === 'phase.changed') {
    const phase = typeof event.payload?.phase === 'string' ? event.payload.phase : event.phase
    return `进入${phaseLabel(phase)}阶段`
  }
  if (event.type === 'context.assembled') return '已整理本轮上下文'
  if (event.type === 'context.compacted') return '已压缩较早的会话上下文'
  if (event.type === 'model.attempted') return '模型响应已接收'
  if (event.type === 'tool.completed') return `${toolLabel(tool)}已完成`
  if (event.type === 'tool.requested') return `正在${toolLabel(tool)}`
  if (event.type === 'approval.requested') return '已请求审批'
  if (event.type === 'approval.completed') return '审批已处理'
  return event.summary
}

function activityGlyph(group: AgentTimelineGroup) {
  if (group.event.type?.startsWith('tool.')) return '›_'
  if (group.event.type?.startsWith('context.')) return '◎'
  if (group.event.type?.startsWith('model.')) return '◇'
  if (group.event.type?.startsWith('approval.')) return '!'
  return '·'
}

function toolLabel(tool: string) {
  return ({
    list_files: '列出文件',
    search_text: '搜索代码',
    read_file: '读取文件',
    git_status: '检查 Git 状态',
    git_diff: '读取代码差异',
    create_file: '创建文件',
    apply_patch: '修改文件',
    exec_command: '运行验证',
  } as Record<string, string>)[tool] || tool || '执行工具'
}

function fileName(value: string) {
  return value.split('/').filter(Boolean).at(-1) || value
}

function fileDirectory(value: string) {
  const parts = value.split('/').filter(Boolean)
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '项目根目录'
}

function memoryModeLabel(mode?: ProjectMemoryStatus['profile']['mode']) {
  return ({ minimal: '精简', balanced: '平衡', extended: '扩展' } as Record<string, string>)[mode || ''] || '未知'
}

function formatTokenBudget(value?: number) {
  if (!Number.isFinite(value)) return '0'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1, notation: 'compact' }).format(value || 0)
}

function shortRevision(value?: string) {
  if (!value) return '无'
  return value.length > 12 ? `${value.slice(0, 12)}…` : value
}

function shortConversationId(value: string) {
  const compact = String(value || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase()
  return compact ? `CHAT-${compact}` : 'CHAT'
}

</script>

<template>
  <section class="agent-chat-view" aria-label="Agent Chatbot 工作区">
    <aside class="agent-chat-sidebar">
      <header class="agent-chat-sidebar-head">
        <div>
          <span class="agent-chat-kicker">WORKSPACE</span>
          <h2>Agent Chat</h2>
        </div>
        <button class="agent-chat-settings" type="button" title="新对话" aria-label="新建 Agent 对话" @click="emit('newChat')">＋</button>
      </header>

      <div class="agent-chat-credential" :class="`is-${props.credentialStatus}`">
        <i aria-hidden="true" />
        <span>{{ credentialCopy }}</span>
      </div>

      <div class="agent-chat-conversations" aria-label="会话列表">
        <p v-if="!props.chats.length" class="agent-chat-sidebar-empty">暂无对话</p>
        <div
          v-for="chat in props.chats"
          :key="chat.id"
          class="agent-chat-conversation-entry"
        >
          <button
            class="agent-chat-conversation"
            :class="{ active: chat.id === props.currentChat?.id }"
            type="button"
            :title="chat.id"
            @click="emit('selectChat', chat.id)"
          >
            <span class="agent-chat-task-mark">CHAT</span>
            <span class="agent-chat-task-copy">
              <strong>{{ chat.title || '未命名对话' }}</strong>
              <small>{{ shortConversationId(chat.id) }} · 独立对话 · {{ formatTime(chat.updatedAt) }}</small>
            </span>
          </button>
          <button
            class="agent-chat-conversation-delete"
            type="button"
            title="删除对话"
            :aria-label="`删除对话 ${chat.title || shortConversationId(chat.id)}`"
            :disabled="props.busy"
            @click="emit('deleteChat', chat.id)"
          >×</button>
        </div>
      </div>
    </aside>

    <main class="agent-chat-main">
      <header class="agent-chat-header">
        <div class="agent-chat-title">
          <span v-if="props.currentChat" class="agent-chat-task-id">{{ shortConversationId(props.currentChat.id) }}</span>
          <span v-else-if="props.currentTask?.shortId" class="agent-chat-task-id">{{ props.currentTask.shortId }}</span>
          <div>
            <h2>{{ props.currentChat?.title || props.currentTask?.title || '新对话' }}</h2>
            <small v-if="run">{{ props.currentTask?.shortId ? `${props.currentTask.shortId} · ` : '' }}{{ phaseLabel(run.phase) }} · 更新于 {{ formatTime(run.updatedAt) || '未知时间' }}</small>
            <small v-else-if="props.currentChat">普通问答 · 本地持久化</small>
            <small v-else>先识别意图，只有执行请求才会创建项目任务</small>
          </div>
        </div>
        <div class="agent-chat-header-actions">
          <UiTag
            v-if="props.currentTask"
            :label="runStatusLabel(run?.status)"
            :tone="runStatusTone(run?.status)"
            variant="status"
          />
          <button
            v-if="canStopRun"
            class="btn btn-outline-secondary btn-sm"
            type="button"
            :disabled="stopRequested"
            @click="requestRunStop"
          >{{ stopRequested ? '停止中…' : '停止' }}</button>
        </div>
      </header>

      <div v-if="props.status" class="agent-chat-status" role="status">{{ props.status }}</div>

      <div ref="messageStream" class="agent-chat-messages" aria-live="polite" @scroll.passive="handleMessageScroll">
        <div v-if="props.memoryStatus || props.projectMaps" class="agent-chat-context-tools">
        <details v-if="props.memoryStatus" class="agent-chat-memory">
          <summary>
            <span class="agent-chat-memory-mark">MEM</span>
            <strong>{{ memoryModeLabel(props.memoryStatus.profile.mode) }} Memory</strong>
            <small v-if="props.memoryStatus.enabled">{{ props.memoryStatus.sources.total }} 个可用来源 · 项目预算 {{ formatTokenBudget(props.memoryStatus.profile.sourceBudgets.project) }} tokens</small>
            <small v-else>精简模式 · 本次运行不注入 Project Memory</small>
          </summary>
          <div class="agent-chat-memory-body">
            <section>
              <strong>当前项目配置</strong>
              <p v-if="!props.memoryStatus.enabled" class="agent-chat-memory-note">Project Memory 已关闭；以下仅统计当前项目的可用来源，不会注入本次运行。</p>
              <dl>
                <div><dt>运行事实</dt><dd>{{ formatTokenBudget(props.memoryStatus.profile.sourceBudgets.runFacts) }}</dd></div>
                <div><dt>会话</dt><dd>{{ formatTokenBudget(props.memoryStatus.profile.sourceBudgets.session) }}</dd></div>
                <div><dt>项目</dt><dd>{{ formatTokenBudget(props.memoryStatus.profile.sourceBudgets.project) }}</dd></div>
                <div><dt>用户</dt><dd>{{ formatTokenBudget(props.memoryStatus.profile.sourceBudgets.user) }}</dd></div>
              </dl>
              <p>来源：约束 {{ props.memoryStatus.sources.byKind.constraints }} · 文档 {{ props.memoryStatus.sources.byKind.documents }} · 知识 {{ props.memoryStatus.sources.byKind.knowledge }}</p>
              <p>信任：项目可信 {{ props.memoryStatus.sources.byTrust.trustedProject }} · 未信任 {{ props.memoryStatus.sources.byTrust.untrusted }}</p>
            </section>
            <section v-if="runMemory">
              <strong>选中 Run</strong>
              <p>Memory 版本：{{ shortRevision(runMemory.projectMemoryRevision) }}</p>
              <p>固定快照：{{ runMemory.hasProjectMemorySnapshot ? '已保存' : '无' }}</p>
              <p>上下文压缩：{{ runMemory.compactions.count }} 次</p>
              <template v-if="runMemory.compactions.latest">
                <p>
                  最近压缩：{{ runMemory.compactions.latest.strategy === 'model' ? '模型摘要' : '确定性摘要' }} ·
                  {{ formatTokenBudget(runMemory.compactions.latest.beforeTokens) }} → {{ formatTokenBudget(runMemory.compactions.latest.afterTokens) }} tokens
                </p>
                <p>
                  摘要索引：事实 {{ runMemory.compactions.latest.summary.knownFacts }} · 决策 {{ runMemory.compactions.latest.summary.decisions }} ·
                  未决 {{ runMemory.compactions.latest.summary.unresolved }} · 观察 {{ runMemory.compactions.latest.summary.observations }} ·
                  失败 {{ runMemory.compactions.latest.summary.failures }} · 引用 {{ runMemory.compactions.latest.summary.sourceRefs }}
                </p>
              </template>
            </section>
            <section v-else>
              <strong>选中 Run</strong>
              <p>启动或选择一条任务运行后显示其固定快照与压缩状态。</p>
            </section>
          </div>
        </details>

        <details v-if="props.projectMaps" class="agent-chat-memory agent-chat-project-maps">
          <summary>
            <span class="agent-chat-memory-mark">MAP</span>
            <strong>项目地图</strong>
            <small>代码 {{ props.projectMaps.codeMap.totalFiles }} 文件 · 任务 {{ props.projectMaps.taskMap.taskCount }} 节点 · Run {{ props.projectMaps.taskMap.runCount }}</small>
          </summary>
          <div class="agent-chat-memory-body">
            <section>
              <strong>代码地图</strong>
              <p>已分析 {{ props.projectMaps.codeMap.analyzedFiles }} 个文件 · 源码 {{ props.projectMaps.codeMap.sourceFiles }} · 测试 {{ props.projectMaps.codeMap.testFiles }} · 配置 {{ props.projectMaps.codeMap.configFiles }}</p>
              <p>依赖边 {{ props.projectMaps.codeMap.dependencyEdges }} · 导出符号 {{ props.projectMaps.codeMap.exportedSymbols }}</p>
              <p v-if="codeMapLanguages">语言：{{ codeMapLanguages }}</p>
              <p>索引 {{ shortRevision(props.projectMaps.codeMap.revision) }} · 更新于 {{ formatTime(props.projectMaps.codeMap.updatedAt) }}</p>
            </section>
            <section>
              <strong>任务地图</strong>
              <p>进行中 {{ props.projectMaps.taskMap.activeCount }} · 已完成 {{ props.projectMaps.taskMap.completedCount }} · 持久化对话 {{ props.projectMaps.taskMap.conversationCount }}</p>
              <template v-if="currentTaskMap">
                <p>当前任务包含 {{ currentTaskMap.rounds.length }} 轮 Run；执行步骤、变更文件、验证和结果均从 checkpoint 恢复。</p>
                <p v-for="round in currentTaskMap.rounds.slice(0, 4)" :key="round.runId">
                  {{ round.runId.slice(0, 8) }} · {{ runStatusLabel(round.status) }} · {{ round.stepCount }} 步 · 清单 {{ round.checklist?.progress?.done || 0 }}/{{ round.checklist?.progress?.total || 0 }} · {{ round.changedFiles.length }} 文件 · 验证 {{ round.verificationPassed }}/{{ round.verificationFailed }}
                </p>
                <p v-for="error in currentTaskMap.rounds.flatMap((round) => round.diagnostics?.recentErrors || []).slice(0, 4)" :key="`${error.sequence}-${error.at}`" class="agent-chat-memory-note">
                  错误链 #{{ error.sequence }} · {{ error.type }} · {{ error.summary }}
                </p>
              </template>
              <p v-else>选择任务后显示它的多轮执行过程和结果。</p>
              <button class="btn btn-outline-secondary btn-sm" type="button" :disabled="props.diagnosticReportBusy" @click="emit('copyDiagnostics')">
                {{ props.diagnosticReportBusy ? '正在生成…' : '复制脱敏诊断报告' }}
              </button>
            </section>
          </div>
        </details>
        </div>

        <div v-if="!props.currentTask && !props.localMessages.length" class="agent-chat-empty">
          <span class="agent-chat-empty-mark">AI</span>
          <h3>和 Agent 说说要做什么</h3>
          <p>普通闲聊和咨询不会创建任务；明确的检查、修改或运行请求会进入可追踪的 Agent 执行。</p>
        </div>

        <article
          v-for="message in taskLeadingMessages"
          :key="message.id"
          :class="message.role === 'user' ? 'agent-chat-message is-user' : 'agent-chat-response'"
        >
          <span v-if="message.role === 'assistant'" class="agent-chat-response-mark">✦</span>
          <div :class="message.role === 'user' ? 'agent-chat-bubble' : ''">
            <header><strong>{{ message.role === 'user' ? '你' : 'Agent' }}</strong><time>{{ formatTime(message.createdAt) }}</time></header>
            <p>{{ message.content }}</p>
          </div>
        </article>

        <template v-if="props.currentTask">
          <article class="agent-chat-message is-user">
            <div class="agent-chat-bubble">
              <header><strong>你</strong><time>{{ props.currentTask.shortId || '' }}</time></header>
              <p>{{ props.currentTask.userOriginal || props.currentTask.detail || props.currentTask.title }}</p>
            </div>
          </article>

          <article v-if="!run" class="agent-chat-response is-ready">
            <span class="agent-chat-response-mark">✦</span>
            <div>
              <p>任务已就绪。启动后会读取任务定义和当前项目上下文。</p>
              <button class="btn btn-primary btn-sm" type="button" :disabled="props.busy || props.credentialStatus !== 'configured'" @click="startRun">启动任务</button>
            </div>
          </article>

          <details v-if="run?.checklist?.items.length" class="agent-chat-checklist" :open="props.busy || run.checklist.progress.doing > 0">
            <summary>
              <span class="agent-chat-checklist-mark">{{ run.checklist.progress.done }}/{{ run.checklist.progress.total }}</span>
              <strong>{{ run.checklist.summary || '执行清单' }}</strong>
              <small>{{ phaseLabel(run.graph?.currentNode || run.phase) }} · 图已跳转 {{ run.graph?.historyCount || 0 }} 次</small>
            </summary>
            <div class="agent-chat-checklist-items">
              <div v-for="item in run.checklist.items" :key="item.id" :class="`is-${item.status}`">
                <span class="agent-chat-checklist-state">{{ item.status === 'done' ? '✓' : item.status === 'doing' ? '●' : item.status === 'blocked' ? '!' : '○' }}</span>
                <p><strong>{{ item.title }}</strong><small>{{ checklistStatusLabel(item.status) }}<template v-if="item.attempt"> · 尝试 {{ item.attempt }}</template><template v-if="item.dependsOn.length"> · 依赖 {{ item.dependsOn.join('、') }}</template></small></p>
              </div>
            </div>
          </details>

          <details v-if="timeline.activity.length" class="agent-chat-activity" :open="props.busy">
            <summary>
              <span class="agent-chat-activity-state" :class="{ running: props.busy }"><i /></span>
              <strong>{{ activitySummary }}</strong>
              <small>{{ timeline.activity.reduce((total, group) => total + group.count, 0) }} 项详情</small>
            </summary>
            <div class="agent-chat-activity-list">
              <div v-for="group in timeline.activity" :key="group.key">
                <span>{{ activityGlyph(group) }}</span>
                <p>{{ activityLabel(group) }}<small v-if="group.count > 1">× {{ group.count }}</small></p>
                <time>{{ formatTime(group.event.at) }}</time>
              </div>
            </div>
          </details>

          <details v-if="timeline.issues.length" class="agent-chat-issues">
            <summary>
              <span>!</span>
              <strong>{{ timeline.issues.length }} 类问题</strong>
              <small>展开排错信息</small>
            </summary>
            <div>
              <article v-for="group in timeline.issues" :key="group.key">
                <header><strong>{{ humanizeAgentSummary(group.event.summary) }}</strong><time>{{ formatTime(group.event.at) }}</time></header>
                <small v-if="group.count > 1">重复 {{ group.count }} 次</small>
                <details v-if="group.event.payload" class="agent-chat-event-payload">
                  <summary>错误详情</summary>
                  <pre>{{ eventPayload(group.event) }}</pre>
                </details>
              </article>
            </div>
          </details>

          <article v-if="waiting && run" class="agent-chat-approval">
            <div class="agent-chat-approval-mark">!</div>
            <div>
              <span>{{ waiting.kind === 'plan_approval' ? '方案审批' : waiting.kind === 'tool_approval' ? '操作审批' : '需要你的输入' }}</span>
              <h3>{{ waiting.summary }}</h3>
              <p>批准后 Agent 会继续运行；拒绝后会保留当前检查点。</p>
              <div class="agent-chat-approval-actions">
                <button class="btn btn-primary btn-sm" type="button" :disabled="props.busy" @click="emit('approve', run.runId)">批准并继续</button>
                <button class="btn btn-outline-secondary btn-sm" type="button" :disabled="props.busy" @click="emit('deny', run.runId)">拒绝</button>
              </div>
            </div>
          </article>

          <details v-if="run?.status === 'failed' && runDiagnostics.length" class="agent-chat-diagnostics">
            <summary>模型诊断 · {{ runDiagnostics[0].providerId }} / {{ runDiagnostics[0].model }}</summary>
            <div>
              <p v-for="(entry, index) in runDiagnostics" :key="`${entry.at}-${entry.event}-${index}`" :class="{ error: entry.level === 'error' }">
                <time>{{ formatTime(entry.at) }}</time>
                <span>{{ diagnosticSummary(entry) }}</span>
              </p>
            </div>
          </details>

          <article v-if="canRestartTerminal" class="agent-chat-resume-blocked">
            <strong>可以重新运行</strong>
            <p>{{ restartReason }}</p>
            <button class="btn btn-outline-secondary btn-sm" type="button" :disabled="props.busy" @click="startRun">新建运行</button>
          </article>

          <section v-if="timeline.changedFiles.length || outputRefs.length" class="agent-chat-change-set" aria-label="文件变更与运行产物">
            <header>
              <div>
                <span class="agent-chat-change-mark">±</span>
                <strong>{{ timeline.changedFiles.length ? `修改了 ${timeline.changedFiles.length} 个文件` : '运行产物' }}</strong>
              </div>
              <button v-if="run?.diff?.outputRef" type="button" @click="emit('openOutput', run.diff.outputRef, '完整代码差异')">查看 Diff</button>
            </header>
            <div v-if="timeline.changedFiles.length" class="agent-chat-file-list">
              <div v-for="file in visibleChangedFiles" :key="file">
                <span>M</span>
                <strong>{{ fileName(file) }}</strong>
                <small>{{ fileDirectory(file) }}</small>
              </div>
            </div>
            <button
              v-if="hiddenChangedFileCount"
              class="agent-chat-file-toggle"
              type="button"
              :aria-expanded="filesExpanded"
              @click="filesExpanded = !filesExpanded"
            >{{ filesExpanded ? '收起文件列表' : `展开其余 ${hiddenChangedFileCount} 个文件` }}</button>
            <details v-if="nonDiffOutputRefs.length" class="agent-chat-output-links">
              <summary>{{ nonDiffOutputRefs.length }} 项运行输出</summary>
              <div>
                <button
                  v-for="(ref, index) in nonDiffOutputRefs"
                  :key="ref"
                  type="button"
                  @click="emit('openOutput', ref, `运行输出 ${index + 1}`)"
                >运行输出 {{ index + 1 }} →</button>
              </div>
            </details>
          </section>

          <div v-if="timeline.verifications.length" class="agent-chat-verifications">
            <div v-for="group in timeline.verifications" :key="group.key" :class="{ failed: group.event.payload?.passed === false }">
              <span>{{ group.event.payload?.passed === false ? '×' : '✓' }}</span>
              <p>{{ group.event.summary }}</p>
              <time>{{ formatTime(group.event.at) }}</time>
            </div>
          </div>

          <article v-if="timeline.terminal" class="agent-chat-response" :class="`is-${run?.status || 'complete'}`">
            <span class="agent-chat-response-mark">✦</span>
            <div>
              <p>{{ humanizeAgentSummary(timeline.terminal.summary) }}</p>
              <details v-if="timeline.terminal.payload && ['run.failed', 'run.blocked'].includes(timeline.terminal.type || '')" class="agent-chat-event-payload">
                <summary>错误详情</summary>
                <pre>{{ eventPayload(timeline.terminal) }}</pre>
              </details>
            </div>
          </article>

          <article v-if="run && !props.busy && !waiting && !isTerminal && run.resume?.kind !== 'blocked'" class="agent-chat-next-action">
            <div><strong>自动推进已暂停</strong><small>{{ run.nextAction || '可以从本地检查点安全恢复' }}</small></div>
            <button class="btn btn-primary btn-sm" type="button" @click="emit('advance', run.runId)">恢复推进</button>
          </article>

          <article v-if="props.busy" class="agent-chat-thinking" role="status">
            <span><i /><i /><i /></span>
            <p>Agent 正在处理，新的进度会自动出现在这里。</p>
          </article>
        </template>

        <article
          v-for="message in remainingLocalMessages"
          :key="message.id"
          :class="message.role === 'user' ? 'agent-chat-message is-user' : 'agent-chat-response'"
        >
          <span v-if="message.role === 'assistant'" class="agent-chat-response-mark">✦</span>
          <div :class="message.role === 'user' ? 'agent-chat-bubble' : ''">
            <header><strong>{{ message.role === 'user' ? '你' : 'Agent' }}</strong><time>{{ formatTime(message.createdAt) }}</time></header>
            <p>{{ message.content }}</p>
          </div>
        </article>

        <article v-if="props.busy && !props.currentTask" class="agent-chat-thinking" role="status">
          <span><i /><i /><i /></span>
          <p>模型正在回复，对话会保存在本机。</p>
        </article>
      </div>

      <section v-if="showRunControl" class="agent-chat-run-control" role="status" aria-live="polite">
        <span class="agent-chat-run-control-state" :class="{ stopping: stopRequested }"><i /></span>
        <div>
          <strong>{{ liveActivityTitle }}</strong>
          <small>{{ liveActivityDetail }}<template v-if="runElapsed"> · {{ runElapsed }}</template></small>
        </div>
        <button class="btn btn-outline-secondary btn-sm" type="button" :disabled="stopRequested" @click="requestRunStop">
          {{ stopRequested ? '正在停止…' : '停止运行' }}
        </button>
      </section>

      <form class="agent-chat-composer" @submit.prevent="submitMessage">
        <textarea
          v-model="draft"
          rows="3"
          :placeholder="composerPlaceholder"
          :disabled="props.busy || !!waiting || props.credentialStatus !== 'configured'"
          @keydown.enter.exact.prevent="submitMessage"
        />
        <footer>
          <span>Enter 发送 · 明确执行请求才会建任务</span>
          <button
            v-if="props.credentialStatus === 'configured'"
            class="btn btn-primary btn-sm"
            type="submit"
            :disabled="!canCompose || !draft.trim()"
          >{{ sendLabel }}</button>
        </footer>
      </form>
    </main>
  </section>
</template>

<style scoped>
.agent-chat-view {
  display: grid;
  grid-template-columns: 252px minmax(0, 1fr);
  width: 100%;
  height: min(780px, calc(100vh - 136px));
  min-height: min(560px, calc(100vh - 96px));
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  box-shadow: 0 8px 28px color-mix(in srgb, var(--shadow-color) 24%, transparent);
}

.agent-chat-sidebar {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-width: 0;
  border-right: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 70%, var(--surface) 30%);
}

.agent-chat-sidebar-head,
.agent-chat-header,
.agent-chat-title,
.agent-chat-header-actions,
.agent-chat-credential,
.agent-chat-approval-actions,
.agent-chat-next-action,
.agent-chat-composer footer {
  display: flex;
  align-items: center;
}

.agent-chat-sidebar-head {
  justify-content: space-between;
  padding: 18px 16px 14px;
}

.agent-chat-sidebar-head h2,
.agent-chat-header h2,
.agent-chat-empty h3,
.agent-chat-approval h3 {
  margin: 0;
}

.agent-chat-sidebar-head h2 {
  font-size: 15px;
}

.agent-chat-kicker {
  display: block;
  margin-bottom: 3px;
  color: var(--muted);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.agent-chat-settings {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
  color: var(--muted);
}

.agent-chat-settings:hover {
  border-color: var(--primary);
  color: var(--text);
}

.agent-chat-credential {
  gap: 7px;
  margin: 0 12px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-soft);
  color: var(--muted);
  padding: 8px 9px;
  font-size: 10px;
}

.agent-chat-credential i,
.agent-chat-attention {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--warning);
}

.agent-chat-credential.is-configured i {
  background: var(--complete);
}

.agent-chat-credential.is-error i,
.agent-chat-credential.is-missing i {
  background: var(--danger);
}

.agent-chat-credential span {
  min-width: 0;
  flex: 1;
}

.agent-chat-conversations {
  display: grid;
  align-content: start;
  gap: 5px;
  overflow-y: auto;
  padding: 4px 10px 14px;
}

.agent-chat-sidebar-empty {
  color: var(--muted);
  padding: 16px 8px;
  font-size: 11px;
  text-align: center;
}

.agent-chat-conversation {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  padding: 9px;
  text-align: left;
}

.agent-chat-conversation-entry {
  position: relative;
  min-width: 0;
}

.agent-chat-conversation-entry .agent-chat-conversation {
  width: 100%;
  padding-right: 32px;
}

.agent-chat-conversation-delete {
  position: absolute;
  top: 50%;
  right: 8px;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font-size: 16px;
  line-height: 1;
  opacity: 0;
  transform: translateY(-50%);
}

.agent-chat-conversation-entry:hover .agent-chat-conversation-delete,
.agent-chat-conversation-delete:focus-visible {
  opacity: 1;
}

.agent-chat-conversation-delete:hover {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.agent-chat-conversation:hover,
.agent-chat-conversation.active {
  border-color: var(--border);
  background: var(--surface-soft);
}

.agent-chat-conversation.active {
  border-color: color-mix(in srgb, var(--primary) 34%, var(--border));
  box-shadow: inset 2px 0 var(--primary);
}

.agent-chat-task-mark,
.agent-chat-task-id {
  overflow: hidden;
  color: var(--primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 9px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-chat-task-copy {
  min-width: 0;
}

.agent-chat-task-copy strong,
.agent-chat-task-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-chat-task-copy strong {
  font-size: 11px;
}

.agent-chat-task-copy small {
  margin-top: 3px;
  color: var(--muted);
  font-size: 9px;
}

.agent-chat-main {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto auto;
  min-width: 0;
  min-height: 0;
  background: var(--surface);
}

.agent-chat-header {
  grid-row: 1;
  min-height: 70px;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--border);
  padding: 13px 18px;
}

.agent-chat-title {
  min-width: 0;
  gap: 11px;
}

.agent-chat-title > div {
  min-width: 0;
}

.agent-chat-title h2 {
  overflow: hidden;
  font-size: 15px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-chat-title small,
.agent-chat-next-action small {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: 10px;
}

.agent-chat-task-id {
  max-width: 74px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-soft);
  padding: 5px 7px;
}

.agent-chat-header-actions {
  flex: 0 0 auto;
  gap: 8px;
}

.agent-chat-status {
  grid-row: 2;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--primary-soft) 64%, var(--surface) 36%);
  color: var(--muted);
  padding: 7px 18px;
  font-size: 10px;
}

.agent-chat-status:empty {
  display: none;
}

.agent-chat-checklist {
  width: min(820px, 100%);
  margin: 0 0 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-soft);
}

.agent-chat-checklist summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  padding: 10px 12px;
  font-size: 11px;
}

.agent-chat-checklist summary small,
.agent-chat-checklist-items small {
  color: var(--muted);
  font-size: 9px;
}

.agent-chat-checklist-mark {
  min-width: 34px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: var(--primary);
  padding: 3px 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 9px;
  font-weight: 800;
  text-align: center;
}

.agent-chat-checklist-items {
  display: grid;
  border-top: 1px solid var(--border);
  padding: 5px 12px 9px;
}

.agent-chat-checklist-items > div {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 7px;
  padding: 7px 0;
}

.agent-chat-checklist-items p,
.agent-chat-checklist-items strong,
.agent-chat-checklist-items small {
  display: block;
  margin: 0;
}

.agent-chat-checklist-items strong {
  font-size: 10px;
}

.agent-chat-checklist-state {
  color: var(--muted);
  font-size: 11px;
  text-align: center;
}

.agent-chat-checklist-items .is-doing .agent-chat-checklist-state {
  color: var(--primary);
}

.agent-chat-checklist-items .is-done .agent-chat-checklist-state {
  color: var(--complete);
}

.agent-chat-checklist-items .is-blocked .agent-chat-checklist-state {
  color: var(--danger);
}

.agent-chat-diagnostics {
  width: min(820px, 100%);
  margin: 0 0 14px;
  border: 0;
  border-left: 2px solid color-mix(in srgb, var(--danger) 55%, var(--border));
  background: transparent;
  padding: 5px 0 5px 10px;
}

.agent-chat-diagnostics summary {
  cursor: pointer;
  color: var(--text);
  font-size: 10px;
  font-weight: 650;
}

.agent-chat-diagnostics > div {
  display: grid;
  gap: 5px;
  margin-top: 9px;
}

.agent-chat-diagnostics p {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  gap: 8px;
  margin: 0;
  color: var(--muted);
  font-size: 10px;
}

.agent-chat-diagnostics p.error { color: var(--danger); }
.agent-chat-diagnostics time { color: var(--muted); }

.agent-chat-context-tools {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  width: min(820px, 100%);
  margin-bottom: 24px;
}

.agent-chat-memory {
  min-width: 0;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-soft);
  padding: 9px 11px;
}

.agent-chat-memory[open] { grid-column: 1 / -1; }

.agent-chat-memory summary {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  cursor: pointer;
  list-style: none;
}

.agent-chat-memory summary::-webkit-details-marker { display: none; }
.agent-chat-memory summary strong { font-size: 11px; }

.agent-chat-memory summary small {
  overflow: hidden;
  color: var(--muted);
  font-size: 9px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-chat-memory-mark {
  color: var(--primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 8px;
  font-weight: 800;
}

.agent-chat-memory-body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 11px;
  border-top: 1px solid var(--border);
  padding-top: 11px;
}

.agent-chat-memory-body section {
  min-width: 0;
  border-radius: 7px;
  background: var(--surface);
  padding: 10px;
}

.agent-chat-memory-body strong,
.agent-chat-memory-body dt,
.agent-chat-memory-body dd,
.agent-chat-memory-body p { font-size: 9px; }

.agent-chat-memory-body dl {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
  margin: 8px 0;
}

.agent-chat-memory-body dl div {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
}

.agent-chat-memory-body dt { color: var(--muted); }

.agent-chat-memory-body dd {
  margin: 3px 0 0;
  color: var(--text);
  font-weight: 700;
}

.agent-chat-memory-body p {
  margin: 6px 0 0;
  color: var(--muted);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.agent-chat-messages {
  grid-row: 3;
  min-height: 0;
  overflow-y: auto;
  padding: 26px clamp(18px, 7vw, 84px);
  scroll-behavior: smooth;
}

.agent-chat-empty {
  display: grid;
  width: min(440px, 100%);
  margin: 12vh auto 0;
  justify-items: center;
  color: var(--muted);
  text-align: center;
}

.agent-chat-empty-mark {
  display: grid;
  width: 44px;
  height: 44px;
  margin-bottom: 13px;
  place-items: center;
  border: 1px solid var(--primary);
  border-radius: 12px;
  color: var(--primary);
  font-size: 11px;
  font-weight: 800;
}

.agent-chat-empty h3 {
  color: var(--text);
  font-size: 16px;
}

.agent-chat-empty p {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.65;
}

.agent-chat-message {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: start;
  gap: 9px;
  width: min(680px, 86%);
  margin-bottom: 22px;
}

.agent-chat-message.is-user {
  grid-template-columns: minmax(0, 1fr);
  margin-left: auto;
}

.agent-chat-message.is-user .agent-chat-avatar {
  grid-column: 2;
  grid-row: 1;
  background: var(--primary);
  color: var(--primary-contrast, white);
}

.agent-chat-message.is-user .agent-chat-bubble {
  grid-column: 1;
  grid-row: 1;
  border-color: color-mix(in srgb, var(--primary) 18%, var(--border));
  background: color-mix(in srgb, var(--primary-soft) 72%, var(--surface) 28%);
}

.agent-chat-avatar {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-soft);
  color: var(--primary);
  font-size: 9px;
  font-weight: 800;
}

.agent-chat-message.is-system .agent-chat-avatar,
.agent-chat-message.is-approval .agent-chat-avatar {
  border-radius: 50%;
  color: var(--muted);
}

.agent-chat-bubble {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
  padding: 10px 13px;
}

.agent-chat-bubble header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.agent-chat-bubble strong,
.agent-chat-bubble time {
  font-size: 10px;
}

.agent-chat-bubble time {
  color: var(--muted);
}

.agent-chat-bubble p {
  margin: 6px 0 0;
  color: var(--text);
  font-size: 12px;
  line-height: 1.65;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.agent-chat-bubble .btn {
  margin-top: 10px;
}

.agent-chat-response {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 10px;
  width: min(820px, 100%);
  margin: 2px 0 22px;
  color: var(--text);
}

.agent-chat-response-mark {
  color: var(--primary);
  font-size: 13px;
  line-height: 1.75;
}

.agent-chat-response header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 5px;
}

.agent-chat-response header strong,
.agent-chat-response header time { font-size: 10px; }
.agent-chat-response header time { color: var(--muted); }

.agent-chat-response p {
  margin: 0;
  font-size: 12px;
  line-height: 1.75;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.agent-chat-response .btn { margin-top: 10px; }
.agent-chat-response.is-failed,
.agent-chat-response.is-blocked,
.agent-chat-response.is-cancelled { color: var(--danger); }

.agent-chat-activity,
.agent-chat-issues,
.agent-chat-change-set,
.agent-chat-verifications {
  width: min(820px, 100%);
  margin-bottom: 16px;
}

.agent-chat-activity,
.agent-chat-issues {
  border: 0;
}

.agent-chat-activity > summary,
.agent-chat-issues > summary {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  cursor: pointer;
  list-style: none;
  color: var(--muted);
  font-size: 10px;
}

.agent-chat-activity > summary::-webkit-details-marker,
.agent-chat-issues > summary::-webkit-details-marker { display: none; }

.agent-chat-activity > summary strong,
.agent-chat-issues > summary strong {
  color: var(--muted-strong);
  font-size: 10px;
}

.agent-chat-activity > summary small,
.agent-chat-issues > summary small { font-size: 9px; }

.agent-chat-activity-state {
  display: grid;
  width: 16px;
  height: 16px;
  place-items: center;
}

.agent-chat-activity-state i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--complete);
}

.agent-chat-activity-state.running i {
  background: var(--primary);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 12%, transparent);
  animation: agent-chat-pulse 1.1s infinite ease-in-out;
}

.agent-chat-activity-list {
  display: grid;
  gap: 1px;
  margin: 4px 0 0 7px;
  border-left: 1px solid var(--border);
  padding: 4px 0 4px 19px;
}

.agent-chat-activity-list > div {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  min-height: 28px;
  color: var(--muted);
}

.agent-chat-activity-list > div > span {
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 9px;
}

.agent-chat-activity-list p {
  display: flex;
  gap: 7px;
  margin: 0;
  color: var(--muted-strong);
  font-size: 10px;
}

.agent-chat-activity-list p small,
.agent-chat-activity-list time {
  color: var(--muted);
  font-size: 9px;
}

.agent-chat-issues > summary > span {
  color: var(--danger);
  font-weight: 900;
  text-align: center;
}

.agent-chat-issues > div {
  display: grid;
  gap: 7px;
  margin: 5px 0 0 26px;
}

.agent-chat-issues article {
  border-left: 2px solid color-mix(in srgb, var(--danger) 65%, var(--border));
  background: color-mix(in srgb, var(--danger) 4%, transparent);
  padding: 8px 10px;
}

.agent-chat-issues article header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.agent-chat-issues article strong { font-size: 10px; }
.agent-chat-issues article time,
.agent-chat-issues article > small { color: var(--muted); font-size: 9px; }

.agent-chat-change-set {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-soft);
}

.agent-chat-change-set > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--border);
  padding: 9px 11px;
}

.agent-chat-change-set > header > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-chat-change-set > header strong { font-size: 11px; }
.agent-chat-change-mark { color: var(--primary); font-weight: 800; }

.agent-chat-change-set button {
  border: 0;
  background: transparent;
  color: var(--primary);
  padding: 0;
  font-size: 9px;
}

.agent-chat-file-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
  padding: 5px 10px;
}

.agent-chat-file-list > div {
  display: grid;
  grid-template-columns: 18px minmax(0, auto) minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  min-width: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 58%, transparent);
  padding: 7px 0;
}

.agent-chat-file-list > div:nth-last-child(-n + 2) { border-bottom: 0; }
.agent-chat-file-list span { color: var(--warning); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 9px; }
.agent-chat-file-list strong { overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.agent-chat-file-list small { overflow: hidden; color: var(--muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }

.agent-chat-file-toggle {
  display: block;
  width: 100%;
  border-top: 1px solid var(--border) !important;
  padding: 8px 11px !important;
  text-align: left;
}

.agent-chat-output-links {
  border-top: 1px solid var(--border);
  padding: 8px 11px;
}

.agent-chat-output-links > summary {
  cursor: pointer;
  list-style: none;
  color: var(--primary);
  font-size: 9px;
}

.agent-chat-output-links > summary::-webkit-details-marker { display: none; }

.agent-chat-output-links > div {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
}

.agent-chat-verifications {
  display: grid;
  gap: 4px;
}

.agent-chat-verifications > div {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  color: var(--complete);
  padding: 3px 0;
}

.agent-chat-verifications > div.failed { color: var(--danger); }
.agent-chat-verifications p { margin: 0; color: var(--muted-strong); font-size: 10px; }
.agent-chat-verifications time { color: var(--muted); font-size: 9px; }

.agent-chat-approval,
.agent-chat-resume-blocked,
.agent-chat-next-action {
  width: min(820px, 100%);
  margin: 6px 0 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-soft);
}

.agent-chat-approval {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 11px;
  border-color: color-mix(in srgb, var(--warning) 42%, var(--border));
  background: color-mix(in srgb, var(--warning-soft) 58%, var(--surface) 42%);
  padding: 14px;
}

.agent-chat-approval-mark {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 8px;
  background: var(--warning);
  color: var(--surface);
  font-weight: 900;
}

.agent-chat-approval span {
  color: var(--warning);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.agent-chat-approval h3 {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.45;
}

.agent-chat-approval p,
.agent-chat-resume-blocked p {
  margin: 6px 0 10px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.55;
}

.agent-chat-approval-actions {
  gap: 7px;
}

.agent-chat-resume-blocked {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px 16px;
  border: 0;
  border-top: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  padding: 12px 0 0;
}

.agent-chat-resume-blocked strong { font-size: 11px; }
.agent-chat-resume-blocked p { grid-column: 1; margin: 3px 0 0; }
.agent-chat-resume-blocked .btn { grid-column: 2; grid-row: 1 / span 2; }

.agent-chat-outputs {
  padding: 12px;
}

.agent-chat-outputs > header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.agent-chat-outputs > header strong {
  font-size: 11px;
}

.agent-chat-outputs > header small {
  color: var(--muted);
  font-size: 9px;
}

.agent-chat-outputs > div {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.agent-chat-outputs button {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--text);
  padding: 9px;
  text-align: left;
}

.agent-chat-outputs button:hover {
  border-color: var(--primary);
}

.agent-chat-outputs button > span {
  color: var(--primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 8px;
  font-weight: 800;
}

.agent-chat-outputs button strong {
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-chat-outputs button small {
  color: var(--muted);
  font-size: 9px;
}

.agent-chat-next-action {
  justify-content: space-between;
  gap: 16px;
  padding: 11px 12px;
}

.agent-chat-next-action strong {
  font-size: 11px;
}

.agent-chat-next-action small {
  max-width: 500px;
  overflow-wrap: anywhere;
}

.agent-chat-thinking {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 6px 0 12px 37px;
  color: var(--muted);
}

.agent-chat-thinking > span {
  display: flex;
  gap: 3px;
}

.agent-chat-thinking i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--primary);
  animation: agent-chat-pulse 1.1s infinite ease-in-out;
}

.agent-chat-thinking i:nth-child(2) { animation-delay: 0.16s; }
.agent-chat-thinking i:nth-child(3) { animation-delay: 0.32s; }

.agent-chat-thinking p {
  margin: 0;
  font-size: 10px;
}

.agent-chat-event-payload {
  margin-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  padding-top: 6px;
}

.agent-chat-event-payload summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 9px;
}

.agent-chat-event-payload pre {
  margin: 7px 0 0;
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--muted-strong);
  font-size: 9px;
  line-height: 1.5;
}

.agent-chat-composer {
  grid-row: 5;
  margin: 0 18px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--field-bg);
  box-shadow: 0 8px 28px color-mix(in srgb, var(--shadow-color) 35%, transparent);
}

.agent-chat-run-control {
  grid-row: 4;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin: 0 18px 8px;
  border: 1px solid color-mix(in srgb, var(--primary) 30%, var(--border));
  border-radius: 9px;
  background: color-mix(in srgb, var(--primary-soft) 60%, var(--surface) 40%);
  padding: 9px 10px 9px 12px;
}

.agent-chat-run-control > div { min-width: 0; }
.agent-chat-run-control strong,
.agent-chat-run-control small { display: block; }
.agent-chat-run-control strong { font-size: 11px; }
.agent-chat-run-control small {
  margin-top: 2px;
  overflow: hidden;
  color: var(--muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-chat-run-control-state {
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
}

.agent-chat-run-control-state i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  animation: agent-chat-pulse 1.1s infinite ease-in-out;
}

.agent-chat-run-control-state.stopping i {
  border-radius: 2px;
  background: var(--danger);
  animation: none;
}

.agent-chat-composer:focus-within {
  border-color: color-mix(in srgb, var(--primary) 48%, var(--border));
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.agent-chat-composer textarea {
  min-height: 66px;
  resize: none;
  border: 0;
  background: transparent;
  padding: 12px 13px 5px;
  box-shadow: none;
  font-size: 12px;
  line-height: 1.55;
}

.agent-chat-composer footer {
  justify-content: space-between;
  gap: 12px;
  padding: 7px 9px 9px 13px;
}

.agent-chat-composer footer > span {
  color: var(--muted);
  font-size: 9px;
}

@keyframes agent-chat-pulse {
  0%, 70%, 100% { opacity: 0.28; transform: translateY(0); }
  35% { opacity: 1; transform: translateY(-2px); }
}

@media (max-width: 820px) {
  .agent-chat-view {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 0;
  }

  .agent-chat-sidebar {
    grid-template-rows: auto auto auto;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .agent-chat-conversations {
    grid-auto-flow: column;
    grid-auto-columns: minmax(210px, 70vw);
    overflow-x: auto;
    overflow-y: hidden;
  }

  .agent-chat-main {
    min-height: 620px;
  }
}

@media (max-width: 560px) {
  .agent-chat-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .agent-chat-header-actions {
    width: 100%;
    justify-content: space-between;
  }

  .agent-chat-messages {
    padding: 18px 12px;
  }

  .agent-chat-message {
    width: 100%;
  }

  .agent-chat-approval,
  .agent-chat-resume-blocked,
  .agent-chat-next-action,
  .agent-chat-memory {
    width: 100%;
  }

  .agent-chat-context-tools,
  .agent-chat-memory-body { grid-template-columns: 1fr; }

  .agent-chat-file-list {
    grid-template-columns: 1fr;
  }

  .agent-chat-file-list > div:nth-last-child(-n + 2) { border-bottom: 1px solid color-mix(in srgb, var(--border) 58%, transparent); }
  .agent-chat-file-list > div:last-child { border-bottom: 0; }

  .agent-chat-resume-blocked {
    grid-template-columns: 1fr;
  }

  .agent-chat-resume-blocked .btn {
    grid-column: 1;
    grid-row: auto;
    justify-self: start;
    margin-top: 7px;
  }

  .agent-chat-next-action {
    align-items: flex-start;
    flex-direction: column;
  }

  .agent-chat-composer {
    margin: 0 12px 12px;
  }

  .agent-chat-composer footer > span {
    display: none;
  }
}
</style>
