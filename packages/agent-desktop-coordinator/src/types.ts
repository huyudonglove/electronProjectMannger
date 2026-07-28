import type {
  AgentEvent,
  ApprovalResolution,
  LoadedCheckpoint,
  PersistedStepResult,
  RunCheckpointSummary,
  VerificationPlan,
  WorkLevel,
} from '@electron-manager/agent-core'
import type { StoredOutput } from '@electron-manager/agent-output'
import type { HeadlessAgentRunInput } from '@electron-manager/agent-runner'
import type { ProjectAdapterIssue } from '@electron-manager/agent-project-adapter'

export const DESKTOP_AGENT_SCHEMA_VERSION = 1 as const

export interface DesktopAgentRunner {
  createRun(input: HeadlessAgentRunInput): Promise<LoadedCheckpoint>
  advance(runId: string, signal?: AbortSignal): Promise<PersistedStepResult>
  runUntilPause(runId: string, signal?: AbortSignal): Promise<PersistedStepResult>
  resolveApproval(runId: string, resolution: ApprovalResolution, signal?: AbortSignal): Promise<PersistedStepResult>
  close(): void
}

export interface DesktopAgentRunRepository {
  load(runId: string): Promise<LoadedCheckpoint | null>
  list(): Promise<RunCheckpointSummary[]>
  readOutput(ref: string): Promise<StoredOutput>
  close(): void
}

export interface DesktopAgentBackend {
  openRunner(input: {
    projectRoot: string
    runId: string
    workLevel: WorkLevel
    onCommitted: (checkpoint: LoadedCheckpoint, events: AgentEvent[]) => void | Promise<void>
    onPublishError: (error: unknown, checkpoint: LoadedCheckpoint) => void | Promise<void>
  }): Promise<DesktopAgentRunner>
  openRepository(projectRoot: string): Promise<DesktopAgentRunRepository>
}

export interface StartProjectTaskRunInput {
  projectRoot: string
  taskId: string
  runId?: string
  intent?: 'change' | 'analysis'
  verificationPlan?: VerificationPlan
}

export interface AdvanceProjectRunInput {
  projectRoot: string
  runId: string
  untilPause?: boolean
  signal?: AbortSignal
}

export interface ResolveProjectRunApprovalInput {
  projectRoot: string
  runId: string
  decision: 'approved' | 'denied'
  reason?: string
  continueUntilPause?: boolean
  signal?: AbortSignal
}

export interface DesktopRunEvent {
  sequence: number
  at: string
  type: AgentEvent['type']
  phase: AgentEvent['phase']
  summary: string
}

export interface DesktopRunView {
  schemaVersion: typeof DESKTOP_AGENT_SCHEMA_VERSION
  runId: string
  projectRoot: string
  revision: number
  status: LoadedCheckpoint['snapshot']['ledger']['status']
  phase: LoadedCheckpoint['snapshot']['ledger']['phase']
  workLevel: WorkLevel
  intent: LoadedCheckpoint['snapshot']['ledger']['intent']
  objective: string
  task?: {
    id: string
    shortId: string
    title: string
    status: string
  }
  startedAt: string
  updatedAt: string
  committedAt: string
  stepCount: number
  eventSequence: number
  nextAction?: string
  resume: {
    kind: 'continue' | 'awaiting_approval' | 'replay' | 'reconcile' | 'blocked' | 'terminal'
    reason: string
  }
  waiting?: {
    id: string
    kind: 'plan_approval' | 'tool_approval' | 'user_input'
    summary: string
  }
  progress: {
    inspectedFiles: number
    changedFiles: string[]
    verificationPassed: number
    verificationFailed: number
    modelAttempts: number
  }
  memory: {
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
  diff?: {
    summary: string
    changedFiles: string[]
    outputRef?: string
  }
  outputRefs: string[]
  recordSync: 'not_required' | 'pending' | 'applied'
  logShortId?: string
}

export interface DesktopRunDetail {
  run: DesktopRunView
  events: DesktopRunEvent[]
}

export interface StartProjectTaskRunResult extends DesktopRunDetail {
  warnings: ProjectAdapterIssue[]
}

export interface DesktopRunNotification {
  projectRoot: string
  run: DesktopRunView
  events: DesktopRunEvent[]
}

export type DesktopRunListener = (notification: DesktopRunNotification) => void | Promise<void>
