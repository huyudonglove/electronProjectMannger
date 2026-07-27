import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  LocalContentAddressedOutputStore,
  OutputExternalizingRuntime,
} from '../dist/index.js'

test('local output store persists, deduplicates and reloads content-addressed text', async (t) => {
  const root = await temporaryDirectory(t)
  const store = new LocalContentAddressedOutputStore(root, { clock: () => '2026-07-27T10:00:00.000Z' })
  const first = await store.put('same output')
  const second = await store.put('same output', { createdAt: '2099-01-01T00:00:00.000Z' })

  assert.equal(first.ref, second.ref)
  assert.deepEqual(second, first)
  assert.equal((await store.read(first.ref)).content, 'same output')
  assert.equal((await objectFiles(root)).length, 1)
})

test('local output store rejects oversized and corrupted artifacts', async (t) => {
  const root = await temporaryDirectory(t)
  const store = new LocalContentAddressedOutputStore(root, { maxArtifactBytes: 12 })
  await assert.rejects(() => store.put('1234567890123'), (error) => error.code === 'LIMIT_EXCEEDED')

  const artifact = await store.put('valid output')
  const [objectPath] = await objectFiles(root)
  const envelope = JSON.parse(await readFile(objectPath, 'utf8'))
  envelope.content = 'tampered output'
  await writeFile(objectPath, JSON.stringify(envelope), 'utf8')
  await assert.rejects(
    () => store.read(artifact.ref),
    (error) => error.code === 'CHECKPOINT_ERROR' && /corrupted/.test(error.message),
  )
})

test('runtime wrapper keeps a bounded preview and externalizes execute and reconcile results', async (t) => {
  const root = await temporaryDirectory(t)
  const store = new LocalContentAddressedOutputStore(root)
  const output = `${'head '.repeat(20)}${'tail '.repeat(20)}`
  const result = {
    requestId: 'request-1',
    ok: true,
    summary: 'done',
    startedAt: '2026-07-27T10:00:00.000Z',
    completedAt: '2026-07-27T10:00:01.000Z',
    output,
  }
  const calls = []
  const delegate = {
    async execute() {
      calls.push('execute')
      return result
    },
    async prepareEffect() {
      calls.push('prepare')
      return { backend: 'fixture', inputHash: 'hash', expectedEffects: [] }
    },
    async reconcileEffect() {
      calls.push('reconcile')
      return { outcome: 'completed', summary: 'recovered', result }
    },
    async snapshotTools() {
      calls.push('snapshot')
      return { schemaVersion: 1, revision: 'fixture', data: {} }
    },
  }
  const runtime = new OutputExternalizingRuntime(delegate, store, { previewCharacters: 60 })
  const request = { id: 'request-1', name: 'fixture', input: {}, requestedAt: '', actionDigest: '' }
  const context = { runId: 'run-1', projectRoot: '/fixture', permission: { effect: 'allow', reason: 'test' } }

  const executed = await runtime.execute(request, context)
  assert.equal(executed.output.length, 60)
  assert.equal(executed.metadata.outputPreviewTruncated, true)
  assert.equal((await store.read(executed.outputRef)).content, output)
  const reconciled = await runtime.reconcileEffect(request, [], context)
  assert.equal(reconciled.result.outputRef, executed.outputRef)
  const rebound = await new OutputExternalizingRuntime({
    async execute() { return { ...result, outputRef: executed.outputRef } },
  }, store, { previewCharacters: 20 }).execute(request, context)
  assert.equal(rebound.outputRef, executed.outputRef)
  assert.equal(rebound.output.length, 20)
  await runtime.prepareEffect(request, context)
  await runtime.snapshotTools()
  assert.deepEqual(calls, ['execute', 'reconcile', 'prepare', 'snapshot'])
})

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-output-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function objectFiles(root) {
  const objectsRoot = path.join(root, 'objects')
  const prefixes = await readdir(objectsRoot)
  const files = []
  for (const prefix of prefixes) {
    for (const file of await readdir(path.join(objectsRoot, prefix))) files.push(path.join(objectsRoot, prefix, file))
  }
  return files.sort()
}
