import type { TokenEstimator } from './types.js'

export class DeterministicTokenEstimator implements TokenEstimator {
  estimate(text: string): number {
    if (!text.length) return 0
    return Math.max(1, Math.ceil(new TextEncoder().encode(text).length / 4))
  }
}
