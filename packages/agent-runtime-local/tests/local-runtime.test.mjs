import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { LocalReadRuntime, limitText, runProcess } from '../dist/index.js'

const allow = { effect: 'allow', reason: 'read-only tool' }

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-runtime-'))
  const outside = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-outside-'))
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'src', 'example.ts'), 'export function answer() {\n  return 41\n}\n', 'utf8')
  await writeFile(path.join(root, 'src', 'deleted.ts'), 'export const removed = true\n', 'utf8')
  await writeFile(path.join(root, 'long.txt'), `${'0123456789'.repeat(300)}\n`, 'utf8')
  await writeFile(path.join(outside, 'secret.txt'), 'outside secret\n', 'utf8')
  await symlink(path.join(outside, 'secret.txt'), path.join(root, 'escape.txt'))
  await run('git', ['init', '-q'], root)
  await run('git', ['config', 'user.email', 'fixture@example.com'], root)
  await run('git', ['config', 'user.name', 'Fixture'], root)
  await run('git', ['add', '.'], root)
  await run('git', ['commit', '-qm', 'fixture'], root)
  await writeFile(path.join(root, 'src', 'example.ts'), 'export function answer() {\n  return 42\n}\n', 'utf8')
  await unlink(path.join(root, 'src', 'deleted.ts'))
  await writeFile(path.join(root, 'untracked.ts'), 'export const untracked = true\n', 'utf8')
  return { root, outside }
}

function request(id, name, input = {}) {
  return { id, name, input, requestedAt: '2026-07-26T13:00:00.000Z', actionDigest: `${name}-digest` }
}

function context(root, permission = allow) {
  return { runId: 'run-1', projectRoot: root, permission }
}

test('list, search and ranged reads stay inside the project', async () => {
  const { root } = await fixture()
  const runtime = new LocalReadRuntime(root, { maxOutputChars: 2_000 })

  const listed = await runtime.execute(request('list', 'list_files'), context(root))
  assert.equal(listed.ok, true)
  assert.match(listed.output, /src\/example\.ts/)

  const searched = await runtime.execute(request('search', 'search_text', { query: 'answer', path: 'src' }), context(root))
  assert.equal(searched.ok, true)
  assert.match(searched.output, /example\.ts:1:/)

  const read = await runtime.execute(request('read', 'read_file', { path: 'src/example.ts', startLine: 2, endLine: 2 }), context(root))
  assert.equal(read.ok, true)
  assert.equal(read.output, '2:   return 42')
})

test('lexical and symlink path escapes are rejected', async () => {
  const { root, outside } = await fixture()
  const runtime = new LocalReadRuntime(root)

  const lexical = await runtime.execute(request('lexical', 'read_file', { path: path.join('..', path.basename(outside), 'secret.txt') }), context(root))
  assert.equal(lexical.ok, false)
  assert.equal(lexical.error.code, 'PATH_OUTSIDE_PROJECT')

  const symlinked = await runtime.execute(request('symlink', 'read_file', { path: 'escape.txt' }), context(root))
  assert.equal(symlinked.ok, false)
  assert.equal(symlinked.error.code, 'PATH_OUTSIDE_PROJECT')
})

test('git status and diff report dirty state without mutating it', async () => {
  const { root } = await fixture()
  const runtime = new LocalReadRuntime(root, { maxOutputChars: 4_000 })
  const before = await run('git', ['status', '--porcelain'], root)

  const status = await runtime.execute(request('status', 'git_status'), context(root))
  const diff = await runtime.execute(request('diff', 'git_diff'), context(root))
  const after = await run('git', ['status', '--porcelain'], root)

  assert.equal(status.ok, true)
  assert.match(status.output, /M src\/example\.ts/)
  assert.match(status.output, /\?\? untracked\.ts/)
  assert.equal(diff.ok, true)
  assert.match(diff.output, /return 42/)
  const deletedDiff = await runtime.execute(request('deleted-diff', 'git_diff', { paths: ['src/deleted.ts'] }), context(root))
  assert.equal(deletedDiff.ok, true)
  assert.match(deletedDiff.output, /deleted file mode/)
  assert.equal(after, before)
})

test('output limits and permission decisions are enforced', async () => {
  const { root } = await fixture()
  const runtime = new LocalReadRuntime(root, { maxOutputChars: 120 })
  const read = await runtime.execute(request('long', 'read_file', { path: 'long.txt', startLine: 1, endLine: 1 }), context(root))
  assert.equal(read.ok, true)
  assert.equal(read.truncated, true)
  assert.ok(read.output.length <= 120)

  const denied = await runtime.execute(request('denied', 'git_status'), context(root, { effect: 'deny', reason: 'policy denied' }))
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'PERMISSION_DENIED')

  assert.deepEqual(limitText('abcdef', 4), { text: 'abcd', truncated: true, originalChars: 6 })
})

test('process runner reports timeout and terminates the process group', async () => {
  const { root } = await fixture()
  const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
    cwd: root,
    timeoutMs: 50,
    maxOutputChars: 1_000,
  })
  assert.equal(result.timedOut, true)
  assert.notEqual(result.signal, null)
})

async function run(command, args, cwd) {
  const result = await runProcess(command, args, { cwd, timeoutMs: 10_000, maxOutputChars: 20_000 })
  if (result.exitCode !== 0) throw new Error(result.output || `${command} failed`)
  return result.output
}
