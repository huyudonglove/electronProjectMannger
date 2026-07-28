<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import UiTag from '../ui/UiTag.vue'

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

type RunEvent = {
  sequence: number
  at?: string
  type?: string
  phase?: string
  summary: string
}

type RunDetail = {
  run: RunView
  events: RunEvent[]
}

type CredentialStatus = 'configured' | 'missing' | 'loading' | 'error'

type ConversationItem = {
  task: TaskItem | RunTask
  run?: RunView
}

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
  tasks?: TaskItem[]
  chats?: ChatConversation[]
  currentChat?: ChatConversation | null
  currentTask: TaskItem | null
  runDetail: RunDetail | null
  runs: RunView[]
  busy: boolean
  status?: string
  credentialStatus: CredentialStatus
  credentialLabel?: string
  diagnostics?: ModelDiagnostic[]
  localMessages?: LocalChatMessage[]
  memoryStatus?: ProjectMemoryStatus | null
}>(), {
  tasks: () => [],
  chats: () => [],
  currentChat: null,
  status: '',
  credentialLabel: '',
  diagnostics: () => [],
  localMessages: () => [],
  memoryStatus: null,
})

const emit = defineEmits<{
  selectChat: [conversationId: string]
  selectTask: [taskId: string]
  start: [taskId: string, instruction?: string]
  advance: [runId: string, instruction?: string]
  approve: [runId: string]
  deny: [runId: string]
  cancel: [runId: string]
  openOutput: [ref: string, label: string]
  newChat: []
  send: [message: string]
}>()

const draft = ref('')
const messageStream = ref<HTMLElement | null>(null)

const run = computed(() => props.runDetail?.run || latestTaskRun.value || null)
const events = computed(() => props.runDetail?.events || [])
const isTerminal = computed(() => !!run.value && ['completed', 'blocked', 'failed', 'cancelled'].includes(run.value.status))
const waiting = computed(() => run.value?.waiting || null)
const canCompose = computed(() => props.credentialStatus === 'configured' && !props.busy && !waiting.value)
const outputRefs = computed(() => run.value?.outputRefs || [])
const runMemory = computed(() => run.value?.memory || null)
const runDiagnostics = computed(() => (props.diagnostics || [])
  .filter((entry) => !run.value?.runId || entry.runId === run.value.runId)
  .slice(0, 8))
const canRestartTerminal = computed(() => !!run.value
  && ['blocked', 'failed', 'cancelled'].includes(run.value.status)
  && !!props.currentTask
  && ['todo', 'doing'].includes(props.currentTask.status || ''))
const restartReason = computed(() => run.value?.resume?.kind === 'blocked'
  ? run.value.resume.reason
  : `上次运行${runStatusLabel(run.value?.status)}，任务已回到待办，可以从新运行重新开始。`)

const latestTaskRun = computed(() => {
  if (!props.currentTask) return null
  return props.runs.find((item) => item.task?.id === props.currentTask?.id || item.task?.shortId === props.currentTask?.shortId) || null
})

const conversations = computed<ConversationItem[]>(() => {
  const byTask = new Map<string, ConversationItem>()
  const runTaskIds = new Set(props.runs.flatMap((item) => item.task
    ? [item.task.id, item.task.shortId].filter((id): id is string => !!id)
    : []))
  for (const task of props.tasks) {
    if (['todo', 'doing'].includes(task.status || '') || runTaskIds.has(task.id) || runTaskIds.has(task.shortId || '')) {
      byTask.set(task.id, { task })
    }
  }
  for (const item of props.runs) {
    if (!item.task) continue
    const key = item.task.id || item.task.shortId || item.runId
    if (!byTask.has(key) || !byTask.get(key)?.run) byTask.set(key, { task: item.task, run: item })
  }
  if (props.currentTask && !byTask.has(props.currentTask.id)) {
    byTask.set(props.currentTask.id, { task: props.currentTask, ...(latestTaskRun.value ? { run: latestTaskRun.value } : {}) })
  }
  return [...byTask.values()]
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

watch(
  () => [props.currentTask?.id, props.currentChat?.id, props.localMessages.length, events.value.length, waiting.value?.id, run.value?.status],
  async () => {
    await nextTick()
    if (messageStream.value) messageStream.value.scrollTop = messageStream.value.scrollHeight
  },
  { flush: 'post' },
)

function submitMessage() {
  if (props.credentialStatus !== 'configured') return
  const message = draft.value.trim()
  if (!message || props.busy || waiting.value) return
  emit('send', message)
  draft.value = ''
}

function startRun() {
  if (!props.currentTask || props.busy) return
  if (props.credentialStatus !== 'configured') return
  emit('start', props.currentTask.id)
}

function outputLabel(ref: string, index: number) {
  if (run.value?.diff?.outputRef === ref) return '完整代码差异'
  const earlier = outputRefs.value.slice(0, index).filter((item) => item !== run.value?.diff?.outputRef)
  return `运行输出 ${earlier.length + 1}`
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

function eventRole(event: RunEvent) {
  if (event.type?.startsWith('approval.')) return 'approval'
  if (event.type?.startsWith('run.') || event.type?.startsWith('verification.')) return 'system'
  return 'agent'
}

function formatTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date)
}

function diagnosticSummary(entry: ModelDiagnostic) {
  if (entry.error) return entry.error
  if (entry.actionShape) return `响应结构：${entry.actionShape}`
  if (entry.status) return `HTTP ${entry.status}${entry.durationMs !== undefined ? ` · ${entry.durationMs} ms` : ''}`
  return entry.event === 'request.started' ? '请求已发送到本机 Provider' : entry.event
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
        <p v-if="!props.chats.length && !conversations.length" class="agent-chat-sidebar-empty">暂无对话</p>
        <button
          v-for="chat in props.chats"
          :key="chat.id"
          class="agent-chat-conversation"
          :class="{ active: chat.id === props.currentChat?.id }"
          type="button"
          @click="emit('selectChat', chat.id)"
        >
          <span class="agent-chat-task-mark">CHAT</span>
          <span class="agent-chat-task-copy">
            <strong>{{ chat.title || '未命名对话' }}</strong>
            <small>普通问答 · {{ formatTime(chat.updatedAt) }}</small>
          </span>
        </button>
        <button
          v-for="item in conversations"
          :key="item.task.id || item.task.shortId"
          class="agent-chat-conversation"
          :class="{ active: item.task.id === props.currentTask?.id }"
          type="button"
          @click="emit('selectTask', item.task.id)"
        >
          <span class="agent-chat-task-mark">{{ item.task.shortId || 'TASK' }}</span>
          <span class="agent-chat-task-copy">
            <strong>{{ item.task.title || '未命名任务' }}</strong>
            <small>{{ item.run ? `${runStatusLabel(item.run.status)} · ${phaseLabel(item.run.phase)}` : '尚未启动' }}</small>
          </span>
          <i v-if="item.run?.status === 'awaiting_approval' || item.run?.waiting" class="agent-chat-attention" title="等待审批" />
        </button>
      </div>
    </aside>

    <main class="agent-chat-main">
      <header class="agent-chat-header">
        <div class="agent-chat-title">
          <span v-if="props.currentTask?.shortId" class="agent-chat-task-id">{{ props.currentTask.shortId }}</span>
          <div>
            <h2>{{ props.currentTask?.title || props.currentChat?.title || '新对话' }}</h2>
            <small v-if="run">{{ phaseLabel(run.phase) }} · 更新于 {{ formatTime(run.updatedAt) || '未知时间' }}</small>
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
            v-if="run && props.busy"
            class="btn btn-outline-secondary btn-sm"
            type="button"
            @click="emit('cancel', run.runId)"
          >停止</button>
        </div>
      </header>

      <div v-if="props.status" class="agent-chat-status" role="status">{{ props.status }}</div>

      <div ref="messageStream" class="agent-chat-messages" aria-live="polite">
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

        <div v-if="!props.currentTask && !props.localMessages.length" class="agent-chat-empty">
          <span class="agent-chat-empty-mark">AI</span>
          <h3>和 Agent 说说要做什么</h3>
          <p>普通闲聊和咨询不会创建任务；明确的检查、修改或运行请求会进入可追踪的 Agent 执行。</p>
        </div>

        <template v-if="props.currentTask">
          <article class="agent-chat-message is-user">
            <span class="agent-chat-avatar">你</span>
            <div class="agent-chat-bubble">
              <header><strong>任务意图</strong><time>{{ props.currentTask.shortId || '' }}</time></header>
              <p>{{ props.currentTask.userOriginal || props.currentTask.detail || props.currentTask.title }}</p>
            </div>
          </article>

          <article v-if="!run" class="agent-chat-message is-agent">
            <span class="agent-chat-avatar">AI</span>
            <div class="agent-chat-bubble">
              <header><strong>Agent</strong></header>
              <p>任务已就绪。点击启动后，Agent 会读取任务定义和当前项目上下文。</p>
              <button class="btn btn-primary btn-sm" type="button" :disabled="props.busy || props.credentialStatus !== 'configured'" @click="startRun">启动任务</button>
            </div>
          </article>

          <article
            v-for="event in events"
            :key="event.sequence"
            class="agent-chat-message"
            :class="`is-${eventRole(event)}`"
          >
            <span class="agent-chat-avatar">{{ eventRole(event) === 'agent' ? 'AI' : '·' }}</span>
            <div class="agent-chat-bubble">
              <header>
                <strong>{{ eventRole(event) === 'approval' ? '审批' : eventRole(event) === 'system' ? '运行状态' : phaseLabel(event.phase) }}</strong>
                <time>{{ formatTime(event.at) }}</time>
              </header>
              <p>{{ event.summary }}</p>
            </div>
          </article>

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

          <details v-if="run?.status === 'failed' && runDiagnostics.length" class="agent-chat-diagnostics" open>
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

          <section v-if="outputRefs.length" class="agent-chat-outputs" aria-label="运行产物">
            <header><strong>运行产物</strong><small>{{ outputRefs.length }} 项 · 保存在本机</small></header>
            <div>
              <button
                v-for="(ref, index) in outputRefs"
                :key="ref"
                type="button"
                @click="emit('openOutput', ref, outputLabel(ref, index))"
              >
                <span>{{ run?.diff?.outputRef === ref ? 'DIFF' : 'LOG' }}</span>
                <strong>{{ outputLabel(ref, index) }}</strong>
                <small>打开 →</small>
              </button>
            </div>
          </section>

          <article v-if="run && !props.busy && !waiting && !isTerminal && run.resume?.kind !== 'blocked'" class="agent-chat-next-action">
            <div><strong>可以继续</strong><small>{{ run.nextAction || '从本地检查点推进下一步' }}</small></div>
            <button class="btn btn-primary btn-sm" type="button" @click="emit('advance', run.runId)">继续运行</button>
          </article>

          <article v-if="props.busy" class="agent-chat-thinking" role="status">
            <span><i /><i /><i /></span>
            <p>Agent 正在处理，新的进度会自动出现在这里。</p>
          </article>
        </template>

        <article
          v-for="message in props.localMessages"
          :key="message.id"
          class="agent-chat-message"
          :class="message.role === 'user' ? 'is-user' : 'is-agent'"
        >
          <span class="agent-chat-avatar">{{ message.role === 'user' ? '你' : 'AI' }}</span>
          <div class="agent-chat-bubble">
            <header><strong>{{ message.role === 'user' ? '你' : 'Agent' }}</strong><time>{{ formatTime(message.createdAt) }}</time></header>
              <p>{{ message.content }}</p>
          </div>
        </article>

        <article v-if="props.busy && !props.currentTask" class="agent-chat-thinking" role="status">
          <span><i /><i /><i /></span>
          <p>模型正在回复，对话会保存在本机。</p>
        </article>
      </div>

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
  min-height: 560px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: 0 18px 48px color-mix(in srgb, var(--shadow-color) 56%, transparent);
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
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface-soft) 45%, transparent), transparent 190px);
}

.agent-chat-header {
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
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--primary-soft) 64%, var(--surface) 36%);
  color: var(--muted);
  padding: 7px 18px;
  font-size: 10px;
}

.agent-chat-status:empty {
  display: none;
}

.agent-chat-diagnostics {
  margin: 0 37px 18px;
  border: 1px solid color-mix(in srgb, var(--danger) 38%, var(--border));
  border-radius: 9px;
  background: color-mix(in srgb, var(--danger) 5%, var(--surface-soft));
  padding: 11px 13px;
}

.agent-chat-diagnostics summary {
  cursor: pointer;
  color: var(--text);
  font-size: 11px;
  font-weight: 700;
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

.agent-chat-memory {
  width: min(760px, 94%);
  margin: 0 0 18px 37px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-soft) 76%, var(--primary-soft) 24%);
  padding: 11px 13px;
}

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
  min-height: 0;
  overflow-y: auto;
  padding: 24px max(20px, 7%);
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
  width: min(760px, 94%);
  margin-bottom: 15px;
}

.agent-chat-message.is-user {
  grid-template-columns: minmax(0, 1fr) 28px;
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
  border-color: color-mix(in srgb, var(--primary) 30%, var(--border));
  background: var(--primary-soft);
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
  border-radius: 10px;
  background: var(--surface-soft);
  padding: 11px 13px;
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

.agent-chat-approval,
.agent-chat-resume-blocked,
.agent-chat-outputs,
.agent-chat-next-action {
  width: min(760px, calc(100% - 37px));
  margin: 6px 0 16px 37px;
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
  border-color: color-mix(in srgb, var(--danger) 38%, var(--border));
  padding: 13px;
}

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

.agent-chat-composer {
  margin: 0 18px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--field-bg);
  box-shadow: 0 8px 28px color-mix(in srgb, var(--shadow-color) 35%, transparent);
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
  .agent-chat-outputs,
  .agent-chat-next-action,
  .agent-chat-memory {
    width: calc(100% - 37px);
  }

  .agent-chat-memory-body { grid-template-columns: 1fr; }

  .agent-chat-outputs > div {
    grid-template-columns: 1fr;
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
