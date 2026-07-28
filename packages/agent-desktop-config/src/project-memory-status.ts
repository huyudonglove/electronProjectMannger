import type { AgentConfigCatalog, AgentConfigLayer, MemoryProfile } from '@electron-manager/agent-config'
import type { ProjectMemoryDocument } from '@electron-manager/agent-memory'

import type { DesktopProjectMemoryStatusView } from './types.js'

export function desktopProjectMemoryStatus(input: {
  catalog: AgentConfigCatalog
  layers: AgentConfigLayer[]
  documents: ProjectMemoryDocument[]
}): DesktopProjectMemoryStatusView {
  const profile = selectedMemoryProfile(input.catalog, input.layers)
  const documents = input.documents.slice(0, 128)
  return {
    enabled: profile.mode !== 'minimal',
    profile: {
      id: profile.id.trim().slice(0, 128),
      revision: profile.revision.trim().slice(0, 128),
      mode: profile.mode,
      sourceBudgets: { ...profile.sourceBudgets },
    },
    sources: {
      total: documents.length,
      byKind: {
        constraints: documents.filter((document) => document.id.startsWith('constraint:')).length,
        documents: documents.filter((document) => document.id.startsWith('document:')).length,
        knowledge: documents.filter((document) => document.id.startsWith('knowledge:')).length,
      },
      byTrust: {
        trustedProject: documents.filter((document) => document.trust === 'trusted_project').length,
        untrusted: documents.filter((document) => document.trust === 'untrusted').length,
      },
    },
  }
}

function selectedMemoryProfile(catalog: AgentConfigCatalog, layers: AgentConfigLayer[]): MemoryProfile {
  const profileId = [...layers]
    .sort((left, right) => scopeRank(left.scope) - scopeRank(right.scope))
    .reduce((selected, layer) => layer.selections?.memoryProfileId || selected, '')
  const profile = catalog.memoryProfiles.find((candidate) => candidate.id === profileId)
  if (!profile) throw new Error(`Selected memory profile does not exist: ${profileId || 'none'}`)
  return profile
}

function scopeRank(scope: AgentConfigLayer['scope']) {
  return scope === 'built_in' ? 0 : scope === 'user' ? 1 : scope === 'project' ? 2 : 3
}
