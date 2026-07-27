import type { ToolDescriptor, ToolModule } from '../tool-registry.js'
import { cliAvailability, processToolResult, type LocalRuntimeServices } from '../runtime-services.js'
import { optionalString } from '../tool-input.js'

export const listFilesToolDescriptor: ToolDescriptor = {
      name: 'list_files',
      version: '1.0.0',
      title: '列出文件',
      description: 'List project files under a project-relative directory using ripgrep and project ignore rules.',
      useWhen: 'Use to discover project files quickly before choosing specific files to inspect.',
      avoidWhen: 'Do not use to read file contents or determine Git changes; use read_file or git_status instead.',
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
          path: { type: 'string', description: 'Project-relative directory. Defaults to the project root.' },
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
