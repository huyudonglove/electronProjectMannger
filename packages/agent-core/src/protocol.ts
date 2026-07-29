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

export type AgentGraphNodeKind = 'entry' | 'work' | 'interrupt' | 'terminal'

export interface AgentGraphNode {
  id: RunPhase
  label: string
  kind: AgentGraphNodeKind
}

export interface AgentGraphEdge {
  from: RunPhase
  to: RunPhase
  guard?: string
}

export interface AgentGraphSpec {
  schemaVersion: 1
  revision: string
  entryNode: RunPhase
  nodes: readonly AgentGraphNode[]
  edges: readonly AgentGraphEdge[]
}

export interface AgentGraphTransition {
  sequence: number
  from: RunPhase
  to: RunPhase
  at: string
  reason?: string
}

export interface AgentGraphCursor {
  schemaVersion: 1
  graphRevision: string
  currentNode: RunPhase
  enteredAt: string
  visitCounts: Partial<Record<RunPhase, number>>
  history: AgentGraphTransition[]
}

export type WorkItemKind = 'inspect' | 'change' | 'verify'
export type WorkItemStatus = 'todo' | 'doing' | 'done' | 'blocked' | 'skipped'

export interface ProposedWorkItem {
  id: string
  title: string
  kind: WorkItemKind
  dependsOn?: string[]
}

export interface WorkItem extends ProposedWorkItem {
  status: WorkItemStatus
  dependsOn: string[]
  attempt: number
  createdAt: string
  updatedAt: string
  result?: string
  evidenceRefs?: string[]
  error?: string
}

export interface WorkChecklist {
  schemaVersion: 1
  revision: number
  planId?: string
  planSummary?: string
  items: WorkItem[]
  updatedAt: string
}

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
  | 'ACTION_DIGEST_MISMATCH'
  | 'COMMAND_NOT_ALLOWED'
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
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type ToolRecovery = 'safe_replay' | 'reconcile_then_resume' | 'never_auto_replay'

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
  kind: 'plan_approval' | 'tool_approval' | 'user_input'
  summary: string
  createdAt: string
  actionDigest?: string
  toolRequestId?: string
  approvalScope?: 'plan' | 'tool'
  resumePhase?: RunPhase
  verificationCheckId?: string
  checklistItemId?: string
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
  riskCategory?: ToolRisk
  baseRiskLevel?: ToolRiskLevel
  recovery?: ToolRecovery
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

export interface FileEffectExpectation {
  kind: 'file'
  path: string
  operation: 'create' | 'modify'
  beforeHash: string | null
  afterHash: string
}

export type EffectExpectation = FileEffectExpectation

export interface ToolEffectPlan {
  backend: string
  inputHash: string
  expectedEffects: EffectExpectation[]
}

export interface EffectReconcileResult {
  outcome: 'completed' | 'not_applied' | 'blocked'
  summary: string
  result?: ToolResult
}

export interface RuntimeToolSnapshot {
  schemaVersion: number
  revision: string
  data: Record<string, JsonValue>
}

export interface RuntimeContext {
  runId: string
  projectRoot: string
  permission: PermissionDecision
}

export interface AgentRuntime {
  execute(request: ToolRequest, context: RuntimeContext, signal?: AbortSignal): Promise<ToolResult>
  prepareEffect?(request: ToolRequest, context: RuntimeContext): ToolEffectPlan | Promise<ToolEffectPlan>
  reconcileEffect?(
    request: ToolRequest,
    expectedEffects: EffectExpectation[],
    context: RuntimeContext,
  ): EffectReconcileResult | Promise<EffectReconcileResult>
  snapshotTools?(): RuntimeToolSnapshot | Promise<RuntimeToolSnapshot>
}

export interface ModelCapabilityProfile {
  id: string
  supportsToolCalls: boolean
  supportsParallelToolCalls: boolean
  supportsStructuredOutput: boolean
  contextWindow: number
  maxOutputTokens: number
  promptCache: PromptCacheCapability
}

export type PromptCacheCapability = 'none' | 'implicit' | 'explicit'

export interface PromptCachePolicyTemplate {
  mode: 'none' | 'prefer' | 'require_explicit'
  promptProfileRevision: string
  toolRegistryRevision: string
  actionSchemaRevision: string
  projectRulesRevision: string
  privacyScopeRevision: string
}

export interface PromptCachePolicy extends PromptCachePolicyTemplate {
  stablePrefixRevision: string
}

export interface PromptCacheBinding {
  capability: PromptCacheCapability
  provider: string
  model: string
  profileRevision: string
  cacheKey?: string
}

export interface NormalizedUsage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolRequestId?: string
}

export interface ModelRequest {
  runId: string
  turnId: string
  contextRevision: string
  messages: ModelMessage[]
  tools: ToolDefinition[]
  maxOutputTokens: number
  allowedActions?: AgentTurnAction['kind'][]
  promptCache?: PromptCachePolicy
  promptCacheBinding?: PromptCacheBinding
}

export type NormalizedModelErrorCode =
  | 'rate_limit'
  | 'timeout'
  | 'service_unavailable'
  | 'transport'
  | 'invalid_output'
  | 'authentication'
  | 'permission'
  | 'invalid_request'
  | 'capability_mismatch'
  | 'budget_exhausted'
  | 'cancelled'
  | 'unknown'

export interface NormalizedProviderError {
  category: NormalizedModelErrorCode
  message: string
  retryable: boolean
  sourceCode?: string
  details?: Record<string, JsonValue>
}

export interface ModelAttemptRecord {
  id: string
  routeId: string
  routeRevision: string
  contextRevision: string
  attempt: number
  profileId: string
  profileRevision: string
  provider: string
  model: string
  startedAt: string
  completedAt: string
  outcome: 'succeeded' | 'failed' | 'cancelled'
  acceptedAction: boolean
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  cacheCapability?: PromptCacheCapability
  cacheKey?: string
  finishReason?: 'stop' | 'tool_calls' | 'length'
  error?: NormalizedProviderError
}

export interface ProposedAcceptanceEvidence {
  criterionId: string
  summary: string
  refs: string[]
}

export interface ProposedDiffSnapshot {
  toolRequestId: string
  changedFiles: string[]
  summary: string
}

export type AgentTurnAction =
  | { kind: 'inspect'; request: ToolRequest; workItemId?: string }
  | { kind: 'plan'; id: string; summary: string; rationale: string; actionDigest: string; steps?: ProposedWorkItem[] }
  | { kind: 'tool'; request: ToolRequest; workItemId?: string }
  | { kind: 'verify'; checkId: string; request: ToolRequest; workItemId?: string }
  | {
    kind: 'finish'
    summary: string
    acceptanceEvidence: ProposedAcceptanceEvidence[]
    diff?: ProposedDiffSnapshot
  }
  | { kind: 'blocked'; summary: string; reason: string }

export type ModelStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'action'; action: AgentTurnAction }
  | { type: 'tool_request'; request: ToolRequest }
  | ({ type: 'usage' } & NormalizedUsage)
  | { type: 'model_attempt'; attempt: ModelAttemptRecord }
  | { type: 'completed'; finishReason: 'stop' | 'tool_calls' | 'length' }
  | { type: 'error'; error: SerializedAgentError }

export interface ModelProvider {
  readonly profile: ModelCapabilityProfile
  stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelStreamEvent>
}

export interface AssembledModelContext {
  revision: string
  messages: ModelMessage[]
  snapshot?: ModelContextSnapshot
  compaction?: CompactionRecord
}

export interface ModelContextSnapshot {
  schemaVersion: number
  revision: string
  stablePrefixRevision: string
  estimatedInputTokens: number
  availableInputTokens: number
  sourceRevisions: Record<string, string>
  droppedFragments: number
  pressureLevel?: 'healthy' | 'warning' | 'compacted'
  compactionRevision?: string
  localArtifactCacheHit?: boolean
}

export interface ContextEnvelopeRecord extends ModelContextSnapshot {
  assembledAt: string
}

export interface SessionSummaryObservation {
  sourceId: string
  trust: 'trusted_system' | 'trusted_run' | 'trusted_project' | 'untrusted'
  sourceRefs: string[]
  excerpt: string
}

export interface SessionSummary {
  objective: string
  knownFacts: string[]
  decisions: string[]
  failures: string[]
  unresolved: string[]
  observations: SessionSummaryObservation[]
  sourceRefs: string[]
  nextAction?: string
}

export interface CompactionRecord {
  schemaVersion: 1
  id: string
  revision: string
  runId: string
  strategy: 'deterministic' | 'model'
  trigger: 'compact_threshold' | 'hard_stop'
  policyRevision: string
  beforeTokens: number
  afterTokens: number
  targetTokens: number
  warningTokens: number
  compactTokens: number
  hardStopTokens: number
  sourceHash: string
  sourceRefs: string[]
  replacedFragmentIds: string[]
  coveredFragmentIds: string[]
  retainedFragmentIds: string[]
  summaryFragmentId: string
  compactedHistoryRevision: string
  summary: SessionSummary
  createdAt: string
  fallbackReason?: string
}

export interface ModelContextAssembler {
  assemble(input: { runId: string; ledger: RunLedger; tools: ToolDefinition[] }): AssembledModelContext | Promise<AssembledModelContext>
}

export interface PermissionPolicy {
  decide(request: ToolRequest, tool: ToolDefinition, ledger: RunLedger): PermissionDecision | Promise<PermissionDecision>
}

export type AgentEventType =
  | 'run.started'
  | 'phase.changed'
  | 'plan.updated'
  | 'checklist.item.started'
  | 'checklist.item.completed'
  | 'checklist.item.failed'
  | 'model.started'
  | 'model.attempted'
  | 'model.completed'
  | 'model.rejected'
  | 'context.assembled'
  | 'context.compacted'
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
  schemaVersion: 1 | 2
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
  modelAttempts: ModelAttemptRecord[]
  contextEnvelopes: ContextEnvelopeRecord[]
  compactions: CompactionRecord[]
  graph?: AgentGraphCursor
  checklist?: WorkChecklist
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
