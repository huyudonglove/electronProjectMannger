import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  LocalAgentRuntime,
  commitFileTransaction,
  computeActionDigest,
  contentHash,
  limitText,
  preparePatch,
  runProcess,
} from '../dist/index.js'

const allow = { effect: 'allow', reason: 'read-only tool' }

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-runtime-'))
  const outside = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-outside-'))
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'src', 'example.ts'), 'export function answer() {\n  return 41\n}\n', 'utf8')
  await writeFile(path.join(root, 'src', 'deleted.ts'), 'export const removed = true\n', 'utf8')
  await writeFile(path.join(root, 'src', 'second.ts'), 'export const second = 10\n', 'utf8')
  await writeFile(path.join(root, 'long.txt'), `${'0123456789'.repeat(300)}\n`, 'utf8')
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    private: true,
    scripts: {
      test: 'node -e "console.log(\'fixture test passed\')"',
      slow: 'node -e "setTimeout(() => {}, 5000)"',
    },
  }, null, 2)}\n`, 'utf8')
  await writeFile(path.join(outside, 'secret.txt'), 'outside secret\n', 'utf8')
  await symlink(path.join(outside, 'secret.txt'), path.join(root, 'escape.txt'))
  await symlink(outside, path.join(root, 'linked-outside'))
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

function writeRequest(id, name, input) {
  return { id, name, input, requestedAt: '2026-07-26T13:00:00.000Z', actionDigest: computeActionDigest(name, input) }
}

function context(root, permission = allow) {
  return { runId: 'run-1', projectRoot: root, permission }
}

test('list, search and ranged reads stay inside the project', async () => {
  const { root } = await fixture()
  const runtime = new LocalAgentRuntime(root, { maxOutputChars: 2_000 })

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
  const runtime = new LocalAgentRuntime(root)

  const lexical = await runtime.execute(request('lexical', 'read_file', { path: path.join('..', path.basename(outside), 'secret.txt') }), context(root))
  assert.equal(lexical.ok, false)
  assert.equal(lexical.error.code, 'PATH_OUTSIDE_PROJECT')

  const symlinked = await runtime.execute(request('symlink', 'read_file', { path: 'escape.txt' }), context(root))
  assert.equal(symlinked.ok, false)
  assert.equal(symlinked.error.code, 'PATH_OUTSIDE_PROJECT')
})

test('git status and diff report dirty state without mutating it', async () => {
  const { root } = await fixture()
  const runtime = new LocalAgentRuntime(root, { maxOutputChars: 4_000 })
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
  const runtime = new LocalAgentRuntime(root, { maxOutputChars: 120 })
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

test('create_file is exclusive, digest-bound and cannot cross symlink or Git boundaries', async () => {
  const { root } = await fixture()
  const runtime = new LocalAgentRuntime(root, { maxWriteChars: 1_000 })
  const input = { path: 'src/generated.ts', content: 'export const generated = true\n' }

  const created = await runtime.execute(writeRequest('create', 'create_file', input), context(root))
  assert.equal(created.ok, true)
  assert.deepEqual(created.changedPaths, ['src/generated.ts'])
  assert.equal(await readFile(path.join(root, 'src', 'generated.ts'), 'utf8'), input.content)

  const duplicate = await runtime.execute(writeRequest('duplicate', 'create_file', input), context(root))
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.error.code, 'PATCH_CONFLICT')

  const digestMismatch = await runtime.execute(request('digest', 'create_file', { path: 'src/digest.ts', content: 'nope' }), context(root))
  assert.equal(digestMismatch.ok, false)
  assert.equal(digestMismatch.error.code, 'ACTION_DIGEST_MISMATCH')

  const symlinkEscape = { path: 'linked-outside/leak.ts', content: 'leak' }
  const escaped = await runtime.execute(writeRequest('escape-write', 'create_file', symlinkEscape), context(root))
  assert.equal(escaped.ok, false)
  assert.equal(escaped.error.code, 'PATH_OUTSIDE_PROJECT')

  const gitInternal = { path: '.git/agent-owned', content: 'forbidden' }
  const protectedResult = await runtime.execute(writeRequest('git-internal', 'create_file', gitInternal), context(root))
  assert.equal(protectedResult.ok, false)
  assert.equal(protectedResult.error.code, 'PERMISSION_DENIED')
})

test('apply_patch updates multiple files while preserving unrelated dirty work', async () => {
  const { root } = await fixture()
  const runtime = new LocalAgentRuntime(root)
  const untrackedBefore = await readFile(path.join(root, 'untracked.ts'), 'utf8')
  const input = {
    operations: [
      { path: 'src/example.ts', oldText: 'return 42', newText: 'return 43' },
      { path: 'src/second.ts', oldText: 'second = 10', newText: 'second = 11' },
    ],
  }

  const result = await runtime.execute(writeRequest('patch', 'apply_patch', input), context(root))
  assert.equal(result.ok, true)
  assert.deepEqual(new Set(result.changedPaths), new Set(['src/example.ts', 'src/second.ts']))
  assert.match(await readFile(path.join(root, 'src', 'example.ts'), 'utf8'), /return 43/)
  assert.match(await readFile(path.join(root, 'src', 'second.ts'), 'utf8'), /second = 11/)
  assert.equal(await readFile(path.join(root, 'untracked.ts'), 'utf8'), untrackedBefore)
})

test('a conflict in any patch operation prevents every file write', async () => {
  const { root } = await fixture()
  const runtime = new LocalAgentRuntime(root)
  const firstBefore = await readFile(path.join(root, 'src', 'example.ts'), 'utf8')
  const secondBefore = await readFile(path.join(root, 'src', 'second.ts'), 'utf8')
  const input = {
    operations: [
      { path: 'src/example.ts', oldText: 'return 42', newText: 'return 43' },
      { path: 'src/second.ts', oldText: 'missing context', newText: 'replacement' },
    ],
  }

  const result = await runtime.execute(writeRequest('conflict', 'apply_patch', input), context(root))
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'PATCH_CONFLICT')
  assert.equal(await readFile(path.join(root, 'src', 'example.ts'), 'utf8'), firstBefore)
  assert.equal(await readFile(path.join(root, 'src', 'second.ts'), 'utf8'), secondBefore)
})

test('a concurrent change during commit rolls back files already replaced', async () => {
  const { root } = await fixture()
  const firstPath = path.join(root, 'src', 'example.ts')
  const secondPath = path.join(root, 'src', 'second.ts')
  const firstBefore = await readFile(firstPath, 'utf8')
  const changes = await preparePatch(root, [
    { path: 'src/example.ts', oldText: 'return 42', newText: 'return 43', expectedOccurrences: 1 },
    { path: 'src/second.ts', oldText: 'second = 10', newText: 'second = 11', expectedOccurrences: 1 },
  ], 1_000_000)
  await writeFile(secondPath, 'export const concurrent = true\n', 'utf8')

  await assert.rejects(
    () => commitFileTransaction(changes),
    (error) => error.code === 'PATCH_CONFLICT',
  )
  assert.equal(await readFile(firstPath, 'utf8'), firstBefore)
  assert.equal(await readFile(secondPath, 'utf8'), 'export const concurrent = true\n')
})

test('apply_patch rejects symlink targets and stable digests ignore object key insertion order', async () => {
  const { root } = await fixture()
  const runtime = new LocalAgentRuntime(root)
  const input = { operations: [{ path: 'escape.txt', oldText: 'outside', newText: 'inside' }] }
  const result = await runtime.execute(writeRequest('symlink-patch', 'apply_patch', input), context(root))
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'PATH_OUTSIDE_PROJECT')

  assert.equal(
    computeActionDigest('create_file', { path: 'a.ts', content: 'a' }),
    computeActionDigest('create_file', { content: 'a', path: 'a.ts' }),
  )
})

test('every operation expectedHash refers to the original file content', async () => {
  const { root } = await fixture()
  const runtime = new LocalAgentRuntime(root)
  const original = await readFile(path.join(root, 'src', 'example.ts'), 'utf8')
  const input = {
    operations: [
      { path: 'src/example.ts', oldText: 'answer()', newText: 'result()', expectedHash: contentHash(original) },
      { path: 'src/example.ts', oldText: 'return 42', newText: 'return 43', expectedHash: contentHash(original) },
    ],
  }

  const result = await runtime.execute(writeRequest('original-hash', 'apply_patch', input), context(root))
  assert.equal(result.ok, true)
  assert.equal(await readFile(path.join(root, 'src', 'example.ts'), 'utf8'), 'export function result() {\n  return 43\n}\n')
})

test('exec_command runs an approved package script without overwriting existing dirty files', async () => {
  const { root } = await fixture()
  const runtime = new LocalAgentRuntime(root, { timeoutMs: 20_000 })
  const before = await run('git', ['status', '--porcelain'], root)
  const dirtyBefore = await readFile(path.join(root, 'src', 'example.ts'), 'utf8')
  const untrackedBefore = await readFile(path.join(root, 'untracked.ts'), 'utf8')
  const input = { command: 'pnpm', args: ['test'], cwd: '.', timeoutMs: 15_000 }

  const result = await runtime.execute(writeRequest('exec-test', 'exec_command', input), context(root, {
    effect: 'allow',
    reason: 'approved verification command',
  }))
  const after = await run('git', ['status', '--porcelain'], root)

  assert.equal(result.ok, true)
  assert.match(result.output, /fixture test passed/)
  assert.equal(result.metadata.command, 'pnpm')
  assert.equal(result.metadata.packageScript, 'test')
  assert.equal(result.metadata.cwd, '.')
  assert.equal(result.metadata.timeoutMs, 15_000)
  for (const line of before.split('\n').filter(Boolean)) assert.match(after, new RegExp(escapeRegex(line)))
  assert.equal(await readFile(path.join(root, 'src', 'example.ts'), 'utf8'), dirtyBefore)
  assert.equal(await readFile(path.join(root, 'untracked.ts'), 'utf8'), untrackedBefore)
})

test('exec_command rejects shells, network tools, package mutations and forwarded arguments', async () => {
  const { root } = await fixture()
  const runtime = new LocalAgentRuntime(root)
  const marker = path.join(root, 'shell-owned.txt')
  const deniedInputs = [
    { command: 'sh', args: ['-c', `touch ${marker}`] },
    { command: 'curl', args: ['https://example.com'] },
    { command: 'pnpm', args: ['add', 'left-pad'] },
    { command: 'pnpm', args: ['test', ';', 'touch', marker] },
    { command: 'npm', args: ['build'] },
    { command: 'git', args: ['add', '.'] },
  ]

  for (const [index, input] of deniedInputs.entries()) {
    const result = await runtime.execute(writeRequest(`denied-command-${index}`, 'exec_command', input), context(root))
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'COMMAND_NOT_ALLOWED')
  }
  await assert.rejects(() => readFile(marker, 'utf8'), { code: 'ENOENT' })
})

test('exec_command requires approval and keeps cwd inside a real project directory', async () => {
  const { root, outside } = await fixture()
  const runtime = new LocalAgentRuntime(root)
  const input = { command: 'pnpm', args: ['test'] }

  const approval = await runtime.execute(writeRequest('approval', 'exec_command', input), context(root, {
    effect: 'ask',
    reason: 'process execution requires approval',
  }))
  assert.equal(approval.ok, false)
  assert.equal(approval.error.code, 'APPROVAL_REQUIRED')

  const lexicalInput = { ...input, cwd: path.join('..', path.basename(outside)) }
  const lexical = await runtime.execute(writeRequest('exec-lexical', 'exec_command', lexicalInput), context(root))
  assert.equal(lexical.ok, false)
  assert.equal(lexical.error.code, 'PATH_OUTSIDE_PROJECT')

  const symlinkInput = { ...input, cwd: 'linked-outside' }
  const symlinked = await runtime.execute(writeRequest('exec-symlink', 'exec_command', symlinkInput), context(root))
  assert.equal(symlinked.ok, false)
  assert.equal(symlinked.error.code, 'PATH_OUTSIDE_PROJECT')

  const fileInput = { ...input, cwd: 'package.json' }
  const fileCwd = await runtime.execute(writeRequest('exec-file-cwd', 'exec_command', fileInput), context(root))
  assert.equal(fileCwd.ok, false)
  assert.equal(fileCwd.error.code, 'INVALID_INPUT')
})

test('exec_command enforces its timeout and records termination evidence', async () => {
  const { root } = await fixture()
  const runtime = new LocalAgentRuntime(root, { timeoutMs: 2_000, allowedPackageScripts: ['test', 'slow'] })
  const input = { command: 'pnpm', args: ['slow'], timeoutMs: 100 }

  const result = await runtime.execute(writeRequest('exec-timeout', 'exec_command', input), context(root))
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'TOOL_TIMEOUT')
  assert.notEqual(result.metadata.signal, null)
  assert.equal(result.metadata.timeoutMs, 100)
})

async function run(command, args, cwd) {
  const result = await runProcess(command, args, { cwd, timeoutMs: 10_000, maxOutputChars: 20_000 })
  if (result.exitCode !== 0) throw new Error(result.output || `${command} failed`)
  return result.output
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
