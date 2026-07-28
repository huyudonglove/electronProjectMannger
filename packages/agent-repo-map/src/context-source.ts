import { AgentCoreError } from '@electron-manager/agent-core'
import type { ContextSource } from '@electron-manager/agent-context'

import type { CodeMapSnapshot, RepoMapSnapshot } from './types.js'

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
      priority: 60,
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

export function createCodeMapContextSource(
  snapshot: CodeMapSnapshot,
  maxTokens: number,
  additionalSourceRefs: string[] = [],
): ContextSource {
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
    throw new AgentCoreError('INVALID_INPUT', 'Code map context maxTokens must be a positive integer')
  }
  return {
    descriptor: {
      id: 'project.code-map', revision: snapshot.revision, region: 'recent_dynamic_context', scope: 'project',
      trust: 'untrusted', priority: 62, required: false, compressible: true, maxTokens,
    },
    collect: ({ ledger }) => [{
      id: `code-map-step-${ledger.stepCount}`,
      role: 'user',
      content: snapshot.content,
      sourceRefs: [`code-map:${snapshot.revision}`, ...additionalSourceRefs],
      sequence: ledger.stepCount * 1_000 + 150,
    }],
  }
}
