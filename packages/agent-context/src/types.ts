import type {
  AssembledModelContext,
  ModelContextAssembler,
  ModelMessage,
  RunLedger,
  ToolDefinition,
} from '@electron-manager/agent-core'

export const CONTEXT_ENVELOPE_SCHEMA_VERSION = 1 as const

export const CONTEXT_REGIONS = [
  'stable_system_prefix',
  'stable_capability_prefix',
  'compacted_history',
  'recent_dynamic_context',
  'newest_message',
] as const

export type ContextRegion = typeof CONTEXT_REGIONS[number]
export type ContextScope = 'system' | 'capability' | 'run' | 'session' | 'project' | 'user'
export type ContextTrust = 'trusted_system' | 'trusted_run' | 'trusted_project' | 'untrusted'

export interface ContextSourceDescriptor {
  id: string
  revision: string
  region: ContextRegion
  scope: ContextScope
  trust: ContextTrust
  priority: number
  required: boolean
  compressible: boolean
  maxTokens: number
}

export interface ContextFragment {
  id: string
  role: ModelMessage['role']
  content: string
  toolRequestId?: string
  sourceRefs: string[]
  sequence?: number
}

export interface ContextCollectionInput {
  runId: string
  ledger: RunLedger
  tools: ToolDefinition[]
}

export interface ContextSource {
  descriptor: ContextSourceDescriptor
  collect(input: ContextCollectionInput): ContextFragment[] | Promise<ContextFragment[]>
}

export interface ContextEntry extends ContextFragment {
  sourceId: string
  sourceRevision: string
  region: ContextRegion
  scope: ContextScope
  trust: ContextTrust
  priority: number
  required: boolean
  compressible: boolean
  maxTokens: number
  estimatedTokens: number
}

export interface ContextBudget {
  maxInputTokens: number
  reservedOutputTokens: number
  regionTokens: Record<ContextRegion, number>
}

export interface ContextDrop {
  sourceId: string
  fragmentId: string
  estimatedTokens: number
  reason: 'source_budget' | 'region_budget' | 'total_budget'
}

export interface ContextEnvelope extends AssembledModelContext {
  schemaVersion: typeof CONTEXT_ENVELOPE_SCHEMA_VERSION
  runId: string
  stablePrefixRevision: string
  regions: Record<ContextRegion, ContextEntry[]>
  budget: ContextBudget & {
    availableInputTokens: number
    usedInputTokens: number
    remainingInputTokens: number
  }
  dropped: ContextDrop[]
  snapshot: NonNullable<AssembledModelContext['snapshot']>
}

export interface TokenEstimator {
  estimate(text: string): number
}

export interface ContextSourceRegistryLike {
  sources(): ContextSource[]
}

export interface ContextAssemblerOptions {
  registry: ContextSourceRegistryLike
  budget: ContextBudget
  tokenEstimator?: TokenEstimator
}

export type CoreContextAssembler = ModelContextAssembler
