import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { appendTask, initProject } from '../dist/index.js'

test('project records initialize without Agent runtime artifacts', async (t) => {
  const managerRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-data-'))
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-project-'))
  t.after(async () => {
    await rm(managerRoot, { recursive: true, force: true })
    await rm(projectRoot, { recursive: true, force: true })
  })

  const dashboard = await initProject(managerRoot, projectRoot, 'Records')
  assert.equal(dashboard.recordSummary.dataRoot, dashboard.config.dataRoot)
  assert.equal(await exists(path.join(dashboard.config.dataRoot, 'record-summary.json')), true)
  assert.equal(await exists(path.join(dashboard.config.dataRoot, 'agent-brief.json')), false)
  assert.equal(await exists(path.join(projectRoot, '.agent-collaboration.md')), false)

  const next = await appendTask(managerRoot, projectRoot, { title: 'Record task' })
  const task = next.tasks.find((item) => item.title === 'Record task')
  assert.ok(task)
  assert.equal('parentId' in task, false)
  assert.equal('contextId' in task, false)
  assert.equal('messages' in task, false)
})

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}
