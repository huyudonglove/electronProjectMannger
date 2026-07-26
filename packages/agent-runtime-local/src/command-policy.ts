import { AgentCoreError, type JsonValue } from '@electron-manager/agent-core'

const DEFAULT_PACKAGE_SCRIPTS = ['build', 'check', 'lint', 'test', 'typecheck']
const PNPM_FLAG_WITH_VALUE = new Set(['--filter', '-F'])
const PNPM_FLAG_WITHOUT_VALUE = new Set(['--recursive', '-r', '--workspace-root', '-w', '--if-present', '--aggregate-output', '--stream'])
const NPM_FLAG_WITH_VALUE = new Set(['--workspace', '-w'])
const NPM_FLAG_WITHOUT_VALUE = new Set(['--workspaces', '--if-present'])

export interface RestrictedCommand {
  command: 'pnpm' | 'npm'
  args: string[]
  cwd: string
  timeoutMs: number
  packageScript: string
}

export interface ParseRestrictedCommandOptions {
  defaultTimeoutMs: number
  maxTimeoutMs: number
  allowedPackageScripts?: string[]
}

export function parseRestrictedCommand(
  input: Record<string, JsonValue>,
  options: ParseRestrictedCommandOptions,
): RestrictedCommand {
  const command = stringInput(input.command, 'command')
  const args = stringArrayInput(input.args, 'args')
  const cwd = optionalStringInput(input.cwd, '.')
  const timeoutMs = optionalTimeout(input.timeoutMs, options.defaultTimeoutMs, options.maxTimeoutMs)
  if (command !== 'pnpm' && command !== 'npm') {
    throw commandDenied(`Executable is not allowed: ${command}`)
  }
  if (args.length > 100 || args.reduce((total, arg) => total + arg.length, 0) > 20_000) {
    throw new AgentCoreError('LIMIT_EXCEEDED', 'Command arguments exceed the runtime limit')
  }
  if (args.some((arg) => arg.includes('\0'))) throw new AgentCoreError('INVALID_INPUT', 'Command arguments cannot contain null bytes')

  const allowedScripts = new Set(options.allowedPackageScripts || DEFAULT_PACKAGE_SCRIPTS)
  const packageScript = command === 'pnpm'
    ? parsePackageScript(args, PNPM_FLAG_WITH_VALUE, PNPM_FLAG_WITHOUT_VALUE, allowedScripts, allowedScripts)
    : parsePackageScript(args, NPM_FLAG_WITH_VALUE, NPM_FLAG_WITHOUT_VALUE, allowedScripts, new Set(['test']))
  return { command, args, cwd, timeoutMs, packageScript }
}

function parsePackageScript(
  args: string[],
  flagsWithValue: Set<string>,
  flagsWithoutValue: Set<string>,
  allowedScripts: Set<string>,
  directScripts: Set<string>,
) {
  let index = 0
  while (index < args.length) {
    const token = args[index]!
    if (flagsWithoutValue.has(token) || [...flagsWithValue].some((flag) => token.startsWith(`${flag}=`))) {
      index += 1
      continue
    }
    if (flagsWithValue.has(token)) {
      if (!args[index + 1]) throw new AgentCoreError('INVALID_INPUT', `Missing value for command option: ${token}`)
      index += 2
      continue
    }
    break
  }

  let script = args[index]
  if (script === 'run') {
    script = args[index + 1]
    index += 2
  } else {
    if (script && !directScripts.has(script)) {
      throw commandDenied(`Package script must use the explicit run form: ${script}`)
    }
    index += 1
  }
  if (!script) throw new AgentCoreError('INVALID_INPUT', 'A package script is required')
  if (index !== args.length) {
    throw commandDenied('Forwarded package-script arguments are not allowed in the first runtime version')
  }
  if (!allowedScripts.has(script)) throw commandDenied(`Package script is not allowed: ${script}`)
  return script
}

function stringInput(value: JsonValue | undefined, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new AgentCoreError('INVALID_INPUT', `${name} must be a non-empty string`)
  if (value.includes('\0')) throw new AgentCoreError('INVALID_INPUT', `${name} cannot contain null bytes`)
  return value
}

function optionalStringInput(value: JsonValue | undefined, fallback: string) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !value.trim()) throw new AgentCoreError('INVALID_INPUT', 'cwd must be a non-empty string')
  if (value.includes('\0')) throw new AgentCoreError('INVALID_INPUT', 'cwd cannot contain null bytes')
  return value
}

function stringArrayInput(value: JsonValue | undefined, name: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new AgentCoreError('INVALID_INPUT', `${name} must be an array of strings`)
  }
  return value as string[]
}

function optionalTimeout(value: JsonValue | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new AgentCoreError('INVALID_INPUT', 'timeoutMs must be a positive integer')
  }
  if (value > maximum) throw new AgentCoreError('LIMIT_EXCEEDED', `timeoutMs cannot exceed ${maximum}`)
  return value
}

function commandDenied(message: string) {
  return new AgentCoreError('COMMAND_NOT_ALLOWED', message, { details: { policy: 'restricted-package-scripts-v1' } })
}
