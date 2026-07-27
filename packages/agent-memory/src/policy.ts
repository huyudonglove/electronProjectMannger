import type { SessionCompactionPolicy } from './types.js'

export interface MemoryCompressionProfileLike {
  id: string
  revision: string
  compression: {
    warningTokens: number
    compactTokens: number
    targetTokens: number
    hardStopTokens: number
  }
}

export function sessionCompactionPolicyFromProfile(profile: MemoryCompressionProfileLike): SessionCompactionPolicy {
  return {
    revision: `${profile.id}@${profile.revision}`,
    warningTokens: profile.compression.warningTokens,
    compactTokens: profile.compression.compactTokens,
    targetTokens: profile.compression.targetTokens,
    hardStopTokens: profile.compression.hardStopTokens,
  }
}
