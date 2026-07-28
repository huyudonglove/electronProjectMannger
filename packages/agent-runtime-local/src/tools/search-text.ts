import type { ToolDescriptor, ToolModule } from '../tool-registry.js'
import { toolPromptCopy } from '@electron-manager/agent-prompts'
import { cliAvailability, processToolResult, type LocalRuntimeServices } from '../runtime-services.js'
import { optionalString, optionalStringArray, requiredString } from '../tool-input.js'

const promptCopy = toolPromptCopy('search_text')

export const searchTextToolDescriptor: ToolDescriptor = {
      name: 'search_text',
      version: '1.0.0',
      title: '搜索文本',
      description: promptCopy.description,
      useWhen: promptCopy.useWhen,
      avoidWhen: promptCopy.avoidWhen,
      risk: 'read',
      riskCategory: 'read',
      baseRiskLevel: 'low',
      recovery: 'safe_replay',
      sideEffects: promptCopy.sideEffects,
      retryable: true,
      backends: [{ id: 'rg-cli', kind: 'cli', command: 'rg' }],
      preferredBackendId: 'rg-cli',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          path: { type: 'string' },
          globs: { type: 'array', items: { type: 'string' } },
        },
        required: ['query'],
        additionalProperties: false,
      },
}

export function createSearchTextTool(services: LocalRuntimeServices): ToolModule {
  return {
    descriptor: searchTextToolDescriptor,
    async probe() {
      const backend = await services.probeCli('rg-cli', 'rg')
      return cliAvailability('search_text', services.now(), [backend])
    },
    async execute(request) {
      const startedAt = services.now()
      const query = requiredString(request.input.query, 'query')
      const requestedPath = optionalString(request.input.path, '.')
      const resolved = await services.resolvePath(requestedPath)
      const args = ['--line-number', '--column', '--no-heading', '--color', 'never']
      for (const glob of optionalStringArray(request.input.globs, 'globs')) args.push('--glob', glob)
      args.push('--', query, resolved.relativePath)
      const result = await services.run('rg', args, { cwd: resolved.projectRoot })
      const noMatches = result.exitCode === 1
      if (noMatches) result.exitCode = 0
      return processToolResult(request, startedAt, services.now(), result, noMatches ? 'No matches found' : 'Search completed')
    },
  }
}
