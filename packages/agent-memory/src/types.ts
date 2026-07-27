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

export type SessionContextCompactor = ContextCompactor
