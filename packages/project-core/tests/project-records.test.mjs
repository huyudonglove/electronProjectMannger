import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { appendTask, initProject, isInitialized, updateProjectMetadata } from '../dist/index.js'

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

  const skillPath = path.join(dashboard.config.dataRoot, 'skills/project-records/SKILL.md')
  const persistedSummary = JSON.parse(await readFile(path.join(dashboard.config.dataRoot, 'record-summary.json'), 'utf8'))
  const skill = await readFile(skillPath, 'utf8')
  assert.equal(dashboard.recordSummary.recordSkillPath, skillPath)
  assert.equal(persistedSummary.recordSkillPath, skillPath)
  assert.match(skill, /^---\nname: project-records\ndescription: .+\n---\n/)
  assert.match(skill, /record-summary\.json/)
  assert.match(skill, /currentDataPaths/)
  assert.match(skill, /type:: work-log/)
  for (const prefix of ['T', 'I', 'D', 'Q', 'R', 'L', 'C', 'W', 'K', 'V']) {
    assert.match(skill, new RegExp(`- ${prefix} records are`))
  }
  assert.match(skill, /Preserve completed-version and historical Markdown verbatim/)
  assert.match(skill, /preserve unrelated records and user changes/)
  assert.match(skill, /re-read the target Markdown and .+record-counters\.json/)
  assert.match(skill, /set its T record to `doing`/)
  assert.match(skill, /verification succeeds, set it to `done` and write one L work log/)
  assert.match(skill, /task_short_id:: T000/)
  assert.match(skill, /Do not write while Telance Records or another agent is changing/)
  assert.doesNotMatch(skill, /\b(?:Chat|model|Run|approval)\b|task[ -]tree|delegat/i)

  await writeFile(skillPath, '# stale\n', 'utf8')
  await updateProjectMetadata(managerRoot, projectRoot)
  const refreshedSkill = await readFile(skillPath, 'utf8')
  assert.match(refreshedSkill, /^---\nname: project-records\n/)
  assert.notEqual(refreshedSkill, '# stale\n')

  const next = await appendTask(managerRoot, projectRoot, { title: 'Record task' })
  const task = next.tasks.find((item) => item.title === 'Record task')
  assert.ok(task)
  assert.equal('parentId' in task, false)
  assert.equal('contextId' in task, false)
  assert.equal('messages' in task, false)
})

test('legacy change index migrates without losing content', async (t) => {
  const managerRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-data-'))
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-project-'))
  t.after(async () => {
    await rm(managerRoot, { recursive: true, force: true })
    await rm(projectRoot, { recursive: true, force: true })
  })

  const dashboard = await initProject(managerRoot, projectRoot, 'Legacy Records')
  const currentPath = path.join(dashboard.config.dataRoot, 'metadata/需求变更索引.md')
  const legacyPath = path.join(dashboard.config.dataRoot, 'collaboration/需求变更索引.md')
  const legacyContent = '# 需求变更索引\n\n- preserved legacy entry\n'

  await rm(currentPath)
  await mkdir(path.dirname(legacyPath), { recursive: true })
  await writeFile(legacyPath, legacyContent, 'utf8')
  assert.equal(await isInitialized(managerRoot, projectRoot), false)

  await updateProjectMetadata(managerRoot, projectRoot)

  assert.equal(await isInitialized(managerRoot, projectRoot), true)
  assert.equal(await readFile(currentPath, 'utf8'), legacyContent)
  assert.equal(await exists(legacyPath), false)
})

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}
