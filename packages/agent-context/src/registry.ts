import { AgentCoreError } from '@electron-manager/agent-core'

import type { ContextSource, ContextSourceDescriptor, ContextSourceRegistryLike } from './types.js'

export class ContextSourceRegistry implements ContextSourceRegistryLike {
  readonly #sources = new Map<string, ContextSource>()

  constructor(sources: ContextSource[] = []) {
    for (const source of sources) this.register(source)
  }

  register(source: ContextSource) {
    validateDescriptor(source.descriptor)
    if (this.#sources.has(source.descriptor.id)) {
      throw new AgentCoreError('INVALID_INPUT', `Duplicate context source: ${source.descriptor.id}`)
    }
    this.#sources.set(source.descriptor.id, {
      descriptor: structuredClone(source.descriptor),
      collect: source.collect.bind(source),
    })
    return this
  }

  sources(): ContextSource[] {
    return [...this.#sources.values()]
      .sort((left, right) => left.descriptor.id.localeCompare(right.descriptor.id))
      .map((source) => ({
        descriptor: structuredClone(source.descriptor),
        collect: source.collect,
      }))
  }
}

function validateDescriptor(descriptor: ContextSourceDescriptor) {
  if (!descriptor.id.trim() || !descriptor.revision.trim()) {
    throw new AgentCoreError('INVALID_INPUT', 'Context source id and revision are required')
  }
  if (!Number.isInteger(descriptor.priority) || descriptor.priority < 0) {
    throw new AgentCoreError('INVALID_INPUT', `Context source priority must be a non-negative integer: ${descriptor.id}`)
  }
  if (!Number.isInteger(descriptor.maxTokens) || descriptor.maxTokens <= 0) {
    throw new AgentCoreError('INVALID_INPUT', `Context source maxTokens must be a positive integer: ${descriptor.id}`)
  }
  if (descriptor.region === 'newest_message' && (!descriptor.required || descriptor.compressible)) {
    throw new AgentCoreError('INVALID_INPUT', 'The newest_message source must be required and non-compressible')
  }
  if ((descriptor.region === 'stable_system_prefix' || descriptor.region === 'stable_capability_prefix') && descriptor.compressible) {
    throw new AgentCoreError('INVALID_INPUT', `Stable context source cannot be compressible: ${descriptor.id}`)
  }
}
