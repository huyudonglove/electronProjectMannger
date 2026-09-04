import path from 'node:path'

import {
  VERSIONS_PATH,
  VERSION_DIALOGUES_FILE,
  VERSION_LOGS_DIR,
  VERSION_QUESTIONS_FILE,
  VERSION_RISKS_FILE,
  VERSION_TASKS_FILE,
  VERSION_THOUGHTS_FILE,
} from '../paths.js'
import {
  normalizeVersionId,
  parseFields,
  parseProjectVersions,
  splitMarkdownBlocks,
} from '../parsers.js'
import {
  dialoguesTemplate,
  questionsTemplate,
  risksTemplate,
  taskRecordsTemplate,
  thoughtsTemplate,
} from '../templates.js'
import { localTime } from '../utils.js'
import {
  ensureProjectFile,
  listMarkdownFiles,
  readProjectFile,
} from './storage.js'

export function versionRecordPath(versionId: string, fileName: string) {
  const normalized = normalizeVersionId(versionId)
  if (!normalized) throw new Error(`版本 ID 不合法：${versionId}`)
  return path.join('versions', normalized, fileName)
}

export async function resolveWritableVersionId(
  dataRoot: string,
  requestedVersionId: string | undefined,
  defaultVersionId: string,
) {
  const candidate = requestedVersionId === undefined ? defaultVersionId : requestedVersionId
  const versionId = normalizeVersionId(candidate)
  if (!versionId) throw new Error(`版本 ID 不合法：${candidate || '空'}`)
  const versions = parseProjectVersions(await readProjectFile(dataRoot, VERSIONS_PATH))
  const version = versions.find((item) => item.shortId === versionId)
  if (!version) throw new Error(`未找到版本：${versionId}`)
  if (version.status === 'completed') throw new Error(`版本 ${versionId} 已完成，默认禁止新增记录`)
  return versionId
}

export function versionLogPath(versionId: string, created = localTime()) {
  const month = created.match(/^(\d{4}-\d{2})/)?.[1] || localTime().slice(0, 7)
  return path.join('versions', normalizeVersionId(versionId), VERSION_LOGS_DIR, `${month}.md`)
}

export async function ensureVersionRecordFiles(dataRoot: string, versionId: string) {
  await ensureProjectFile(dataRoot, versionRecordPath(versionId, VERSION_TASKS_FILE), taskRecordsTemplate())
  await ensureProjectFile(dataRoot, versionRecordPath(versionId, VERSION_THOUGHTS_FILE), thoughtsTemplate())
  await ensureProjectFile(dataRoot, versionRecordPath(versionId, VERSION_DIALOGUES_FILE), dialoguesTemplate())
  await ensureProjectFile(dataRoot, versionRecordPath(versionId, VERSION_QUESTIONS_FILE), questionsTemplate())
  await ensureProjectFile(dataRoot, versionRecordPath(versionId, VERSION_RISKS_FILE), risksTemplate())
}

export async function readVersionRecordFamily(dataRoot: string, fileName: string) {
  const files = await listVersionRecordFiles(dataRoot, fileName)
  const contents = await Promise.all(files.map((relativePath) => readProjectFile(dataRoot, relativePath)))
  return contents.flatMap(recordBlocksOnly).join('\n\n')
}

export async function listVersionRecordFiles(dataRoot: string, fileName: string) {
  return (await listMarkdownFiles(dataRoot, 'versions'))
    .filter((relativePath) => new RegExp(`^versions/V\\d+/${escapeRegExp(fileName)}$`).test(relativePath.replaceAll('\\', '/')))
    .sort()
}

export async function findVersionRecordPath(
  dataRoot: string,
  fileName: string,
  target: string,
  normalizeShortId: (value: string) => string = (value) => value,
) {
  for (const relativePath of await listVersionRecordFiles(dataRoot, fileName)) {
    const records = splitMarkdownBlocks(await readProjectFile(dataRoot, relativePath))
    if (records.some((block) => {
      const fields = parseFields(block)
      return fields.id === target
        || (fields.short_id && normalizeShortId(fields.short_id) === normalizeShortId(target))
    })) return relativePath
  }
  return ''
}

export async function readVersionLogs(dataRoot: string) {
  const files = (await listMarkdownFiles(dataRoot, 'versions'))
    .filter((relativePath) => /^versions\/V\d+\/工作记录\/\d{4}-\d{2}\.md$/.test(relativePath.replaceAll('\\', '/')))
    .sort()
  const contents = await Promise.all(files.map((relativePath) => readProjectFile(dataRoot, relativePath)))
  return contents.flatMap(recordBlocksOnly).join('\n\n')
}

function recordBlocksOnly(content: string) {
  return splitMarkdownBlocks(content).filter((block) => block.trim().startsWith('## '))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
