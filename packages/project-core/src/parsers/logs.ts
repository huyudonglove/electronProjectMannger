import type { ProjectLog, ProjectTask } from '../types.js'
import {
  parseFields,
  readListSection,
  readSection,
  splitMarkdownBlocks,
} from './markdown.js'
import {
  normalizeLogLevel,
  normalizeLogShortId,
  normalizeTaskShortId,
  normalizeVersionId,
} from './normalizers.js'

export function parseProjectLogs(content: string, tasks: ProjectTask[] = []): ProjectLog[] {
  const taskByShortId = new Map(tasks.map((task) => [task.shortId, task]))
  const parsedLogs = splitMarkdownBlocks(content)
    .filter((block) => block.trim().startsWith('## '))
    .map((block, index) => {
      const fields = parseFields(block)
      const relatedTasks = logTaskRefs(block, fields)
        .map((shortId) => {
          const task = taskByShortId.get(shortId)
          return {
            shortId,
            id: task?.id || '',
            title: task?.title || '',
            status: task?.status || '',
          }
        })
      return {
        shortId: normalizeLogShortId(fields.log_short_id),
        title: block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '工作记录',
        created: fields.created || '',
        status: fields.status || relatedTasks[0]?.status || 'done',
        source: fields.source || '',
        recordLevel: normalizeLogLevel(fields.record_level),
        version: normalizeVersionId(fields.version),
        userGoal: readSection(block, ['用户目标']),
        result: readSection(block, ['结果']),
        decisions: readListSection(block, ['关键判断']),
        changedFiles: readListSection(block, ['修改文件']),
        verification: readListSection(block, ['验证']),
        relatedTasks,
        content: block.trim(),
        sortKey: projectLogSortKey(block, fields.created, index),
      }
    })
  return parsedLogs
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    .map(({ sortKey: _sortKey, ...log }) => log)
}

export function logTaskRefs(_block: string, fields: Record<string, string>) {
  const explicitRefs = [
    fields.task_short_id,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[,，\s]+/))
  const refs = [...new Set(explicitRefs.map(normalizeTaskShortId).filter(Boolean))]
  return refs.length ? refs : ['T000']
}

export function projectLogSortKey(block: string, created: string, order: number) {
  const title = block.match(/^##\s+(.+)$/m)?.[1] || ''
  const titleTime = title.match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/)
  const date = titleTime?.[1] || created.slice(0, 10) || '0000-00-00'
  const time = titleTime?.[2] || created.match(/\d{2}:\d{2}/)?.[0] || '00:00'
  const reverseOrder = 999999 - order
  return `${date} ${time} ${String(reverseOrder).padStart(6, '0')}`
}
