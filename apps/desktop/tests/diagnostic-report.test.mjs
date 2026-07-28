import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AppDiagnosticLog } from '../dist/app-diagnostics.js'
import { buildDiagnosticReport } from '../dist/diagnostic-report.js'

test('application diagnostics persist project-isolated and redacted failures', async (context) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-app-diagnostics-'))
  context.after(() => rm(dataRoot, { recursive: true, force: true }))
  const log = new AppDiagnosticLog(dataRoot)
  await log.append({
    level: 'error', category: 'ipc', event: 'agent:runs:advance.failed',
    projectRoot: '/Users/example/projects/demo',
    error: new Error('POST https://models.example.test/v1 failed apiKey=sk-secretvalue123 at /Users/example/private/file.ts'),
  })
  assert.equal((await log.recent(10, '/projects/another')).length, 0)
  const [entry] = await log.recent(10, '/Users/example/projects/demo')
  assert.equal(entry.message.includes('models.example.test'), false)
  assert.equal(entry.message.includes('sk-secretvalue123'), false)
  assert.equal(entry.message.includes('/Users/example'), false)
})

test('diagnostic report correlates a selected run without exposing the project root', () => {
  const run = {
    runId: 'run-1', projectRoot: '/Users/example/projects/demo', revision: 4,
    status: 'failed', phase: 'failed', resume: { reason: 'Invalid action' },
    task: { shortId: 'T001', title: 'Demo' },
  }
  const result = buildDiagnosticReport({
    projectKey: '0123456789abcdef01234567',
    appVersion: '0.2.0',
    codeMap: {
      revision: 'code-revision', updatedAt: '2026-01-01T00:00:00.000Z',
      stats: { totalFiles: 2, analyzedFiles: 2, sourceFiles: 1, testFiles: 1, configFiles: 0, dependencyEdges: 1, exportedSymbols: 1, languages: { typescript: 2 } },
    },
    runs: [run],
    selectedRun: { run, events: [{ sequence: 1, at: '2026-01-01T00:00:00.000Z', type: 'run.failed', phase: 'failed', summary: 'Invalid action', payload: { errorCategory: 'invalid_output' } }] },
    appDiagnostics: [],
    modelDiagnostics: [],
  })
  assert.match(result.text, /run-1/)
  assert.match(result.text, /invalid_output/)
  assert.equal(result.text.includes('/Users/example'), false)
  assert.equal('projectRoot' in result.report.selectedRun.run, false)
})
