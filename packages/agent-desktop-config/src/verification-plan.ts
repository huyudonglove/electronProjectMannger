import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import type { VerificationPlan } from '@electron-manager/agent-core'

const SCRIPT_PRIORITY = ['test', 'typecheck', 'check', 'lint', 'build'] as const

export async function inferDesktopVerificationPlan(projectRoot: string): Promise<VerificationPlan> {
  const root = path.resolve(requireProjectRoot(projectRoot))
  const manifest = await readPackageManifest(path.join(root, 'package.json'))
  if (!manifest) return { checks: [] }
  const script = SCRIPT_PRIORITY.find((name) => usableScript(name, manifest.scripts?.[name]))
  if (!script) return { checks: [] }
  const command = await packageCommand(root, script)
  return {
    checks: [{
      id: `package-script-${script}`,
      label: `运行项目 ${script} 脚本`,
      required: true,
      command,
      timeoutMs: 120_000,
    }],
  }
}

async function readPackageManifest(filePath: string) {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf8')) as { scripts?: Record<string, unknown> }
    return value && typeof value === 'object' ? value : null
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw new Error(`Project package.json could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function usableScript(name: string, value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return false
  if (name === 'test' && /no test specified|exit\s+1/i.test(value)) return false
  return true
}

async function packageCommand(root: string, script: string) {
  try {
    await access(path.join(root, 'pnpm-lock.yaml'))
    return ['pnpm', 'run', script]
  } catch {
    return ['npm', 'run', script]
  }
}

function requireProjectRoot(value: string) {
  if (!String(value || '').trim()) throw new Error('Project root is required')
  return value
}
