import type { WorkLevel } from '@electron-manager/agent-core'
import {
  HeadlessAgentRunRepository,
  createHeadlessAgentRunner,
  type HeadlessAgentRunnerOptions,
} from '@electron-manager/agent-runner'

import type { DesktopAgentBackend } from './types.js'

export interface HeadlessDesktopStorageOptions {
  checkpointPath: string
  outputDirectory?: string
  maxOutputArtifactBytes?: number
}

export interface HeadlessDesktopAgentBackendOptions {
  storageFor(projectRoot: string): HeadlessDesktopStorageOptions | Promise<HeadlessDesktopStorageOptions>
  runnerOptionsFor(input: {
    projectRoot: string
    workLevel: WorkLevel
  }): Promise<Omit<
    HeadlessAgentRunnerOptions,
    | 'projectRoot'
    | 'workLevel'
    | 'checkpointPath'
    | 'outputDirectory'
    | 'maxOutputArtifactBytes'
    | 'onCommitted'
    | 'onPublishError'
  >> | Omit<
    HeadlessAgentRunnerOptions,
    | 'projectRoot'
    | 'workLevel'
    | 'checkpointPath'
    | 'outputDirectory'
    | 'maxOutputArtifactBytes'
    | 'onCommitted'
    | 'onPublishError'
  >
}

export function createHeadlessDesktopAgentBackend(options: HeadlessDesktopAgentBackendOptions): DesktopAgentBackend {
  return {
    async openRunner(input) {
      const [storage, configured] = await Promise.all([
        options.storageFor(input.projectRoot),
        options.runnerOptionsFor({ projectRoot: input.projectRoot, workLevel: input.workLevel }),
      ])
      return await createHeadlessAgentRunner({
        ...configured,
        ...storage,
        projectRoot: input.projectRoot,
        workLevel: input.workLevel,
        onCommitted: input.onCommitted,
        onPublishError: input.onPublishError,
      })
    },
    async openRepository(projectRoot) {
      return new HeadlessAgentRunRepository(await options.storageFor(projectRoot))
    },
  }
}
