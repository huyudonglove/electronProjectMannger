import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import {
  buildRepoMap,
  createRepoMapContextSource,
} from '../dist/index.js'

const exec = promisify(execFile)

test('git repo map honors ignore rules and keeps a stable structure revision', async (t) => {
  const root = await temporaryDirectory(t)
  await mkdir(path.join(root, 'src'), { recursive: true })
  await mkdir(path.join(root, 'ignored'), { recursive: true })
  await mkdir(path.join(root, 'node_modules', 'fixture'), { recursive: true })
  await writeFile(path.join(root, '.gitignore'), 'ignored/\n', 'utf8')
  await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1\n', 'utf8')
  await writeFile(path.join(root, 'ignored', 'secret.ts'), 'ignored\n', 'utf8')
  await writeFile(path.join(root, 'node_modules', 'fixture', 'index.js'), 'ignored\n', 'utf8')
  await exec('git', ['init', '-q'], { cwd: root })

  const first = await buildRepoMap(root)
  const second = await buildRepoMap(root)
  assert.equal(first.strategy, 'git')
  assert.equal(first.revision, second.revision)
  assert.ok(first.paths.includes('src/a.ts'))
  assert.ok(first.paths.includes('.gitignore'))
  assert.ok(!first.content.includes('secret.ts'))
  assert.ok(!first.content.includes('node_modules'))

  await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 2\n', 'utf8')
  assert.equal((await buildRepoMap(root)).revision, first.revision)
  await writeFile(path.join(root, 'src', 'b.ts'), 'export const b = 1\n', 'utf8')
  assert.notEqual((await buildRepoMap(root)).revision, first.revision)
})

test('filesystem fallback skips symlinks and excluded directories', async (t) => {
  const root = await temporaryDirectory(t)
  const outside = await temporaryDirectory(t)
  await mkdir(path.join(root, 'lib'), { recursive: true })
  await mkdir(path.join(root, 'dist'), { recursive: true })
  await writeFile(path.join(root, 'lib', 'index.ts'), 'export {}\n', 'utf8')
  await writeFile(path.join(root, 'dist', 'bundle.js'), 'generated\n', 'utf8')
  await writeFile(path.join(outside, 'secret.txt'), 'secret\n', 'utf8')
  await symlink(outside, path.join(root, 'linked'))

  const snapshot = await buildRepoMap(root)
  assert.equal(snapshot.strategy, 'filesystem')
  assert.deepEqual(snapshot.paths, ['lib/index.ts'])
  assert.ok(!snapshot.content.includes('linked'))
})

test('repo map applies deterministic file, depth and byte budgets', async (t) => {
  const root = await temporaryDirectory(t)
  for (let index = 0; index < 20; index += 1) {
    const directory = path.join(root, 'packages', `package-${String(index).padStart(2, '0')}`, 'src')
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'index.ts'), `export const value = ${index}\n`, 'utf8')
  }
  const snapshot = await buildRepoMap(root, { maxFiles: 8, maxDepth: 2, maxOutputBytes: 300 })
  assert.equal(snapshot.mappedFiles, 8)
  assert.equal(snapshot.truncated, true)
  assert.ok(Buffer.byteLength(snapshot.content, 'utf8') <= 300)
  assert.match(snapshot.content, /已省略 \d+ 行仓库映射/)
  assert.equal((await buildRepoMap(root, { maxFiles: 8, maxDepth: 2, maxOutputBytes: 300 })).revision, snapshot.revision)
})

test('repo map context source is optional, untrusted and ordered before tool results', async (t) => {
  const root = await temporaryDirectory(t)
  await writeFile(path.join(root, 'package.json'), '{}\n', 'utf8')
  const snapshot = await buildRepoMap(root)
  const source = createRepoMapContextSource(snapshot, 2_000)
  const [fragment] = await source.collect({ ledger: { stepCount: 3 } })
  assert.equal(source.descriptor.scope, 'project')
  assert.equal(source.descriptor.trust, 'untrusted')
  assert.equal(source.descriptor.required, false)
  assert.equal(fragment.sequence, 3_150)
  assert.deepEqual(fragment.sourceRefs, [`repo-map:${snapshot.revision}`])
})

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-repo-map-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}
