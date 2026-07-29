import { AgentCoreError } from './errors.js'
import type { ProposedWorkItem, RunLedger, WorkChecklist, WorkItem, WorkItemKind } from './protocol.js'

export function createWorkChecklist(at: string): WorkChecklist {
  return { schemaVersion: 1, revision: 0, items: [], updatedAt: at }
}

export function replaceWorkChecklist(
  ledger: RunLedger,
  plan: { id: string; summary: string; items: ProposedWorkItem[] },
  at: string,
): RunLedger {
  validateProposedItems(plan.items)
  const previous = ledger.checklist || createWorkChecklist(ledger.startedAt)
  const existing = new Map(previous.items.map((item) => [item.id, item]))
  const items: WorkItem[] = plan.items.map((item) => {
    const current = existing.get(item.id)
    const unchanged = current && current.title === item.title && current.kind === item.kind
      && JSON.stringify(current.dependsOn) === JSON.stringify(item.dependsOn || [])
    return {
      id: item.id,
      title: item.title,
      kind: item.kind,
      status: unchanged && (current.status === 'done' || current.status === 'skipped')
        ? current.status
        : item.kind === 'inspect' && ledger.inspectedFiles.length > 0 ? 'done' : 'todo',
      dependsOn: [...(item.dependsOn || [])],
      attempt: unchanged ? current.attempt : 0,
      createdAt: unchanged ? current.createdAt : at,
      updatedAt: at,
      ...(unchanged && current.result ? { result: current.result } : item.kind === 'inspect' && ledger.inspectedFiles.length > 0 ? { result: '检查证据已记录' } : {}),
      ...(unchanged && current.evidenceRefs?.length ? { evidenceRefs: [...current.evidenceRefs] } : item.kind === 'inspect' && ledger.inspectedFiles.length > 0 ? { evidenceRefs: ledger.toolExecutions.filter((execution) => execution.result?.ok && execution.request.name === 'read_file').map((execution) => execution.request.id) } : {}),
    }
  })
  return {
    ...ledger,
    checklist: {
      schemaVersion: 1,
      revision: previous.revision + 1,
      planId: plan.id,
      planSummary: plan.summary,
      items,
      updatedAt: at,
    },
    updatedAt: at,
  }
}

export function beginWorkItem(ledger: RunLedger, kind: WorkItemKind, at: string, preferredId?: string): { ledger: RunLedger; itemId?: string } {
  const checklist = ledger.checklist
  if (!checklist?.items.length) return { ledger }
  const ready = (item: WorkItem) => item.status === 'todo'
    && item.kind === kind
    && item.dependsOn.every((id) => checklist.items.some((candidate) => candidate.id === id && ['done', 'skipped'].includes(candidate.status)))
  if (preferredId && !checklist.items.some((candidate) => candidate.id === preferredId && ready(candidate))) {
    throw new AgentCoreError('MODEL_ERROR', `Checklist item is not ready for ${kind}: ${preferredId}`)
  }
  const item = (preferredId ? checklist.items.find((candidate) => candidate.id === preferredId && ready(candidate)) : undefined)
    || checklist.items.find(ready)
  if (!item) return { ledger }
  return {
    itemId: item.id,
    ledger: updateItem(ledger, item.id, at, (current) => ({
      ...current,
      status: 'doing',
      attempt: current.attempt + 1,
      updatedAt: at,
    })),
  }
}

export function finishWorkItem(
  ledger: RunLedger,
  itemId: string | undefined,
  result: { ok: boolean; summary: string; evidenceRef?: string },
  at: string,
): RunLedger {
  if (!itemId || !ledger.checklist?.items.some((item) => item.id === itemId)) return ledger
  return updateItem(ledger, itemId, at, (item) => ({
    ...item,
    status: result.ok ? 'done' : 'todo',
    result: result.summary,
    updatedAt: at,
    ...(result.ok && result.evidenceRef ? { evidenceRefs: [...new Set([...(item.evidenceRefs || []), result.evidenceRef])] } : {}),
    ...(!result.ok ? { error: result.summary } : {}),
  }))
}

export function blockOpenWorkItems(ledger: RunLedger, reason: string, at: string): RunLedger {
  if (!ledger.checklist?.items.length) return ledger
  return {
    ...ledger,
    checklist: {
      ...ledger.checklist,
      revision: ledger.checklist.revision + 1,
      updatedAt: at,
      items: ledger.checklist.items.map((item) => ['done', 'skipped'].includes(item.status) ? item : {
        ...item,
        status: 'blocked' as const,
        error: reason,
        updatedAt: at,
      }),
    },
    updatedAt: at,
  }
}

export function checklistProgress(checklist: WorkChecklist | undefined) {
  const items = checklist?.items || []
  return {
    total: items.length,
    todo: items.filter((item) => item.status === 'todo').length,
    doing: items.filter((item) => item.status === 'doing').length,
    done: items.filter((item) => item.status === 'done').length,
    blocked: items.filter((item) => item.status === 'blocked').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
  }
}

function updateItem(ledger: RunLedger, id: string, at: string, update: (item: WorkItem) => WorkItem): RunLedger {
  const checklist = ledger.checklist
  if (!checklist) return ledger
  return {
    ...ledger,
    checklist: {
      ...checklist,
      revision: checklist.revision + 1,
      updatedAt: at,
      items: checklist.items.map((item) => item.id === id ? update(item) : item),
    },
    updatedAt: at,
  }
}

function validateProposedItems(items: ProposedWorkItem[]) {
  if (!items.length) throw new AgentCoreError('MODEL_ERROR', 'A plan must contain at least one checklist item')
  const ids = new Set<string>()
  for (const item of items) {
    if (!item.id.trim() || !item.title.trim()) throw new AgentCoreError('MODEL_ERROR', 'Checklist item id and title are required')
    if (ids.has(item.id)) throw new AgentCoreError('MODEL_ERROR', `Duplicate checklist item id: ${item.id}`)
    ids.add(item.id)
  }
  for (const item of items) {
    for (const dependency of item.dependsOn || []) {
      if (!ids.has(dependency) || dependency === item.id) {
        throw new AgentCoreError('MODEL_ERROR', `Invalid checklist dependency: ${item.id} -> ${dependency}`)
      }
    }
  }
  const byId = new Map(items.map((item) => [item.id, item]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) throw new AgentCoreError('MODEL_ERROR', `Checklist dependencies contain a cycle at: ${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of byId.get(id)?.dependsOn || []) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const item of items) visit(item.id)
}
