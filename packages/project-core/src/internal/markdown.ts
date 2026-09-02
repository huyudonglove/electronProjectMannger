import type {
  ProjectVersionStatus,
  ResearchMode,
} from '../types.js'
import { splitMarkdownBlocks } from '../parsers.js'

export function insertMarkdownEntry(current: string, entry: string) {
  const blocks = splitMarkdownBlocks(current)
  const preface = blocks.shift() || ''
  return `${preface.trimEnd()}\n\n${entry.trim()}\n\n${blocks.map((block) => block.trim()).filter(Boolean).join('\n\n')}\n`
}

export function updateMarkdownBlocks(content: string, update: (block: string) => string) {
  const next = splitMarkdownBlocks(content)
    .map((block, index) => {
      if (index === 0 && !block.trim().startsWith('## ')) return block.trimEnd()
      return update(block.trim())
    })
    .filter(Boolean)
    .join('\n\n')
  return `${next.trimEnd()}\n`
}

export function replaceSection(content: string, titles: string[], title: string, value: string) {
  const escaped = titles.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const pattern = new RegExp(`###\\s+(?:${escaped})\\s+[\\s\\S]*?(?=\\n### |$)`)
  const replacement = `### ${title}\n\n${value.trim()}`
  return pattern.test(content) ? content.replace(pattern, replacement) : `${content.trimEnd()}\n\n${replacement}`
}

export function normalizeTitle(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeStatus(value: string) {
  return ['backlog', 'todo', 'doing', 'done', 'abandoned'].includes(value) ? value : 'todo'
}

export function normalizeProjectVersionStatus(
  value: string | undefined,
  fallback?: ProjectVersionStatus,
): ProjectVersionStatus {
  if (['planned', 'active', 'paused', 'completed'].includes(String(value))) {
    return value as ProjectVersionStatus
  }
  if (fallback) return fallback
  throw new Error(`版本状态不合法：${value || '空'}`)
}

export function createId(prefix: string, value: string) {
  return `${prefix}-${Date.now()}-${value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'item'}`
}

export function researchModeReference(mode: ResearchMode) {
  return mode === 'depth' ? '按深度研究默认标准执行。' : '按广度研究默认标准执行。'
}
