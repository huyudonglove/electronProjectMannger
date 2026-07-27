import type {
  PermissionDecision,
  PermissionPolicy,
  RunLedger,
  ToolDefinition,
  ToolRequest,
} from '@electron-manager/agent-core'

export class DesktopAgentPermissionPolicy implements PermissionPolicy {
  decide(_request: ToolRequest, tool: ToolDefinition, _ledger: RunLedger): PermissionDecision {
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
      return {
        effect: 'ask',
        reason: `允许 Agent 使用 ${tool.name} 运行项目验证脚本？仓库脚本可能包含自定义命令。`,
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
