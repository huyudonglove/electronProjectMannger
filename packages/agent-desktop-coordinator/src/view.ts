import { decideResume, type AgentEvent, type LoadedCheckpoint } from '@electron-manager/agent-core'
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
  }
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
