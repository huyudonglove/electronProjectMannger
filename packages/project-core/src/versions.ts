import { VERSIONS_PATH } from './paths.js'
import { normalizeVersionId, parseFields, parseProjectVersions } from './parsers.js'
import { versionRecordTemplate } from './record-templates.js'
import type { NewVersionInput, ProjectVersionStatus } from './types.js'
import { localTime } from './utils.js'
import { getDashboard, refreshRecordSummary } from './dashboard.js'
import {
  createId,
  insertMarkdownEntry,
  normalizeProjectVersionStatus,
  normalizeTitle,
  updateMarkdownBlocks,
} from './internal/markdown.js'
import { readProjectConfig, resolveExistingDataRoot } from './internal/project-context.js'
import { allocateShortId, mutateProjectFile, writeProjectFile } from './internal/storage.js'
import { ensureVersionRecordFiles } from './internal/version-files.js'

export async function createProjectVersion(managerDataRoot: string, projectRoot: string, input: NewVersionInput) {
  const label = normalizeTitle(input?.label || '')
  const title = normalizeTitle(input?.title || '')
  const goal = String(input?.goal || '').trim()
  if (!label) throw new Error('版本名称不能为空')
  if (!title) throw new Error('版本标题不能为空')
  if (!goal) throw new Error('版本目标不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  const shortId = await mutateProjectFile(dataRoot, VERSIONS_PATH, async (current) => {
    const versions = parseProjectVersions(current)
    const nextVersionId = await allocateShortId(dataRoot, 'V', versions.map((version) => version.shortId))
    const now = localTime()
    const entry = versionRecordTemplate({
      title,
      id: createId('version', `${label}-${title}`),
      shortId: nextVersionId,
      label,
      created: now,
      goal,
      summary: String(input.summary || '').trim() || '版本内容待维护。',
      status: normalizeProjectVersionStatus(input.status, 'planned'),
    })
    return { content: insertMarkdownEntry(current, entry), value: nextVersionId }
  })
  await ensureVersionRecordFiles(dataRoot, shortId)
  await writeProjectFile(dataRoot, 'project.json', `${JSON.stringify({ ...config, currentVersionId: shortId }, null, 2)}\n`)
  await refreshRecordSummary(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function updateProjectVersionStatus(
  managerDataRoot: string,
  projectRoot: string,
  versionId: string,
  status: ProjectVersionStatus,
) {
  const normalizedVersionId = normalizeVersionId(versionId)
  if (!normalizedVersionId) throw new Error('版本 ID 不合法')
  const nextStatus = normalizeProjectVersionStatus(status)
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  await mutateProjectFile(dataRoot, VERSIONS_PATH, (current) => {
    let updated = false
    const next = updateMarkdownBlocks(current, (block) => {
      const fields = parseFields(block)
      if (normalizeVersionId(fields.short_id) !== normalizedVersionId) return block
      updated = true
      const completed = nextStatus === 'completed' ? localTime() : '无'
      return block
        .replace(/^status::\s*.+$/m, `status:: ${nextStatus}`)
        .replace(/^completed::\s*.+$/m, `completed:: ${completed}`)
    })
    if (!updated) throw new Error(`未找到版本：${normalizedVersionId}`)
    return { content: next, value: undefined }
  })
  await refreshRecordSummary(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}
