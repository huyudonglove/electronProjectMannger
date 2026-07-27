import type { ToolDescriptor, ToolModule } from '../tool-registry.js'
import { cliAvailability, commandEnvironment, processToolResult, type LocalRuntimeServices } from '../runtime-services.js'

export const execCommandToolDescriptor: ToolDescriptor = {
      name: 'exec_command',
      version: '1.0.0',
      title: '运行验证命令',
      description: 'Run an approved repository-defined package verification script without an outer shell. Scripts may have project-local side effects and must be followed by Git inspection.',
      useWhen: 'Use for an existing allowlisted package verification script after code changes.',
      avoidWhen: 'Do not use for arbitrary shell, dependency installation, network tools, Git writes, or forwarded script arguments.',
      risk: 'process',
      riskCategory: 'process',
      baseRiskLevel: 'high',
      recovery: 'never_auto_replay',
      sideEffects: ['Starts a project process', 'The project script may modify project-local files'],
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
          cwd: { type: 'string', description: 'Existing project-relative directory. Defaults to the project root.' },
          timeoutMs: { type: 'number', description: 'Positive timeout bounded by the runtime maximum.' },
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
      const result = await services.run(command.command, command.args, {
        cwd: cwd.absolutePath,
        timeoutMs: command.timeoutMs,
        env: commandEnvironment(),
        ...(signal ? { signal } : {}),
      })
      const toolResult = processToolResult(request, startedAt, services.now(), result, `Ran ${command.command} ${command.packageScript}`)
      toolResult.metadata = {
        command: command.command,
        args: command.args,
        cwd: cwd.relativePath,
        packageScript: command.packageScript,
        timeoutMs: command.timeoutMs,
        signal: result.signal,
        stdoutChars: result.stdoutChars,
        stderrChars: result.stderrChars,
      }
      return toolResult
    },
  }
}
