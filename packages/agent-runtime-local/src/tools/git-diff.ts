import type { ToolDescriptor, ToolModule } from '../tool-registry.js'
import { toolPromptCopy } from '@electron-manager/agent-prompts'
import { cliAvailability, processToolResult, type LocalRuntimeServices } from '../runtime-services.js'
import { optionalStringArray } from '../tool-input.js'

const promptCopy = toolPromptCopy('git_diff')

export const gitDiffToolDescriptor: ToolDescriptor = {
      name: 'git_diff',
      version: '1.0.0',
      title: 'Git Diff',
      description: promptCopy.description,
      useWhen: promptCopy.useWhen,
      avoidWhen: promptCopy.avoidWhen,
      risk: 'read',
      riskCategory: 'read',
      baseRiskLevel: 'low',
      recovery: 'safe_replay',
      sideEffects: promptCopy.sideEffects,
      retryable: true,
      backends: [{ id: 'git-cli', kind: 'cli', command: 'git' }],
      preferredBackendId: 'git-cli',
      inputSchema: {
        type: 'object',
        properties: { paths: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
}

export function createGitDiffTool(services: LocalRuntimeServices): ToolModule {
  return {
    descriptor: gitDiffToolDescriptor,
    async probe() {
      const backend = await services.probeCli('git-cli', 'git')
      return cliAvailability('git_diff', services.now(), [backend])
    },
    async execute(request) {
      const startedAt = services.now()
      const resolved = await services.resolvePath()
      const relativePaths: string[] = []
      for (const requestedPath of optionalStringArray(request.input.paths, 'paths')) {
        relativePaths.push((await services.resolvePathCandidate(requestedPath)).relativePath)
      }
      const args = ['diff', '--no-ext-diff', '--unified=3']
      if (relativePaths.length) args.push('--', ...relativePaths)
      const result = await services.run('git', args, { cwd: resolved.projectRoot })
      return processToolResult(request, startedAt, services.now(), result, 'Read Git diff')
    },
  }
}
