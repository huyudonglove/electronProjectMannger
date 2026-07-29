import { AgentCoreError } from './errors.js'
import type { AgentGraphCursor, AgentGraphEdge, AgentGraphNode, AgentGraphSpec, RunPhase } from './protocol.js'

export const AGENT_GRAPH_REVISION = 'coder-agent-graph-v1' as const

const nodes: AgentGraphNode[] = [
  { id: 'created', label: '初始化', kind: 'entry' },
  { id: 'loading_context', label: '加载上下文', kind: 'work' },
  { id: 'inspecting', label: '检查项目', kind: 'work' },
  { id: 'planning', label: '制定清单', kind: 'work' },
  { id: 'acting', label: '执行修改', kind: 'work' },
  { id: 'awaiting_approval', label: '等待确认', kind: 'interrupt' },
  { id: 'verifying', label: '验证结果', kind: 'work' },
  { id: 'repairing', label: '修复问题', kind: 'work' },
  { id: 'finalizing', label: '汇总结果', kind: 'work' },
  { id: 'completed', label: '已完成', kind: 'terminal' },
  { id: 'blocked', label: '已阻塞', kind: 'terminal' },
  { id: 'failed', label: '执行失败', kind: 'terminal' },
  { id: 'cancelled', label: '已取消', kind: 'terminal' },
]

const active: RunPhase[] = ['created', 'loading_context', 'inspecting', 'planning', 'acting', 'awaiting_approval', 'verifying', 'repairing', 'finalizing']
const terminal: RunPhase[] = ['blocked', 'failed', 'cancelled']
const edges: AgentGraphEdge[] = [
  edge('created', 'loading_context'),
  edge('loading_context', 'inspecting'),
  edge('inspecting', 'planning', 'requires_plan'),
  edge('inspecting', 'acting', 'light_run'),
  edge('planning', 'acting', 'plan_ready'),
  edge('acting', 'verifying'),
  edge('acting', 'repairing', 'tool_failed'),
  edge('verifying', 'repairing', 'verification_failed'),
  edge('verifying', 'finalizing', 'verification_ready'),
  edge('repairing', 'acting'),
  edge('repairing', 'verifying'),
  edge('finalizing', 'repairing', 'completion_gate_failed'),
  edge('finalizing', 'completed', 'completion_gate_passed'),
  ...['inspecting', 'planning', 'acting', 'verifying', 'repairing'].map((from) => edge(from as RunPhase, 'awaiting_approval', 'interrupt')),
  ...['inspecting', 'planning', 'acting', 'verifying', 'repairing'].map((to) => edge('awaiting_approval', to as RunPhase, 'resume')),
  ...active.flatMap((from) => terminal.map((to) => edge(from, to))),
]

export const DEFAULT_AGENT_GRAPH: AgentGraphSpec = Object.freeze({
  schemaVersion: 1,
  revision: AGENT_GRAPH_REVISION,
  entryNode: 'created',
  nodes: Object.freeze(nodes.map((node) => Object.freeze(node))),
  edges: Object.freeze(edges.map((item) => Object.freeze(item))),
})

export function createAgentGraphCursor(at: string): AgentGraphCursor {
  return {
    schemaVersion: 1,
    graphRevision: DEFAULT_AGENT_GRAPH.revision,
    currentNode: DEFAULT_AGENT_GRAPH.entryNode,
    enteredAt: at,
    visitCounts: { [DEFAULT_AGENT_GRAPH.entryNode]: 1 },
    history: [],
  }
}

export function restoreAgentGraphCursor(phase: RunPhase, at: string): AgentGraphCursor {
  const cursor = createAgentGraphCursor(at)
  return phase === cursor.currentNode ? cursor : {
    ...cursor,
    currentNode: phase,
    visitCounts: { [phase]: 1 },
  }
}

export function advanceAgentGraph(cursor: AgentGraphCursor, to: RunPhase, at: string, reason?: string): AgentGraphCursor {
  if (cursor.graphRevision !== DEFAULT_AGENT_GRAPH.revision) {
    throw new AgentCoreError('INVALID_TRANSITION', `Unsupported Agent graph revision: ${cursor.graphRevision}`)
  }
  if (cursor.currentNode === to) return { ...cursor, enteredAt: at }
  if (!DEFAULT_AGENT_GRAPH.edges.some((item) => item.from === cursor.currentNode && item.to === to)) {
    throw new AgentCoreError('INVALID_TRANSITION', `Agent graph has no edge from ${cursor.currentNode} to ${to}`, {
      details: { from: cursor.currentNode, to, graphRevision: cursor.graphRevision },
    })
  }
  return {
    ...cursor,
    currentNode: to,
    enteredAt: at,
    visitCounts: { ...cursor.visitCounts, [to]: (cursor.visitCounts[to] || 0) + 1 },
    history: [...cursor.history, {
      sequence: cursor.history.length + 1,
      from: cursor.currentNode,
      to,
      at,
      ...(reason ? { reason } : {}),
    }],
  }
}

export function assertAgentGraphSpec(spec: AgentGraphSpec) {
  const nodeIds = new Set(spec.nodes.map((node) => node.id))
  if (!nodeIds.has(spec.entryNode)) throw new AgentCoreError('INVALID_INPUT', 'Agent graph entry node is missing')
  if (nodeIds.size !== spec.nodes.length) throw new AgentCoreError('INVALID_INPUT', 'Agent graph node ids must be unique')
  for (const item of spec.edges) {
    if (!nodeIds.has(item.from) || !nodeIds.has(item.to)) {
      throw new AgentCoreError('INVALID_INPUT', `Agent graph edge references an unknown node: ${item.from} -> ${item.to}`)
    }
  }
}

export function assertAgentGraphCursor(cursor: AgentGraphCursor) {
  if (cursor.graphRevision !== DEFAULT_AGENT_GRAPH.revision) {
    throw new AgentCoreError('CHECKPOINT_ERROR', `Unsupported Agent graph revision: ${cursor.graphRevision}`)
  }
  let previousTo: RunPhase | undefined
  for (let index = 0; index < cursor.history.length; index += 1) {
    const transition = cursor.history[index]!
    if (transition.sequence !== index + 1) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Agent graph history sequence must be contiguous')
    }
    if (previousTo && transition.from !== previousTo) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Agent graph history must form one continuous path')
    }
    if (!DEFAULT_AGENT_GRAPH.edges.some((item) => item.from === transition.from && item.to === transition.to)) {
      throw new AgentCoreError('CHECKPOINT_ERROR', `Agent graph history contains an undeclared edge: ${transition.from} -> ${transition.to}`)
    }
    previousTo = transition.to
  }
  if (previousTo && previousTo !== cursor.currentNode) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Agent graph history must end at the current node')
  }
  for (const count of Object.values(cursor.visitCounts)) {
    if (!Number.isInteger(count) || (count || 0) < 1) throw new AgentCoreError('CHECKPOINT_ERROR', 'Agent graph visit counts must be positive integers')
  }
}

function edge(from: RunPhase, to: RunPhase, guard?: string): AgentGraphEdge {
  return { from, to, ...(guard ? { guard } : {}) }
}
