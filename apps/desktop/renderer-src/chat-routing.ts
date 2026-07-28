export type AgentChatRoute =
  | { kind: 'chat' }
  | { kind: 'continue' }
  | { kind: 'execute'; workLevel: 'light' | 'standard' | 'deep'; depthReason?: 'architecture' | 'migration' | 'cross_system' | 'security' | 'irreversible' | 'decision' }

export type AgentTaskIntent = 'change' | 'analysis'

type RouteContext = {
  hasActiveTask: boolean
  hasResumableRun: boolean
}

const CONTINUATION_PATTERN = /^(?:可以|好(?:的)?|行|继续|继续做|推进|开始|执行|就这么做|按这个来|照这个做)[。！!~～\s]*$/i
const EXECUTION_PATTERN = /(?:^|[，,。；;！!\s])(?:(?:请|麻烦)\s*)?(?:帮我|帮忙)?\s*(?:检查|查看|看看|排查|诊断|修复|修改|改一下|改下|调整|优化|实现|新增|添加|删除|移除|重构|打包|安装|构建|运行|测试|部署|发布|提交|创建|生成|更新|推进|处理|完成|整理|同步|配置|接入)|\b(?:fix|debug|inspect|check|change|modify|update|implement|add|remove|delete|refactor|build|test|run|deploy|install|package|create|configure|integrate)\b/i
const DEEP_PATTERNS: Array<[RegExp, NonNullable<Extract<AgentChatRoute, { kind: 'execute' }>['depthReason']>]> = [
  [/(?:权限边界|授权边界|访问控制|permission)/i, 'security'],
  [/(?:安全边界|安全策略|凭据|密钥|security)/i, 'security'],
  [/(?:数据迁移|迁移脚本|migration)/i, 'migration'],
  [/(?:跨系统|跨服务|cross[- ]system)/i, 'cross_system'],
  [/(?:不可逆|irreversible)/i, 'irreversible'],
  [/(?:架构|模块边界|核心协议|schema|数据库结构|architecture)/i, 'architecture'],
]
const STANDARD_PATTERN = /(?:修复|排查|诊断|实现|新增|添加|删除|重构|打包|安装|构建|测试|部署|发布|接入|多文件|全局|feature|fix|debug|refactor|build|test|deploy|integrate)/i

export function routeAgentChatInput(input: string, context: RouteContext): AgentChatRoute {
  const prompt = String(input || '').trim()
  if (context.hasActiveTask && CONTINUATION_PATTERN.test(prompt)) {
    if (context.hasResumableRun) return { kind: 'continue' }
    return { kind: 'chat' }
  }

  if (EXECUTION_PATTERN.test(prompt)) {
    const deepMatch = DEEP_PATTERNS.find(([pattern]) => pattern.test(prompt))
    if (deepMatch) return { kind: 'execute', workLevel: 'deep', depthReason: deepMatch[1] }
    return { kind: 'execute', workLevel: STANDARD_PATTERN.test(prompt) ? 'standard' : 'light' }
  }

  return { kind: 'chat' }
}

export function inferAgentTaskIntent(input: string): AgentTaskIntent {
  const prompt = String(input || '').trim()
  return /(?:只读|不修改|不要修改|无需修改|不改动|仅查看|仅检查|read[- ]only|without (?:changing|modifying))/i.test(prompt)
    ? 'analysis'
    : 'change'
}
