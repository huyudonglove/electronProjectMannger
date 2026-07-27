import type { ToolInventory } from './types.js'

export interface ToolRegistrySnapshotLike {
  revision: string
  tools: Array<{
    name: string
    descriptorRevision: string
    availability: {
      available: boolean
      selectedBackend?: string
      backends: Array<{ backendId: string; available: boolean }>
    }
  }>
}

export function toolInventoryFromRegistrySnapshot(snapshot: ToolRegistrySnapshotLike): ToolInventory {
  return {
    revision: snapshot.revision,
    tools: snapshot.tools.map((tool) => ({
      name: tool.name,
      descriptorRevision: tool.descriptorRevision,
      available: tool.availability.available,
      ...(tool.availability.selectedBackend ? { selectedBackend: tool.availability.selectedBackend } : {}),
      availableBackendIds: tool.availability.backends
        .filter((backend) => backend.available)
        .map((backend) => backend.backendId)
        .sort(),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  }
}
