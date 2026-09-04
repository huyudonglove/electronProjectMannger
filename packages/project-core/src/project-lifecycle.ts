import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { baselineMarkdown, getDashboard, indexFromDashboard, refreshRecordSummary } from './dashboard.js'
import {
  BASELINE_PATH,
  CHANGE_INDEX_PATH,
  CONSTRAINTS_PATH,
  DATA_SPEC_PATH,
  DOCUMENTS_DIR,
  GLOBAL_KNOWLEDGE_DIR,
  RECORD_SKILL_PATH,
  RECORD_SUMMARY_PATH,
  VERSIONS_PATH,
  VERSION_DIALOGUES_FILE,
  VERSION_QUESTIONS_FILE,
  VERSION_RISKS_FILE,
  VERSION_TASKS_FILE,
  VERSION_THOUGHTS_FILE,
} from './paths.js'
import {
  changeIndexTemplate,
  constraintsTemplate,
  dataSpecTemplate,
  dialoguesTemplate,
  questionsTemplate,
  recordSkillTemplate,
  risksTemplate,
  tasksTemplate,
  thoughtsTemplate,
  versionsTemplate,
  workLogTemplate,
} from './templates.js'
import type { ProjectConfig } from './types.js'
import {
  createProjectId,
  readProjectConfig,
  resolveDataRoot,
  resolveExistingDataRoot,
} from './internal/project-context.js'
import { upsertProjectIndex } from './internal/project-registry.js'
import {
  atomicWriteFile,
  ensureProjectDirectory,
  readExistingProjectFile,
  readExistingRootFile,
  writeProjectFile,
} from './internal/storage.js'
import { versionLogPath, versionRecordPath } from './internal/version-files.js'

const LEGACY_CHANGE_INDEX_PATH = 'collaboration/需求变更索引.md'

function requiredProjectFiles() {
  return [
    'project.json',
    DATA_SPEC_PATH,
    CHANGE_INDEX_PATH,
    CONSTRAINTS_PATH,
    RECORD_SKILL_PATH,
    VERSIONS_PATH,
  ]
}

export async function isInitialized(managerDataRoot: string, projectRoot: string) {
  try {
    const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
    await Promise.all(requiredProjectFiles().map((relativePath) => readFile(path.join(dataRoot, relativePath), 'utf8')))
    return true
  } catch {
    return false
  }
}

export async function initProject(managerDataRoot: string, projectRoot: string, name = path.basename(projectRoot)) {
  const projectId = createProjectId(projectRoot, name)
  const dataRoot = resolveDataRoot(managerDataRoot, projectRoot, name)
  if (await readExistingProjectFile(dataRoot, 'project.json')) {
    return updateProjectMetadata(managerDataRoot, projectRoot)
  }
  const config: ProjectConfig = {
    projectId,
    name,
    projectRoot,
    dataRoot,
    createdAt: new Date().toISOString(),
    schemaVersion: 3,
    currentVersionId: 'V001',
  }

  await writeProjectFile(dataRoot, 'project.json', `${JSON.stringify(config, null, 2)}\n`)
  await writeProjectFile(dataRoot, DATA_SPEC_PATH, dataSpecTemplate())
  await ensureProjectDirectory(dataRoot, DOCUMENTS_DIR)
  await writeProjectFile(dataRoot, CHANGE_INDEX_PATH, changeIndexTemplate())
  await writeProjectFile(dataRoot, CONSTRAINTS_PATH, constraintsTemplate())
  await writeProjectFile(dataRoot, VERSIONS_PATH, versionsTemplate(name))
  await writeProjectFile(dataRoot, versionRecordPath('V001', VERSION_TASKS_FILE), tasksTemplate(name))
  await writeProjectFile(dataRoot, versionRecordPath('V001', VERSION_THOUGHTS_FILE), thoughtsTemplate())
  await writeProjectFile(dataRoot, versionRecordPath('V001', VERSION_DIALOGUES_FILE), dialoguesTemplate())
  await writeProjectFile(dataRoot, versionRecordPath('V001', VERSION_QUESTIONS_FILE), questionsTemplate())
  await writeProjectFile(dataRoot, versionRecordPath('V001', VERSION_RISKS_FILE), risksTemplate())
  await writeProjectFile(dataRoot, versionLogPath('V001'), workLogTemplate())
  await writeProjectFile(dataRoot, RECORD_SKILL_PATH, recordSkillTemplate(dataRoot))
  await ensureProjectDirectory(managerDataRoot, GLOBAL_KNOWLEDGE_DIR)
  await upsertProjectIndex(managerDataRoot, config)

  const dashboard = await getDashboard(managerDataRoot, projectRoot)
  await writeProjectFile(dataRoot, RECORD_SUMMARY_PATH, `${JSON.stringify(dashboard.recordSummary, null, 2)}\n`)
  await writeProjectFile(dataRoot, BASELINE_PATH, baselineMarkdown(dashboard))
  await writeProjectFile(dataRoot, 'index.json', `${JSON.stringify(indexFromDashboard(dashboard), null, 2)}\n`)

  return dashboard
}

export async function updateProjectMetadata(managerDataRoot: string, projectRoot: string) {
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  await migrateLegacyProjectMetadata(dataRoot)
  await removeLegacyAgentArtifacts(dataRoot, projectRoot)
  await writeProjectFile(dataRoot, DATA_SPEC_PATH, dataSpecTemplate())
  await writeProjectFile(dataRoot, RECORD_SKILL_PATH, recordSkillTemplate(dataRoot))
  await refreshRecordSummary(managerDataRoot, projectRoot)
  await upsertProjectIndex(managerDataRoot, config, false)
  return getDashboard(managerDataRoot, projectRoot)
}

async function migrateLegacyProjectMetadata(dataRoot: string) {
  const currentChangeIndex = await readExistingProjectFile(dataRoot, CHANGE_INDEX_PATH)
  if (currentChangeIndex) return

  const legacyChangeIndex = await readExistingProjectFile(dataRoot, LEGACY_CHANGE_INDEX_PATH)
  await writeProjectFile(dataRoot, CHANGE_INDEX_PATH, legacyChangeIndex || changeIndexTemplate())
}

async function removeLegacyAgentArtifacts(dataRoot: string, projectRoot: string) {
  const obsoleteFiles = [
    path.join(dataRoot, 'agent-brief.json'),
    path.join(dataRoot, 'collaboration/Agent 同步交接.md'),
    path.join(dataRoot, 'collaboration/数据层规范.md'),
    path.join(dataRoot, 'collaboration/当前项目基线.md'),
    path.join(dataRoot, LEGACY_CHANGE_INDEX_PATH),
    path.join(dataRoot, 'skills/project-collaboration/SKILL.md'),
    path.join(projectRoot, '.agent-collaboration.md'),
  ]
  await Promise.all(obsoleteFiles.map((filePath) => rm(filePath, { force: true })))

  const gitignorePath = path.join(projectRoot, '.gitignore')
  const gitignore = await readExistingRootFile(projectRoot, '.gitignore')
  if (!gitignore) return
  const next = gitignore
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '.agent-collaboration.md')
    .join('\n')
    .replace(/\n+$/g, '')
  if (`${next}\n` !== gitignore) await atomicWriteFile(gitignorePath, next ? `${next}\n` : '')
}
