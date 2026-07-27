import { AgentCoreError } from '@electron-manager/agent-core'
import type { ContextSource } from '@electron-manager/agent-context'

import type { RepoMapSnapshot } from './types.js'

export function createRepoMapContextSource(
  snapshot: RepoMapSnapshot,
  maxTokens: number,
  additionalSourceRefs: string[] = [],
): ContextSource {
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
    throw new AgentCoreError('INVALID_INPUT', 'Repo map context maxTokens must be a positive integer')
  }
  return {
    descriptor: {
      id: 'project.repo-map',
      revision: snapshot.revision,
      region: 'recent_dynamic_context',
      scope: 'project',
      trust: 'untrusted',
      priority: 80,
      required: false,
      compressible: true,
      maxTokens,
    },
    collect: ({ ledger }) => [{
      id: `repo-map-step-${ledger.stepCount}`,
      role: 'user',
      content: snapshot.content,
      sourceRefs: [`repo-map:${snapshot.revision}`, ...additionalSourceRefs],
      sequence: ledger.stepCount * 1_000 + 150,
    }],
  }
}
