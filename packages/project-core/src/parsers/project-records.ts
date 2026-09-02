import { CONSTRAINTS_PATH } from '../paths.js'
import type {
  ProjectConstraint,
  ProjectDialogue,
  ProjectTask,
  ProjectThought,
} from '../types.js'
import {
  firstContentSummary,
  parseFields,
  readSection,
  splitMarkdownBlocks,
} from './markdown.js'
import {
  compareShortIdDesc,
  normalizeConstraintShortId,
  normalizeConstraintStatus,
  normalizeDepthReason,
  normalizeDialogueShortId,
  normalizeResearchMode,
  normalizeResearchStatus,
  normalizeVersionId,
  normalizeWorkLevel,
  parseDisplayTimeKey,
  splitRefs,
} from './normalizers.js'

export function parseProjectTasks(content: string): ProjectTask[] {
  return splitMarkdownBlocks(content)
    .filter((block) => block.trim().startsWith('## '))
    .map((block) => {
      const fields = parseFields(block)
      return {
        id: fields.id || '',
        shortId: fields.short_id || '',
        title: block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '未命名任务',
        status: fields.status || 'todo',
        priority: fields.priority || 'medium',
        workLevel: normalizeWorkLevel(fields.work_level),
        depthReason: normalizeDepthReason(fields.depth_reason),
        area: fields.area || 'tool',
        updated: fields.updated || fields.created || '',
        version: normalizeVersionId(fields.version),
        userOriginal: readSection(block, ['用户原话']),
        detail: readSection(block, ['执行定义']),
        acceptance: readSection(block, ['验收']),
        constraints: readSection(block, ['关键约束']),
        planRollback: readSection(block, ['方案与回退']),
      }
    })
}

export function parseThoughts(content: string): ProjectThought[] {
  return splitMarkdownBlocks(content)
    .filter((block) => block.trim().startsWith('## '))
    .map((block) => {
      const fields = parseFields(block)
      return {
        id: fields.id || '',
        shortId: fields.short_id || '',
        title: block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '输入',
        status: fields.status || 'inbox',
        created: fields.created || '',
        version: normalizeVersionId(fields.version),
        content: readSection(block, ['内容']),
        answer: readSection(block, ['回答']),
      }
    })
}

export function parseUserConstraints(content: string): ProjectConstraint[] {
  return splitMarkdownBlocks(content)
    .filter((block) => block.trim().startsWith('## '))
    .map((block) => {
      const fields = parseFields(block)
      const constraintContent = readSection(block, ['内容']) || firstContentSummary(block)
      const title = block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '项目约束'
      return {
        id: fields.id || '',
        shortId: normalizeConstraintShortId(fields.short_id),
        title,
        status: normalizeConstraintStatus(fields.status || 'active'),
        scope: fields.scope || 'project',
        version: normalizeVersionId(fields.version),
        source: 'user' as const,
        created: fields.created || '',
        updated: fields.updated || fields.created || '',
        path: CONSTRAINTS_PATH,
        summary: firstContentSummary(constraintContent) || title,
        content: block.trim(),
      }
    })
    .sort((a, b) => b.shortId.localeCompare(a.shortId) || parseDisplayTimeKey(b.updated).localeCompare(parseDisplayTimeKey(a.updated)))
}

export function parseDialogues(content: string): ProjectDialogue[] {
  return splitMarkdownBlocks(content)
    .filter((block) => block.trim().startsWith('## '))
    .map((block) => {
      const title = block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '研究'
      const fields = parseFields(block)
      return {
        id: fields.id || '',
        shortId: normalizeDialogueShortId(fields.short_id),
        title,
        created: fields.created || '',
        updated: fields.updated || fields.created || '',
        version: normalizeVersionId(fields.version),
        status: normalizeResearchStatus(fields.status),
        mode: normalizeResearchMode(fields.mode),
        tags: splitRefs(fields.tags),
        relatedTasks: splitRefs(fields.related_tasks),
        relatedThoughts: splitRefs(fields.related_thoughts),
        relatedDocuments: splitRefs(fields.related_documents),
        recordContent: readSection(block, ['内容']),
        answer: readSection(block, ['回答']),
        acceptance: readSection(block, ['验收标准']),
        content: block.trim(),
      }
    })
    .sort((a, b) => compareShortIdDesc(a.shortId, b.shortId, 'D') || dialogueSortKey(b).localeCompare(dialogueSortKey(a)))
}

export function dialogueSortKey(dialogue: Pick<ProjectDialogue, 'created' | 'title' | 'shortId'>) {
  return [
    parseDisplayTimeKey(dialogue.created || dialogue.title),
    dialogue.shortId,
  ].join('\u0000')
}
