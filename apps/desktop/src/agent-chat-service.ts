import type { DesktopAgentConfigService } from '@electron-manager/agent-desktop-config'
import {
  ModelProviderRegistry,
  ModelRouter,
  type ModelRouteAttemptDiagnostic,
} from '@electron-manager/agent-model-router'
import {
  DESKTOP_CHAT_SYSTEM_PROMPT,
  renderReadonlyProjectOverviewPrompt,
} from '@electron-manager/agent-prompts'
import { getDashboard, type Dashboard } from '@electron-manager/project-core'

import { modelDiagnosticProjectKey, type ModelDiagnosticLog } from './model-diagnostics.js'
import { AgentChatStore, type AgentChatConversation } from './agent-chat-store.js'

type ChatModelProvider = Awaited<ReturnType<DesktopAgentConfigService['resolve']>>['providers'][number]['provider']

export class AgentChatService {
  readonly #store: AgentChatStore
  readonly #config: DesktopAgentConfigService
  readonly #diagnostics: ModelDiagnosticLog
  readonly #loadProjectOverview: (projectRoot: string) => Promise<unknown>

  constructor(options: {
    store: AgentChatStore
    config: DesktopAgentConfigService
    diagnostics: ModelDiagnosticLog
    managerDataRoot?: string
    loadProjectOverview?: (projectRoot: string) => Promise<unknown>
  }) {
    this.#store = options.store
    this.#config = options.config
    this.#diagnostics = options.diagnostics
    if (options.loadProjectOverview) this.#loadProjectOverview = options.loadProjectOverview
    else {
      if (!String(options.managerDataRoot || '').trim()) throw new Error('Manager data root is required for Agent Chat project context')
      this.#loadProjectOverview = async (projectRoot) => projectOverview(await getDashboard(options.managerDataRoot!, projectRoot))
    }
  }

  async list(projectRoot: string) {
    return await this.#store.list(projectRoot)
  }

  async send(input: { projectRoot: string; conversationId?: string; message: string }) {
    const saved = await this.#store.appendUser(input.projectRoot, input.conversationId, input.message)
    const runId = `chat:${saved.conversation.id}`
    const turnId = `${runId}:${saved.message.id}`
    let router: ModelRouter
    let overview: unknown
    try {
      const [resolved, loadedOverview] = await Promise.all([
        this.#config.resolve(input.projectRoot),
        this.#loadProjectOverview(input.projectRoot),
      ])
      const routeId = [...resolved.layers]
        .sort((left, right) => scopeRank(left.scope) - scopeRank(right.scope))
        .reduce((selected, layer) => layer.selections?.modelRouteId || selected, '')
      const route = resolved.catalog.modelRoutes.find((candidate) => candidate.id === routeId)
      if (!route) throw new Error(`Selected model route does not exist: ${routeId || 'none'}`)
      const chatProfileIds = [route.primaryProfileId, ...route.fallbackProfileIds]
      const registrations = chatProfileIds.map((profileId) => {
        const registration = resolved.providers.find((candidate) => candidate.profileId === profileId)
        if (!registration) throw new Error(`Selected model provider is unavailable: ${profileId}`)
        return registration
      })
      const profiles = chatProfileIds.map((profileId) => {
        const profile = resolved.catalog.modelProfiles.find((candidate) => candidate.id === profileId)
        if (!profile) throw new Error(`Selected model profile does not exist: ${profileId}`)
        return profile
      })
      const registry = new ModelProviderRegistry(registrations.map((registration, index) => ({
        profile: profiles[index]!,
        provider: finishOnlyProvider(registration.provider),
      })))
      router = new ModelRouter({
        route: { route, primary: profiles[0]!, fallbacks: profiles.slice(1) },
        registry,
        onAttempt: (diagnostic) => this.#recordRouteAttempt(input.projectRoot, diagnostic),
      })
      overview = loadedOverview
    } catch (error) {
      await this.#recordFailure({ projectRoot: input.projectRoot, runId, turnId, providerId: 'desktop-config', model: 'unknown', error })
      throw error
    }

    const answer = await requestFinishAnswer(router, saved.conversation, runId, turnId, overview)
    const conversation = await this.#store.appendAssistant(input.projectRoot, saved.conversation.id, answer)
    return { conversation }
  }

  async #recordFailure(input: {
    projectRoot: string
    runId: string
    turnId: string
    providerId: string
    model: string
    error: unknown
  }) {
    await this.#diagnostics.append({
      at: new Date().toISOString(),
      level: 'error',
      event: 'chat.request.failed',
      providerId: input.providerId,
      model: input.model,
      runId: input.runId,
      turnId: input.turnId,
      projectKey: modelDiagnosticProjectKey(input.projectRoot),
      error: safeErrorMessage(input.error),
    })
  }

  async #recordRouteAttempt(projectRoot: string, input: ModelRouteAttemptDiagnostic) {
    const attempt = input.attempt
    await this.#diagnostics.append({
      at: attempt.completedAt,
      level: attempt.outcome === 'succeeded' ? 'info' : 'error',
      event: `route.attempt.${attempt.outcome}`,
      providerId: attempt.provider,
      model: attempt.model,
      runId: input.runId,
      turnId: input.turnId,
      projectKey: modelDiagnosticProjectKey(projectRoot),
      routeId: attempt.routeId,
      profileId: attempt.profileId,
      attempt: attempt.attempt,
      order: input.order,
      result: attempt.outcome,
      ...(attempt.error ? {
        errorCategory: attempt.error.category,
        error: attempt.error.message,
      } : {}),
    })
  }
}

async function requestFinishAnswer(
  provider: ModelRouter,
  conversation: AgentChatConversation,
  runId: string,
  turnId: string,
  projectOverview: unknown,
) {
  let answer = ''
  let completed = false
  const messages = boundedMessages(conversation)
  for await (const event of provider.stream({
    runId,
    turnId,
    contextRevision: `${conversation.id}:${conversation.updatedAt}`,
    messages: [
      { role: 'system', content: DESKTOP_CHAT_SYSTEM_PROMPT.text },
      { role: 'system', content: renderReadonlyProjectOverviewPrompt(JSON.stringify(projectOverview)) },
      ...messages,
    ],
    tools: [],
    maxOutputTokens: Math.min(4_096, provider.profile.maxOutputTokens),
  })) {
    if (event.type === 'action') {
      if (answer) throw new Error('Chat model returned more than one action')
      if (event.action.kind !== 'finish') throw new Error(`Chat model returned unsupported ${event.action.kind} action`)
      answer = event.action.summary.trim()
    } else if (event.type === 'error') {
      throw new Error(event.error.message)
    } else if (event.type === 'completed') {
      completed = true
    }
  }
  if (!completed) throw new Error('Chat model response ended without completion')
  if (!answer) throw new Error('Chat model returned an empty answer')
  return answer
}

function finishOnlyProvider(provider: ChatModelProvider): ChatModelProvider {
  return {
    profile: provider.profile,
    async *stream(request, signal) {
      for await (const event of provider.stream(request, signal)) {
        if (event.type === 'action' && event.action.kind !== 'finish') {
          yield {
            type: 'error',
            error: {
              code: 'MODEL_ERROR',
              message: `Chat model returned unsupported ${event.action.kind} action`,
              retryable: true,
              details: { modelErrorCategory: 'invalid_output' },
            },
          }
          return
        }
        yield event
      }
    },
  }
}

export function projectOverview(dashboard: Dashboard) {
  return {
    projectName: boundedText(dashboard.config.name, 160),
    currentVersion: dashboard.currentVersion ? {
      shortId: dashboard.currentVersion.shortId,
      label: boundedText(dashboard.currentVersion.label, 80),
      title: boundedText(dashboard.currentVersion.title, 200),
      status: dashboard.currentVersion.status,
      goal: boundedText(dashboard.currentVersion.goal, 500),
      summary: boundedText(dashboard.currentVersion.summary, 500),
    } : null,
    activeTasks: dashboard.activeTasks.slice(0, 24).map((task) => ({
      shortId: task.shortId,
      title: boundedText(task.title, 240),
      status: task.status,
      priority: task.priority,
      workLevel: task.workLevel,
      area: boundedText(task.area, 120),
    })),
    activeResearch: dashboard.activeResearch.slice(0, 12).map((research) => ({
      shortId: research.shortId,
      title: boundedText(research.title, 240),
      status: research.status,
      mode: research.mode,
    })),
    openQuestions: dashboard.openQuestions.slice(0, 12).map((question) => ({
      shortId: question.shortId,
      title: boundedText(question.title, 240),
      question: boundedText(question.question, 500),
      kind: question.kind,
      blocking: question.blocking,
    })),
    activeRisks: dashboard.agentBrief.activeRisks.slice(0, 12).map((risk) => ({
      shortId: risk.shortId,
      title: boundedText(risk.title, 240),
      kind: risk.kind,
      status: risk.status,
    })),
    latestLogs: dashboard.latestLogs.slice(0, 12).map((log) => boundedText(log, 500)),
  }
}

function boundedMessages(conversation: AgentChatConversation) {
  const selected: AgentChatConversation['messages'] = []
  let characters = 0
  for (let index = conversation.messages.length - 1; index >= 0 && selected.length < 30; index -= 1) {
    const message = conversation.messages[index]!
    if (selected.length && characters + message.content.length > 40_000) break
    selected.unshift(message)
    characters += message.content.length
  }
  return selected.map((message) => ({ role: message.role, content: message.content }))
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Unknown model error')
}

function boundedText(value: unknown, length: number) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, length)
}

function scopeRank(scope: 'built_in' | 'user' | 'project' | 'run') {
  return scope === 'built_in' ? 0 : scope === 'user' ? 1 : scope === 'project' ? 2 : 3
}
