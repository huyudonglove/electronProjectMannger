import { createHash } from 'node:crypto'

import type { Dashboard, ProjectTask } from '@electron-manager/project-core'

import type { ProjectAdapterIssue, ProjectAdapterIssueCode } from './types.js'

export function findTask(dashboard: Dashboard, id: string): ProjectTask | undefined {
  const target = String(id || '').trim()
  return dashboard.tasks.find((task) => task.id === target || task.shortId === target)
}

export function activeTask(status: string) {
  return ['backlog', 'todo', 'doing'].includes(status)
}

export function isPlaceholder(value: string) {
  const normalized = String(value || '').trim().toLowerCase()
  return !normalized || /^(?:待补充|待定|todo|tbd|n\/a|无)[。.!！]?$/.test(normalized)
}

export function splitMarkdownRequirements(value: string): string[] {
  const normalized = String(value || '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const lines = normalized.split('\n')
  const bullets: string[] = []
  let current = ''
  let sawBullet = false
  for (const rawLine of lines) {
    const line = rawLine.trim()
    const match = line.match(/^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/)
    if (match) {
      if (current) bullets.push(current)
      current = match[1]!.trim()
      sawBullet = true
    } else if (sawBullet && line) {
      current = `${current} ${line}`.trim()
    }
  }
  if (current) bullets.push(current)
  const values = sawBullet
    ? bullets
    : normalized.split(/\n\s*\n+/).map((item) => item.replace(/\s+/g, ' ').trim())
  return deduplicate(values.filter((item) => item && !isPlaceholder(item)))
}

export function deduplicate(values: string[]) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

export function adapterIssue(
  code: ProjectAdapterIssueCode,
  field: string,
  message: string,
  refs?: string[],
  severity: ProjectAdapterIssue['severity'] = 'error',
): ProjectAdapterIssue {
  return { code, severity, field, message, ...(refs?.length ? { refs: [...refs] } : {}) }
}

export function stableKey(parts: string[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}
