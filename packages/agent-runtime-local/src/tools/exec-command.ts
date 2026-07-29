import { AgentCoreError, type JsonValue } from '@electron-manager/agent-core'
import type { ToolDescriptor, ToolModule } from '../tool-registry.js'
import { toolPromptCopy } from '@electron-manager/agent-prompts'
import { cliAvailability, commandEnvironment, processToolResult, type LocalRuntimeServices } from '../runtime-services.js'
import { compareGitWorktreeSnapshots } from '../command-evidence.js'
import { restrictedCommandArgs } from '../command-policy.js'

const promptCopy = toolPromptCopy('exec_command')

export const execCommandToolDescriptor: ToolDescriptor = {
      name: 'exec_command',
      version: '1.1.0',
      title: '运行验证命令',
      description: promptCopy.description,
      useWhen: promptCopy.useWhen,
      avoidWhen: promptCopy.avoidWhen,
      risk: 'process',
      riskCategory: 'process',
      baseRiskLevel: 'high',
      recovery: 'never_auto_replay',
      sideEffects: promptCopy.sideEffects,
      retryable: false,
      backends: [
        { id: 'pnpm-cli', kind: 'cli', command: 'pnpm' },
        { id: 'npm-cli', kind: 'cli', command: 'npm' },
      ],
      preferredBackendId: 'pnpm-cli',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', enum: ['pnpm', 'npm'] },
          args: { type: 'array', items: { type: 'string' } },
          cwd: { type: 'string', description: promptCopy.fields?.cwd },
          timeoutMs: { type: 'number', description: promptCopy.fields?.timeoutMs },
        },
        required: ['command', 'args'],
        additionalProperties: false,
      },
}

export function createExecCommandTool(services: LocalRuntimeServices): ToolModule {
  return {
    descriptor: execCommandToolDescriptor,
    async probe() {
      const backends = await Promise.all([
        services.probeCli('pnpm-cli', 'pnpm'),
        services.probeCli('npm-cli', 'npm'),
      ])
      return cliAvailability('exec_command', services.now(), backends)
    },
    prepareEffect(request) {
      services.assertDigest(request)
      const command = services.parseCommand(request.input)
      return {
        backend: `${command.command}-cli`,
        inputHash: request.actionDigest,
        expectedEffects: [],
      }
    },
    async execute(request, _context, signal) {
      const startedAt = services.now()
      services.assertDigest(request)
      const command = services.parseCommand(request.input)
      const cwd = await services.resolveDirectory(command.cwd)
      const executedArgs = restrictedCommandArgs(command)
      const before = await services.captureGitWorktree()
      let result
      try {
        result = await services.run(command.command, executedArgs, {
          cwd: cwd.absolutePath,
          timeoutMs: command.timeoutMs,
          env: commandEnvironment(),
          ...(signal ? { signal } : {}),
        })
      } catch (error) {
        const after = await services.captureGitWorktree()
        if (error instanceof AgentCoreError) {
          throw new AgentCoreError(error.code, error.message, {
            retryable: error.retryable,
            cause: error.cause,
            details: {
              ...error.details,
              actionDigest: request.actionDigest,
              commandPolicy: 'restricted-package-scripts-v2',
              repositoryEvidence: repositoryEvidenceJson(before, after),
            },
          })
        }
        throw error
      }
      const after = await services.captureGitWorktree()
      const toolResult = processToolResult(request, startedAt, services.now(), result, `Ran ${command.command} ${command.packageScript}`)
      toolResult.metadata = {
        actionDigest: request.actionDigest,
        command: command.command,
        args: command.args,
        executedArgs,
        cwd: cwd.relativePath,
        packageScript: command.packageScript,
        commandPolicy: 'restricted-package-scripts-v2',
        implicitLifecycleScripts: false,
        packageManagerOffline: true,
        repositoryEvidence: repositoryEvidenceJson(before, after),
        timeoutMs: command.timeoutMs,
        signal: result.signal,
        stdoutChars: result.stdoutChars,
        stderrChars: result.stderrChars,
      }
      return toolResult
    },
  }
}

function repositoryEvidenceJson(
  before: Awaited<ReturnType<LocalRuntimeServices['captureGitWorktree']>>,
  after: Awaited<ReturnType<LocalRuntimeServices['captureGitWorktree']>>,
) {
  return JSON.parse(JSON.stringify(compareGitWorktreeSnapshots(before, after))) as JsonValue
}
