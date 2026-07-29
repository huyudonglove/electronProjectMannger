import { AGENT_GRAPH_REVISION, checklistProgress, decideResume, type AgentEvent, type LoadedCheckpoint } from '@electron-manager/agent-core'
import type { Dashboard } from '@electron-manager/project-core'

import {
  DESKTOP_AGENT_SCHEMA_VERSION,
  type DesktopRunDetail,
  type DesktopRunEvent,
  type DesktopRunView,
} from './types.js'

export function toDesktopRunDetail(checkpoint: LoadedCheckpoint, dashboard: Dashboard): DesktopRunDetail {
  return {
    run: toDesktopRunView(checkpoint, dashboard),
    events: checkpoint.events.map(toDesktopRunEvent),
  }
}

export function toDesktopRunView(checkpoint: LoadedCheckpoint, dashboard: Dashboard): DesktopRunView {
  const { snapshot } = checkpoint
  const ledger = snapshot.ledger
  const resume = decideResume(snapshot)
  const task = dashboard.tasks.find((item) => item.id === ledger.taskId || item.shortId === ledger.taskShortId)
  const log = dashboard.logs.find((item) => item.source === `agent-run:${ledger.runId}`)
  const outputRefs = unique([
    ledger.diffSnapshot?.outputRef || '',
    ...ledger.toolExecutions.map((execution) => execution.result?.outputRef || ''),
    ...ledger.verifications.map((verification) => verification.outputRef || ''),
  ])
  const changedFiles = unique(ledger.changes.map((change) => change.operation === 'rename' && change.previousPath
    ? `${change.previousPath} -> ${change.path}`
    : change.path))
  const requiresRecord = ledger.status === 'completed'
    || (['blocked', 'failed', 'cancelled'].includes(ledger.status) && ledger.changes.length > 0)
  const memoryData = record(snapshot.memorySnapshot?.data)
  const projectMemoryRevision = boundedString(memoryData?.projectMemoryRevision, 128)
  const hasProjectMemorySnapshot = Boolean(boundedString(memoryData?.projectMemorySnapshotRef, 256))
  const latestCompaction = ledger.compactions.at(-1)
  const diagnosticEvents = checkpoint.events.filter((event) => isDiagnosticEvent(event)).slice(-8).reverse()
  return {
    schemaVersion: DESKTOP_AGENT_SCHEMA_VERSION,
    runId: ledger.runId,
    projectRoot: ledger.projectRoot,
    revision: snapshot.revision,
    status: ledger.status,
    phase: ledger.phase,
    workLevel: ledger.workLevel,
    intent: ledger.intent,
    objective: ledger.objective,
    ...(task ? { task: { id: task.id, shortId: task.shortId, title: task.title, status: task.status } } : {}),
    startedAt: ledger.startedAt,
    updatedAt: ledger.updatedAt,
    committedAt: snapshot.committedAt,
    stepCount: ledger.stepCount,
    eventSequence: ledger.eventSequence,
    ...(ledger.nextAction ? { nextAction: ledger.nextAction } : {}),
    graph: {
      revision: ledger.graph?.graphRevision || AGENT_GRAPH_REVISION,
      currentNode: ledger.graph?.currentNode || ledger.phase,
      historyCount: ledger.graph?.history.length || 0,
    },
    checklist: {
      revision: ledger.checklist?.revision || 0,
      ...(ledger.checklist?.planId ? { planId: ledger.checklist.planId } : {}),
      ...(ledger.checklist?.planSummary ? { summary: ledger.checklist.planSummary } : {}),
      progress: checklistProgress(ledger.checklist),
      items: (ledger.checklist?.items || []).map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        status: item.status,
        dependsOn: [...item.dependsOn],
        attempt: item.attempt,
        ...(item.result ? { result: redact(item.result, 1_000) } : {}),
        ...(item.error ? { error: redact(item.error, 1_000) } : {}),
      })),
    },
    resume: { kind: resume.kind, reason: resume.reason },
    ...(ledger.pendingAction ? {
      waiting: {
        id: ledger.pendingAction.id,
        kind: ledger.pendingAction.kind,
        summary: ledger.pendingAction.summary,
      },
    } : {}),
    progress: {
      inspectedFiles: ledger.inspectedFiles.length,
      changedFiles,
      verificationPassed: ledger.verifications.filter((item) => item.status === 'passed').length,
      verificationFailed: ledger.verifications.filter((item) => item.status === 'failed').length,
      modelAttempts: ledger.modelAttempts.length,
    },
    diagnostics: {
      rejectedActions: checkpoint.events.filter((event) => event.type === 'model.rejected').length,
      failedModelAttempts: checkpoint.events.filter((event) => event.type === 'model.attempted' && event.payload?.outcome === 'failed').length,
      recentErrors: diagnosticEvents.map((event) => ({
        sequence: event.sequence,
        at: event.at,
        type: event.type,
        phase: event.phase,
        summary: redact(event.summary, 1_000),
        ...(typeof event.payload?.errorCategory === 'string' ? { errorCategory: redact(event.payload.errorCategory, 80) } : {}),
      })),
    },
    memory: {
      ...(projectMemoryRevision ? { projectMemoryRevision } : {}),
      hasProjectMemorySnapshot,
      compactions: {
        count: ledger.compactions.length,
        ...(latestCompaction ? {
          latest: {
            strategy: latestCompaction.strategy,
            trigger: latestCompaction.trigger,
            beforeTokens: latestCompaction.beforeTokens,
            afterTokens: latestCompaction.afterTokens,
            createdAt: boundedString(latestCompaction.createdAt, 64),
            summary: {
              knownFacts: latestCompaction.summary.knownFacts.length,
              decisions: latestCompaction.summary.decisions.length,
              failures: latestCompaction.summary.failures.length,
              unresolved: latestCompaction.summary.unresolved.length,
              observations: latestCompaction.summary.observations.length,
              sourceRefs: latestCompaction.summary.sourceRefs.length,
              hasNextAction: Boolean(latestCompaction.summary.nextAction),
            },
          },
        } : {}),
      },
    },
    ...(ledger.diffSnapshot ? {
      diff: {
        summary: ledger.diffSnapshot.summary,
        changedFiles: [...ledger.diffSnapshot.changedFiles],
        ...(ledger.diffSnapshot.outputRef ? { outputRef: ledger.diffSnapshot.outputRef } : {}),
      },
    } : {}),
    outputRefs,
    recordSync: log ? 'applied' : requiresRecord ? 'pending' : 'not_required',
    ...(log ? { logShortId: log.shortId } : {}),
  }
}

export function toDesktopRunEvent(event: AgentEvent): DesktopRunEvent {
  return {
    sequence: event.sequence,
    at: event.at,
    type: event.type,
    phase: event.phase,
    summary: event.summary,
    ...(event.payload ? { payload: sanitizePayload(event.payload) } : {}),
  }
}

function isDiagnosticEvent(event: AgentEvent) {
  if (['model.rejected', 'run.failed', 'run.blocked', 'run.cancelled'].includes(event.type)) return true
  if (event.type === 'model.attempted' && event.payload?.outcome === 'failed') return true
  if (event.type === 'verification.completed' && event.payload?.status === 'failed') return true
  return false
}

function sanitizePayload(payload: NonNullable<AgentEvent['payload']>) {
  return Object.fromEntries(Object.entries(payload).slice(0, 30).map(([key, value]) => [key, sanitizeJsonValue(value)]))
}

function sanitizeJsonValue(value: import('@electron-manager/agent-core').JsonValue): import('@electron-manager/agent-core').JsonValue {
  if (typeof value === 'string') return redact(value, 2_000)
  if (Array.isArray(value)) return value.slice(0, 40).map(sanitizeJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, sanitizeJsonValue(item)]))
  }
  return value
}

function redact(value: string, maxCharacters: number) {
  return value
    .replace(/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/gi, '[已隐藏私钥]')
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[已隐藏连接地址]')
    .replace(/(?:\/Users\/[^/\s]+|\/home\/[^/\s]+)(?:\/[^\s"'<>]*)?/g, '[已隐藏本机路径]')
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+(?:\\[^\s"'<>]*)?/g, '[已隐藏本机路径]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏密钥]')
    .replace(/\b(api[_ -]?key|authorization|bearer|password|secret|token)\s*[:=]\s*\S+/gi, '$1=[已隐藏敏感值]')
    .slice(0, maxCharacters)
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function boundedString(value: unknown, maxCharacters: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxCharacters) : ''
}
