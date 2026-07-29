import type {
  PermissionDecision,
  PermissionPolicy,
  RunLedger,
  ToolDefinition,
  ToolRequest,
} from '@electron-manager/agent-core'

export class DesktopAgentPermissionPolicy implements PermissionPolicy {
  decide(_request: ToolRequest, tool: ToolDefinition, ledger: RunLedger): PermissionDecision {
    if (tool.risk === 'read' || tool.risk === 'project_write') {
      return {
        effect: 'allow',
        reason: tool.risk === 'read'
          ? 'Project-scoped read tools are allowed automatically.'
          : 'Project-scoped file changes are allowed for an explicitly started Agent task.',
        matchedRuleId: `desktop.${tool.risk}.allow`,
      }
    }
    if (tool.risk === 'process') {
      if (hasApprovedToolInRun(ledger, tool.name)) {
        return {
          effect: 'allow',
          reason: `本次运行已经批准过 ${tool.name}，后续同类项目命令自动继续。`,
          matchedRuleId: 'desktop.process.run-approved',
        }
      }
      return {
        effect: 'ask',
        reason: `允许 Agent 在本次 Run 中使用 ${tool.name} 运行项目命令？批准后，本次 Run 后续同类命令不再重复询问。`,
        matchedRuleId: 'desktop.process.ask',
      }
    }
    return {
      effect: 'deny',
      reason: `Desktop Agent does not allow ${tool.risk} tools.`,
      matchedRuleId: 'desktop.unsupported.deny',
    }
  }
}

function hasApprovedToolInRun(ledger: RunLedger, toolName: string) {
  const approvedDigests = new Set((ledger.approvals || [])
    .filter((approval) => approval.scope === 'tool' && approval.decision === 'approved')
    .map((approval) => approval.actionDigest))
  return (ledger.toolExecutions || []).some((execution) =>
    execution.request.name === toolName && approvedDigests.has(execution.request.actionDigest))
}
