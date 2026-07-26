export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type WorkLevel = 'light' | 'standard' | 'deep'
export type RunIntent = 'change' | 'analysis'
export type RunStatus = 'running' | 'awaiting_approval' | 'completed' | 'blocked' | 'failed' | 'cancelled'
export type RunPhase =
  | 'created'
  | 'loading_context'
  | 'inspecting'
  | 'planning'
  | 'acting'
  | 'awaiting_approval'
  | 'verifying'
  | 'repairing'
  | 'finalizing'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled'

export type AgentErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_TRANSITION'
  | 'PATH_OUTSIDE_PROJECT'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_EXECUTION_FAILED'
  | 'TOOL_TIMEOUT'
  | 'PATCH_CONFLICT'
  | 'PERMISSION_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'LIMIT_EXCEEDED'
  | 'CONTEXT_BUDGET_EXCEEDED'
  | 'REPEATED_FAILURE'
  | 'VERIFICATION_FAILED'
  | 'CHECKPOINT_ERROR'
  | 'MODEL_ERROR'
  | 'CANCELLED'
  | 'INTERNAL_ERROR'

export interface SerializedAgentError {
  code: AgentErrorCode
  message: string
  retryable: boolean
  details?: Record<string, JsonValue>
  cause?: string
}

export interface AcceptanceCriterion {
  id: string
  description: string
  required?: boolean
}

export interface VerificationSpec {
  id: string
  label: string
  required?: boolean
  command?: string[]
  timeoutMs?: number
}

export interface VerificationPlan {
  checks: VerificationSpec[]
}

export interface RunLimits {
  maxSteps: number
  maxDurationMs: number
  maxInputTokens: number
  maxOutputTokens: number
  maxRepeatedFailures: number
}

export interface AgentRunInput {
  runId: string
  projectRoot: string
  goal: string
  acceptanceCriteria: AcceptanceCriterion[]
  constraints: string[]
  workLevel: WorkLevel
  intent: RunIntent
  verificationPlan: VerificationPlan
  limits: RunLimits
  taskId?: string
  taskShortId?: string
  metadata?: Record<string, JsonValue>
}

export interface VerificationResult {
  checkId: string
  status: 'passed' | 'failed' | 'skipped'
  summary: string
  startedAt: string
  completedAt: string
  exitCode?: number
  outputRef?: string
}

export interface ChangedFileRecord {
  path: string
  operation: 'create' | 'modify' | 'delete' | 'rename'
  at: string
  beforeHash?: string
  afterHash?: string
  previousPath?: string
}

export interface DiffSnapshot {
  capturedAt: string
  changedFiles: string[]
  summary: string
  outputRef?: string
}

export interface AcceptanceEvidence {
  criterionId: string
  summary: string
  passed: boolean
  at: string
  refs?: string[]
}

export interface InspectionRecord {
  path: string
  hash: string
  reason: string
  inspectedAt: string
}

export interface DecisionRecord {
  id: string
  summary: string
  rationale: string
  at: string
}

export type PermissionEffect = 'allow' | 'ask' | 'deny'
export type ToolRisk = 'read' | 'project_write' | 'process' | 'network' | 'external_write' | 'git_remote' | 'destructive'

export interface PermissionDecision {
  effect: PermissionEffect
  reason: string
  matchedRuleId?: string
}

export interface ApprovalRecord {
  actionDigest: string
  scope: string
  decision: 'approved' | 'denied'
  decidedAt: string
  expiresAt?: string
  reason?: string
}

export interface PendingAction {
  id: string
  kind: 'tool_approval' | 'user_input'
  summary: string
  createdAt: string
  actionDigest?: string
  toolRequestId?: string
}

export interface JsonSchema {
  type?: string | string[]
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: JsonPrimitive[]
  additionalProperties?: boolean | JsonSchema
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: JsonSchema
  risk: ToolRisk
}

export interface ToolRequest {
  id: string
  name: string
  input: Record<string, JsonValue>
  requestedAt: string
  actionDigest: string
}

export interface ToolResult {
  requestId: string
  ok: boolean
  summary: string
  startedAt: string
  completedAt: string
  output?: string
  outputRef?: string
  exitCode?: number
  changedPaths?: string[]
  truncated?: boolean
  error?: SerializedAgentError
  metadata?: Record<string, JsonValue>
}

export interface ToolExecutionRecord {
  request: ToolRequest
  result?: ToolResult
}

export interface RuntimeContext {
  runId: string
  projectRoot: string
  permission: PermissionDecision
}

export interface AgentRuntime {
  execute(request: ToolRequest, context: RuntimeContext, signal?: AbortSignal): Promise<ToolResult>
}

export interface ModelCapabilityProfile {
  id: string
  supportsToolCalls: boolean
  supportsParallelToolCalls: boolean
  supportsStructuredOutput: boolean
  contextWindow: number
  maxOutputTokens: number
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolRequestId?: string
}

export interface ModelRequest {
  runId: string
  messages: ModelMessage[]
  tools: ToolDefinition[]
  maxOutputTokens: number
}

export type ModelStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_request'; request: ToolRequest }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'completed'; finishReason: 'stop' | 'tool_calls' | 'length' }
  | { type: 'error'; error: SerializedAgentError }

export interface ModelProvider {
  readonly profile: ModelCapabilityProfile
  stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelStreamEvent>
}

export type AgentEventType =
  | 'run.started'
  | 'phase.changed'
  | 'model.started'
  | 'model.completed'
  | 'tool.requested'
  | 'tool.completed'
  | 'approval.requested'
  | 'approval.completed'
  | 'files.changed'
  | 'verification.completed'
  | 'run.completed'
  | 'run.blocked'
  | 'run.failed'
  | 'run.cancelled'

export interface AgentEvent {
  id: string
  runId: string
  sequence: number
  at: string
  type: AgentEventType
  phase: RunPhase
  summary: string
  payload?: Record<string, JsonValue>
}

export interface SequencedAgentEvent {
  ledger: RunLedger
  event: AgentEvent
}

export interface FailureRecord {
  fingerprint: string
  toolRequestId: string
  error: SerializedAgentError
  at: string
}

export interface RunLedger {
  schemaVersion: 1
  runId: string
  taskId?: string
  taskShortId?: string
  projectRoot: string
  objective: string
  constraints: string[]
  workLevel: WorkLevel
  intent: RunIntent
  acceptanceCriteria: AcceptanceCriterion[]
  verificationPlan: VerificationPlan
  limits: RunLimits
  phase: RunPhase
  status: RunStatus
  startedAt: string
  updatedAt: string
  eventSequence: number
  stepCount: number
  inspectedFiles: InspectionRecord[]
  decisions: DecisionRecord[]
  toolExecutions: ToolExecutionRecord[]
  changes: ChangedFileRecord[]
  acceptanceEvidence: AcceptanceEvidence[]
  verifications: VerificationResult[]
  approvals: ApprovalRecord[]
  failures: FailureRecord[]
  pendingAction?: PendingAction
  nextAction?: string
  diffSnapshot?: DiffSnapshot
  metadata?: Record<string, JsonValue>
}

export interface AgentRunResult {
  runId: string
  status: Extract<RunStatus, 'completed' | 'blocked' | 'failed' | 'cancelled'>
  summary: string
  changedFiles: ChangedFileRecord[]
  verifications: VerificationResult[]
  completedAt: string
  error?: SerializedAgentError
}
