import { execFile as execFileCallback } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  DesktopAgentConfigService,
  DesktopAgentPermissionPolicy,
  DesktopModelProviderFactory,
} from '../packages/agent-desktop-config/dist/index.js'
import {
  DesktopAgentSettingsStore,
  desktopAgentSettingsPath,
} from '../packages/agent-desktop-config/dist/settings-index.js'
import {
  DesktopAgentCoordinator,
  createHeadlessDesktopAgentBackend,
} from '../packages/agent-desktop-coordinator/dist/index.js'
import {
  appendTask,
  initProject,
} from '../packages/project-core/dist/index.js'

const execFile = promisify(execFileCallback)
const sourceManagerRoot = process.env.ELECTRON_MANAGER_DATA_ROOT
  || path.join(os.homedir(), 'Library', 'Application Support', 'electron-manager')
const keepFixture = process.env.KEEP_AGENT_CODING_SMOKE === '1'
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-coding-smoke-'))
const managerRoot = path.join(temporaryRoot, 'manager-data')
const projectRoot = path.join(temporaryRoot, 'project')
const diagnostics = []

try {
  await prepareFixture()
  const dashboard = await initProject(managerRoot, projectRoot, 'Agent Coding Smoke')
  await commitFixtureBaseline()
  const taskDashboard = await appendTask(managerRoot, projectRoot, {
    title: '修改欢迎消息并通过测试',
    status: 'todo',
    priority: 'high',
    workLevel: 'standard',
    area: 'coding-smoke',
    userOriginal: '修改 src/message.js，将欢迎消息从 hello 改成 hello, coder，并运行现有测试。',
    executionDefinition: [
      '只修改 src/message.js。',
      '把导出的 message 字符串从 hello 精确改为 hello, coder。',
      '保留导出名称和文件结构，运行 npm test，并读取最终 Git Diff。',
    ].join('\n'),
    acceptance: [
      'src/message.js 导出 hello, coder。',
      'npm test 通过。',
      '最终 Diff 只包含 src/message.js。',
    ].join('\n'),
  })
  const task = taskDashboard.tasks.find((candidate) => candidate.title === '修改欢迎消息并通过测试')
  assert(task, 'Coding smoke task was not created')

  const settingsStore = new DesktopAgentSettingsStore(desktopAgentSettingsPath(managerRoot))
  const config = new DesktopAgentConfigService({
    managerDataRoot: managerRoot,
    store: settingsStore,
    providers: new DesktopModelProviderFactory({
      credentials: { resolveCredential: async () => null },
      onModelDiagnostic: (entry) => diagnostics.push(boundedDiagnostic(entry)),
    }),
  })
  const permissionPolicy = new DesktopAgentPermissionPolicy()
  const backend = createHeadlessDesktopAgentBackend({
    storageFor: (root) => config.storageFor(root),
    runnerOptionsFor: async ({ projectRoot: root }) => ({
      ...await config.resolve(root),
      permissionPolicy,
      runtimeOptions: { timeoutMs: 120_000 },
    }),
  })
  const coordinator = new DesktopAgentCoordinator({ managerDataRoot: managerRoot, backend })
  let detail = await coordinator.startTask({
    projectRoot,
    taskId: task.id,
    intent: 'change',
    verificationPlan: {
      checks: [{
        id: 'fixture-test',
        label: '运行隔离 fixture 测试',
        required: true,
        command: ['npm', 'run', 'test'],
        timeoutMs: 30_000,
      }],
    },
  })

  let approvals = 0
  for (let operation = 1; operation <= 24 && !terminal(detail.run.status); operation += 1) {
    if (detail.run.waiting) {
      approvals += 1
      detail = await coordinator.resolveApproval({
        projectRoot,
        runId: detail.run.runId,
        decision: 'approved',
        reason: 'Live coding smoke approves only the fixture package test declared above.',
        continueUntilPause: true,
      })
    } else {
      detail = await coordinator.advanceRun({
        projectRoot,
        runId: detail.run.runId,
        untilPause: true,
      })
    }
  }

  const messageSource = await readFile(path.join(projectRoot, 'src', 'message.js'), 'utf8')
  const gitDiff = (await execFile('git', ['diff', '--', 'src/message.js'], { cwd: projectRoot })).stdout
  assert(detail.run.status === 'completed', `Coding smoke did not complete: ${detail.run.status} (${detail.run.resume.reason})`)
  assert(messageSource === "export const message = 'hello, coder'\n", 'Agent did not produce the expected source change')
  assert(detail.run.progress.verificationPassed >= 1, 'Coding smoke did not persist a passed verification')
  assert(detail.run.diff?.changedFiles.length === 1 && detail.run.diff.changedFiles[0] === 'src/message.js', 'Final diff evidence was not scoped to the edited file')
  assert(/hello, coder/.test(gitDiff), 'Git diff does not contain the expected source change')

  if (!keepFixture) await rm(temporaryRoot, { recursive: true, force: true })

  process.stdout.write(`${JSON.stringify({
    ok: true,
    provider: diagnostics.find((entry) => entry.providerId)?.providerId || 'unknown',
    model: diagnostics.find((entry) => entry.model)?.model || 'unknown',
    runId: detail.run.runId,
    steps: detail.run.stepCount,
    approvals,
    changedFiles: detail.run.diff.changedFiles,
    verificationPassed: detail.run.progress.verificationPassed,
    recordSync: detail.run.recordSync,
    fixture: keepFixture ? projectRoot : 'removed',
  })}\n`)

} catch (error) {
  process.stderr.write(`Agent coding smoke failed. Fixture retained at ${temporaryRoot}\n`)
  if (diagnostics.length) process.stderr.write(`${JSON.stringify({ diagnostics }, null, 2)}\n`)
  throw error
}

async function prepareFixture() {
  const sourceSettings = desktopAgentSettingsPath(sourceManagerRoot)
  const targetSettings = desktopAgentSettingsPath(managerRoot)
  await mkdir(path.dirname(targetSettings), { recursive: true })
  await cp(sourceSettings, targetSettings)
  await mkdir(path.join(projectRoot, 'src'), { recursive: true })
  await mkdir(path.join(projectRoot, 'test'), { recursive: true })
  await writeFile(path.join(projectRoot, 'package.json'), `${JSON.stringify({
    name: 'electron-manager-agent-coding-smoke',
    private: true,
    type: 'module',
    scripts: { test: 'node --test' },
  }, null, 2)}\n`, 'utf8')
  await writeFile(path.join(projectRoot, 'src', 'message.js'), "export const message = 'hello'\n", 'utf8')
  await writeFile(path.join(projectRoot, 'test', 'message.test.js'), [
    "import assert from 'node:assert/strict'",
    "import test from 'node:test'",
    "import { message } from '../src/message.js'",
    '',
    "test('exports the coding smoke message', () => {",
    "  assert.equal(message, 'hello, coder')",
    '})',
    '',
  ].join('\n'), 'utf8')
}

async function commitFixtureBaseline() {
  await execFile('git', ['init'], { cwd: projectRoot })
  await execFile('git', ['config', 'user.name', 'Electron Manager Smoke'], { cwd: projectRoot })
  await execFile('git', ['config', 'user.email', 'smoke@localhost'], { cwd: projectRoot })
  await execFile('git', ['add', '.'], { cwd: projectRoot })
  await execFile('git', ['commit', '-m', 'fixture baseline'], { cwd: projectRoot })
}

function boundedDiagnostic(entry) {
  return {
    event: String(entry?.event || '').slice(0, 80),
    providerId: String(entry?.providerId || '').slice(0, 80),
    model: String(entry?.model || '').slice(0, 120),
    status: Number.isInteger(entry?.status) ? entry.status : undefined,
    error: entry?.error ? String(entry.error).slice(0, 300) : undefined,
  }
}

function terminal(status) {
  return ['completed', 'blocked', 'failed', 'cancelled'].includes(status)
}

function assert(value, message) {
  if (!value) throw new Error(message)
}
