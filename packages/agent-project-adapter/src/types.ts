import type {
  AgentRunInput,
  RunIntent,
  RunLedger,
  VerificationPlan,
  WorkLevel,
} from '@electron-manager/agent-core'
import type { ProjectLogLevel } from '@electron-manager/project-core'

export const PROJECT_ADAPTER_SCHEMA_VERSION = 1 as const

export type ProjectAgentRunInput = Omit<AgentRunInput, 'projectRoot' | 'workLevel' | 'limits'>

export type ProjectAdapterIssueCode =
  | 'INVALID_RUN_ID'
  | 'TASK_NOT_FOUND'
  | 'TASK_NOT_ACTIVE'
  | 'TASK_VERSION_MISMATCH'
  | 'BLOCKING_QUESTION'
  | 'MISSING_EXECUTION_DEFINITION'
  | 'MISSING_ACCEPTANCE'
  | 'DEEP_METADATA_MISSING'
  | 'INVALID_VERIFICATION'
  | 'VERIFICATION_NOT_CONFIGURED'
  | 'RUN_NOT_TERMINAL'
  | 'RUN_NOT_COMPLETED'
  | 'RUN_TASK_MISMATCH'
  | 'RUN_WORK_LEVEL_MISMATCH'
  | 'RUN_COMPLETION_INVALID'

export interface ProjectAdapterIssue {
  code: ProjectAdapterIssueCode
  severity: 'error' | 'warning'
  field: string
  message: string
  refs?: string[]
}

export type ProjectAdapterResult<T> =
  | { ok: true; value: T; warnings: ProjectAdapterIssue[] }
  | { ok: false; issues: ProjectAdapterIssue[] }

export interface PrepareProjectRunInput {
  runId: string
  taskId: string
  intent?: RunIntent
  verificationPlan?: VerificationPlan
}

export interface ProjectTaskStatusUpdate {
  taskId: string
  taskShortId: string
  expectedStatus: string
  expectedUpdated: string
  nextStatus: 'doing' | 'done'
}

export interface PreparedProjectRun {
  schemaVersion: typeof PROJECT_ADAPTER_SCHEMA_VERSION
  projectRoot: string
  workLevel: WorkLevel
  runInput: ProjectAgentRunInput
  startUpdate?: ProjectTaskStatusUpdate
  sourceRefs: string[]
}

export interface ProjectCompletionInput {
  taskId: string
  ledger: RunLedger
}

export interface ProjectLogDraft {
  source: string
  title: string
  taskId: string
  taskShortId: string
  version: string
  recordLevel: ProjectLogLevel
  result: string[]
  changedFiles: string[]
  verification: string[]
  decisions: string[]
  outputRefs: string[]
}

export interface ProjectRunUpdatePlan {
  schemaVersion: typeof PROJECT_ADAPTER_SCHEMA_VERSION
  outcome: 'ready' | 'already_applied' | 'not_required'
  idempotencyKey: string
  source: string
  runId: string
  taskId: string
  taskShortId: string
  taskStatusUpdate?: ProjectTaskStatusUpdate
  log?: ProjectLogDraft
  existingLogShortId?: string
}
