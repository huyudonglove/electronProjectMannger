import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { LocalAgentRuntime, computeActionDigest } from '../dist/index.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-reconcile-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'src', 'first.ts'), 'export const first = 1\n', 'utf8')
  await writeFile(path.join(root, 'src', 'second.ts'), 'export const second = 1\n', 'utf8')
  return root
}

function request(id, name, input) {
  return {
    id,
    name,
    input,
    requestedAt: '2026-07-27T06:00:00.000Z',
    actionDigest: computeActionDigest(name, input),
  }
}

function context(root) {
  return { runId: 'run-reconcile', projectRoot: root, permission: { effect: 'allow', reason: 'fixture' } }
}

test('create_file reconciliation distinguishes missing, completed and conflicting targets', async (t) => {
  const root = await fixture(t)
  const runtime = new LocalAgentRuntime(root)
  const toolRequest = request('create-1', 'create_file', {
    path: 'src/created.ts',
    content: 'export const created = true\n',
  })
  const plan = await runtime.prepareEffect(toolRequest, context(root))

  assert.equal(plan.expectedEffects[0].beforeHash, null)
  assert.equal((await runtime.reconcileEffect(toolRequest, plan.expectedEffects, context(root))).outcome, 'not_applied')

  await writeFile(path.join(root, 'src', 'created.ts'), 'export const created = true\n', 'utf8')
  const completed = await runtime.reconcileEffect(toolRequest, plan.expectedEffects, context(root))
  assert.equal(completed.outcome, 'completed')
  assert.deepEqual(completed.result.changedPaths, ['src/created.ts'])

  await writeFile(path.join(root, 'src', 'created.ts'), 'different content\n', 'utf8')
  assert.equal((await runtime.reconcileEffect(toolRequest, plan.expectedEffects, context(root))).outcome, 'blocked')
})

test('apply_patch reconciliation compares the complete file set atomically', async (t) => {
  const root = await fixture(t)
  const runtime = new LocalAgentRuntime(root)
  const toolRequest = request('patch-1', 'apply_patch', {
    operations: [
      { path: 'src/first.ts', oldText: 'first = 1', newText: 'first = 2' },
      { path: 'src/second.ts', oldText: 'second = 1', newText: 'second = 2' },
    ],
  })
  const plan = await runtime.prepareEffect(toolRequest, context(root))
  assert.equal(plan.expectedEffects.length, 2)
  assert.equal((await runtime.reconcileEffect(toolRequest, plan.expectedEffects, context(root))).outcome, 'not_applied')

  const executed = await runtime.execute(toolRequest, context(root))
  assert.equal(executed.ok, true)
  assert.equal((await runtime.reconcileEffect(toolRequest, plan.expectedEffects, context(root))).outcome, 'completed')

  await writeFile(path.join(root, 'src', 'first.ts'), 'export const first = 1\n', 'utf8')
  assert.equal((await runtime.reconcileEffect(toolRequest, plan.expectedEffects, context(root))).outcome, 'blocked')
})
