import type { ToolDescriptor, ToolModule } from '../tool-registry.js'
import { cliAvailability, processToolResult, type LocalRuntimeServices } from '../runtime-services.js'
import { optionalString, optionalStringArray, requiredString } from '../tool-input.js'

export const searchTextToolDescriptor: ToolDescriptor = {
      name: 'search_text',
      version: '1.0.0',
      title: '搜索文本',
      description: 'Search text with ripgrep inside a project-relative path.',
      useWhen: 'Use to find exact text or regular-expression matches across project files.',
      avoidWhen: 'Do not use for semantic symbol analysis or file modification.',
      risk: 'read',
      riskCategory: 'read',
      baseRiskLevel: 'low',
      recovery: 'safe_replay',
      sideEffects: [],
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
