import type { ToolDescriptor, ToolModule } from '../tool-registry.js'
import { cliAvailability, processToolResult, type LocalRuntimeServices } from '../runtime-services.js'

export const gitStatusToolDescriptor: ToolDescriptor = {
      name: 'git_status',
      version: '1.0.0',
      title: 'Git 状态',
      description: 'Read the current Git branch and concise working-tree status.',
      useWhen: 'Use to inspect the branch and dirty worktree before or after changes.',
      avoidWhen: 'Do not use as final diff evidence and never infer permission to modify Git state.',
      risk: 'read',
      riskCategory: 'read',
      baseRiskLevel: 'low',
      recovery: 'safe_replay',
      sideEffects: [],
      retryable: true,
      backends: [{ id: 'git-cli', kind: 'cli', command: 'git' }],
      preferredBackendId: 'git-cli',
      inputSchema: { type: 'object', additionalProperties: false },
}

export function createGitStatusTool(services: LocalRuntimeServices): ToolModule {
  return {
    descriptor: gitStatusToolDescriptor,
    async probe() {
      const backend = await services.probeCli('git-cli', 'git')
      return cliAvailability('git_status', services.now(), [backend])
    },
    async execute(request) {
      const startedAt = services.now()
      const resolved = await services.resolvePath()
      const result = await services.run('git', ['status', '--short', '--branch'], { cwd: resolved.projectRoot })
      return processToolResult(request, startedAt, services.now(), result, 'Read Git status')
    },
  }
}
