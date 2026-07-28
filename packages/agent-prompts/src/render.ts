import {
  COMPLETION_REPAIR_PROMPT,
  DESKTOP_PROJECT_OVERVIEW_PROMPT,
  INVALID_EVIDENCE_REPAIR_PROMPT,
  INVALID_PHASE_ACTION_REPAIR_PROMPT,
  NEXT_ACTION_PROMPT,
  REPOSITORY_MAP_PROMPT,
  TOOL_CATALOG_PROMPT,
} from './catalog.js'

export type PromptRunPhase = 'created' | 'loading_context' | 'inspecting' | 'planning' | 'acting' | 'awaiting_approval' | 'verifying' | 'repairing' | 'finalizing' | 'completed' | 'blocked' | 'failed' | 'cancelled'
export type PromptWorkLevel = 'light' | 'standard' | 'deep'

export function renderToolCatalogPrompt(serializedTools: string) {
  return `${TOOL_CATALOG_PROMPT.text}${serializedTools}`
}

export function renderNextActionPrompt(input: {
  phase: PromptRunPhase
  step: number
  workLevel: PromptWorkLevel
}) {
  return `${NEXT_ACTION_PROMPT.text} 当前阶段：${input.phase}；步骤：${input.step}。${phaseGuidance(input.phase, input.workLevel)}`
}

export function renderReadonlyProjectOverviewPrompt(serializedOverview: string) {
  return `${DESKTOP_PROJECT_OVERVIEW_PROMPT.text}\n${serializedOverview}`
}

export function renderRepositoryMapHeader(input: {
  discovered: string
  mapped: number
  truncated: boolean
}) {
  return [
    REPOSITORY_MAP_PROMPT.text,
    `发现 ${input.discovered} 个文件；已映射 ${input.mapped} 个${input.truncated ? '；结果已截断' : ''}。`,
    '顶层摘要：',
  ]
}

export function renderRepositoryMapDirectoryCount(fileCount: number) {
  return `${fileCount} 个已映射文件`
}

export function renderRepositoryMapTreeHeading() {
  return '目录树：'
}

export function renderRepositoryMapOmittedLines(count: number) {
  return `… 已省略 ${count} 行仓库映射`
}

export function renderCompletionRepairPrompt(blockers: Array<{ code: string; ref?: string }>) {
  const codes = blockers.map(({ code, ref }) => `${code}${ref ? `(${ref})` : ''}`).join('、')
  const instructions = [COMPLETION_REPAIR_PROMPT.text, `当前阻塞项：${codes || '未知'}。`]
  if (blockers.some(({ code }) => code === 'VERIFICATION_MISSING' || code === 'VERIFICATION_FAILED')) {
    instructions.push('对每个 VERIFICATION_MISSING 或 VERIFICATION_FAILED，必须先返回 verify，并使用 verificationPlan 中完全相同的 checkId 和命令。')
  }
  if (blockers.some(({ code }) => code === 'DIFF_MISSING' || code === 'DIFF_STALE' || code === 'DIFF_INCOMPLETE')) {
    instructions.push('必需验证完成后，调用 git_diff 获取最新最终 Diff。')
  }
  if (blockers.some(({ code }) => code === 'ACCEPTANCE_MISSING')) {
    instructions.push('完成缺失的验收项，并从 successfulEvidenceRefs 选择真实成功引用。')
  }
  instructions.push('每次只返回一个动作；处理完当前动作后再根据新的 Run 事实继续。')
  return instructions.join(' ')
}

export function renderInvalidEvidenceRepairPrompt(errorMessage: string, validRefs: string[]) {
  return [
    INVALID_EVIDENCE_REPAIR_PROMPT.text,
    `错误：${errorMessage}。`,
    `当前有效引用：${validRefs.join('、') || '无'}。`,
  ].join(' ')
}

export function renderInvalidPhaseActionRepairPrompt(input: {
  actionKind: string
  phase: PromptRunPhase
  workLevel: PromptWorkLevel
  reason: string
}) {
  const instructions = [
    INVALID_PHASE_ACTION_REPAIR_PROMPT.text,
    `被拒绝动作：${input.actionKind}；当前阶段：${input.phase}；工作等级：${input.workLevel}。`,
    `原因：${input.reason}。`,
  ]
  if (input.phase === 'inspecting' && input.workLevel !== 'light') {
    instructions.push('当前必须返回 plan；在计划被状态机接受前，不得返回 tool、verify 或 finish。')
  } else {
    instructions.push(`下一项动作必须满足 ${input.phase} 阶段规则。`)
  }
  return instructions.join(' ')
}

export function phaseGuidance(phase: PromptRunPhase, workLevel: PromptWorkLevel) {
  switch (phase) {
    case 'inspecting':
      return workLevel === 'light'
        ? '检查相关上下文；如果已充分理解这个范围有限的任务，也可以直接行动。'
        : '检查相关上下文，然后在任何修改前返回一个简洁计划。'
    case 'planning':
      return '返回一个简洁计划，保持目标和验收标准不变。'
    case 'acting':
      return '执行下一项具体工具动作；如果新证据实质推翻计划则修订计划；实现完成后开始配置的验证。'
    case 'repairing':
      return '优先执行 Run 事实 nextAction 中的修复指令；不得重复已被完成门禁拒绝的 finish。依据失败证据修复，必要时修订计划；只有恢复确实依赖外部输入时才进入阻塞。'
    case 'verifying':
      return '完成配置的检查，收集只读证据和最终 Diff，然后带证据引用结束。'
    case 'finalizing':
      return '只有验收证据完整且已引用成功的最终 Diff 时才能结束。'
    default:
      return '遵守执行协议中的阶段规则。'
  }
}
