import type { ToolDescriptor, ToolModule } from '../tool-registry.js'
import { toolPromptCopy } from '@electron-manager/agent-prompts'
import { cliAvailability, processToolResult, type LocalRuntimeServices } from '../runtime-services.js'
import { optionalString } from '../tool-input.js'

const promptCopy = toolPromptCopy('list_files')

export const listFilesToolDescriptor: ToolDescriptor = {
      name: 'list_files',
      version: '1.0.0',
      title: '列出文件',
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
          path: { type: 'string', description: promptCopy.fields?.path },
          includeHidden: { type: 'boolean' },
        },
        additionalProperties: false,
      },
}

export function createListFilesTool(services: LocalRuntimeServices): ToolModule {
  return {
    descriptor: listFilesToolDescriptor,
    async probe() {
      const backend = await services.probeCli('rg-cli', 'rg')
      return cliAvailability('list_files', services.now(), [backend])
    },
    async execute(request) {
      const startedAt = services.now()
      const requestedPath = optionalString(request.input.path, '.')
      const resolved = await services.resolvePath(requestedPath)
      const args = ['--files']
      if (request.input.includeHidden === true) args.push('--hidden', '--glob', '!.git')
      if (resolved.relativePath !== '.') args.push(resolved.relativePath)
      const result = await services.run('rg', args, { cwd: resolved.projectRoot })
      return processToolResult(request, startedAt, services.now(), result, 'Listed project files')
    },
  }
}
