import { SqliteCheckpointStore } from '@electron-manager/agent-checkpoint-sqlite'
import {
  DEFAULT_MAX_OUTPUT_ARTIFACT_BYTES,
  LocalContentAddressedOutputStore,
} from '@electron-manager/agent-output'

import type { HeadlessAgentRunRepositoryOptions } from './types.js'

export class HeadlessAgentRunRepository {
  readonly #store: SqliteCheckpointStore
  readonly #outputStore: LocalContentAddressedOutputStore
  #closed = false

  constructor(options: HeadlessAgentRunRepositoryOptions) {
    if (!options.checkpointPath.trim()) throw new Error('Checkpoint path is required')
    this.#store = new SqliteCheckpointStore(options.checkpointPath)
    this.#outputStore = new LocalContentAddressedOutputStore(
      options.outputDirectory || `${options.checkpointPath}.outputs`,
      { maxArtifactBytes: options.maxOutputArtifactBytes ?? DEFAULT_MAX_OUTPUT_ARTIFACT_BYTES },
    )
  }

  async load(runId: string) {
    this.#assertOpen()
    return await this.#store.load(runId)
  }

  async list() {
    this.#assertOpen()
    return await this.#store.list()
  }

  async readOutput(ref: string) {
    this.#assertOpen()
    return await this.#outputStore.read(ref)
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    this.#store.close()
  }

  #assertOpen() {
    if (this.#closed) throw new Error('HeadlessAgentRunRepository is closed')
  }
}
