import { createHash } from 'node:crypto'

import type { CodeMapSnapshot } from '@electron-manager/agent-repo-map'

import type { AgentChatConversation } from './agent-chat-store.js'

type DashboardLike = {
  tasks?: Array<Record<string, unknown>>
}

type RunLike = {
  runId: string
  status: string
  phase?: string
  objective?: string
  task?: { id?: string; shortId?: string; title?: string; status?: string }
  startedAt?: string
  updatedAt?: string
  stepCount?: number
  eventSequence?: number
  progress?: { changedFiles?: string[]; verificationPassed?: number; verificationFailed?: number }
  graph?: { revision?: string; currentNode?: string; historyCount?: number }
  checklist?: {
    revision?: number
    progress?: { total?: number; todo?: number; doing?: number; done?: number; blocked?: number; skipped?: number }
    items?: Array<{ id: string; title: string; kind: string; status: string; attempt?: number; result?: string; error?: string }>
  }
  diff?: { summary?: string; changedFiles?: string[] }
  logShortId?: string
  resume?: { reason?: string }
  diagnostics?: {
    rejectedActions?: number
    failedModelAttempts?: number
    recentErrors?: Array<{ sequence: number; at: string; type: string; phase: string; summary: string; errorCategory?: string }>
  }
}

export function projectMapsView(
  codeMap: CodeMapSnapshot,
  dashboard: DashboardLike,
  chats: AgentChatConversation[],
  runs: RunLike[],
) {
  const taskRuns = new Map<string, RunLike[]>()
  for (const run of runs) {
    for (const id of [run.task?.id, run.task?.shortId].filter((value): value is string => !!value)) {
      const values = taskRuns.get(id) || []
      if (!values.some((candidate) => candidate.runId === run.runId)) values.push(run)
      taskRuns.set(id, values)
    }
  }
  const tasks = (dashboard.tasks || []).map((task) => {
    const id = String(task.id || '')
    const shortId = String(task.shortId || '')
    const related = [...(taskRuns.get(id) || []), ...(taskRuns.get(shortId) || [])]
      .filter((run, index, values) => values.findIndex((candidate) => candidate.runId === run.runId) === index)
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
    return {
      taskId: id,
      shortId,
      title: String(task.title || ''),
      status: String(task.status || ''),
      rounds: related.map((run) => ({
        runId: run.runId,
        status: run.status,
        phase: run.phase,
        startedAt: run.startedAt,
        updatedAt: run.updatedAt,
        stepCount: run.stepCount || 0,
        eventCount: run.eventSequence || 0,
        changedFiles: run.progress?.changedFiles || run.diff?.changedFiles || [],
        verificationPassed: run.progress?.verificationPassed || 0,
        verificationFailed: run.progress?.verificationFailed || 0,
        graph: {
          revision: run.graph?.revision || '',
          currentNode: run.graph?.currentNode || run.phase || '',
          historyCount: run.graph?.historyCount || 0,
        },
        checklist: {
          revision: run.checklist?.revision || 0,
          progress: {
            total: run.checklist?.progress?.total || 0,
            todo: run.checklist?.progress?.todo || 0,
            doing: run.checklist?.progress?.doing || 0,
            done: run.checklist?.progress?.done || 0,
            blocked: run.checklist?.progress?.blocked || 0,
            skipped: run.checklist?.progress?.skipped || 0,
          },
          items: (run.checklist?.items || []).map((item) => ({
            id: item.id,
            title: item.title,
            kind: item.kind,
            status: item.status,
            attempt: item.attempt || 0,
            result: item.result || '',
            error: item.error || '',
          })),
        },
        result: run.diff?.summary || run.resume?.reason || '',
        logShortId: run.logShortId,
        diagnostics: {
          rejectedActions: run.diagnostics?.rejectedActions || 0,
          failedModelAttempts: run.diagnostics?.failedModelAttempts || 0,
          recentErrors: run.diagnostics?.recentErrors || [],
        },
      })),
    }
  })
  const taskMapStable = {
    tasks,
    conversations: chats.map((chat) => ({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt, messageCount: chat.messages.length })),
  }
  const revision = createHash('sha256').update(JSON.stringify(taskMapStable)).digest('hex')
  return {
    codeMap: {
      revision: codeMap.revision,
      generatedAt: codeMap.generatedAt,
      updatedAt: codeMap.updatedAt,
      ...codeMap.stats,
    },
    taskMap: {
      revision,
      updatedAt: latestTimestamp(tasks.flatMap((task) => task.rounds.map((round) => round.updatedAt)).concat(chats.map((chat) => chat.updatedAt))),
      taskCount: tasks.length,
      runCount: runs.length,
      conversationCount: chats.length,
      activeCount: tasks.filter((task) => ['todo', 'doing'].includes(task.status)).length,
      completedCount: tasks.filter((task) => task.status === 'done').length,
      tasks,
    },
  }
}

function latestTimestamp(values: Array<string | undefined>) {
  return values.filter((value): value is string => !!value).sort((left, right) => right.localeCompare(left))[0] || ''
}
