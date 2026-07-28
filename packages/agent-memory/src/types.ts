import type { NormalizedUsage, SessionSummary, SessionSummaryObservation } from '@electron-manager/agent-core'
import type { ContextCompactor, TokenEstimator } from '@electron-manager/agent-context'

export const SESSION_COMPACTION_SCHEMA_VERSION = 1 as const

export interface SessionCompactionPolicy {
  revision: string
  warningTokens: number
  compactTokens: number
  targetTokens: number
  hardStopTokens: number
}

export interface SessionCompactorOptions {
  policy: SessionCompactionPolicy
  tokenEstimator?: TokenEstimator
}

export interface SessionSummarizerInput {
  runId: string
  objective: string
  sourceRefs: string[]
  observations: SessionSummaryObservation[]
  deterministicSummary: SessionSummary
}

export interface SessionSummarizerResult {
  summary: SessionSummary
  routeId: string
  routeRevision: string
  attemptCount: number
  usage: NormalizedUsage
}

export interface SessionSummarizer {
  summarize(input: SessionSummarizerInput): Promise<SessionSummarizerResult>
}

export interface SessionSummarizerDiagnostic {
  runId: string
  outcome: 'succeeded' | 'fallback'
  routeId?: string
  routeRevision?: string
  attemptCount: number
  usage: NormalizedUsage
  reason?: string
}

export class SessionSummarizerError extends Error {
  readonly diagnostic: Omit<SessionSummarizerDiagnostic, 'runId' | 'outcome' | 'reason'>

  constructor(
    message: string,
    diagnostic: Omit<SessionSummarizerDiagnostic, 'runId' | 'outcome' | 'reason'>,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SessionSummarizerError'
    this.diagnostic = structuredClone(diagnostic)
  }
}

export interface ModelBackedSessionCompactorOptions extends SessionCompactorOptions {
  summarizer: SessionSummarizer
  onDiagnostic?: (diagnostic: SessionSummarizerDiagnostic) => void | Promise<void>
}

export type SessionContextCompactor = ContextCompactor
