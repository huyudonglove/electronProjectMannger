import type { ProjectRunLogInput, ProjectTask } from './types.js'

export function taskRecordTemplate(
  task: ProjectTask,
  meta: { created: string; userOriginal: string },
) {
  const deepMetadata = task.workLevel === 'deep'
    ? `depth_reason:: ${task.depthReason || 'decision'}\n`
    : ''
  const deepSections = task.workLevel === 'deep'
    ? `
### 关键约束

${task.constraints}

### 方案与回退

${task.planRollback}
`
    : ''
  return `## ${task.title}

id:: ${task.id}
short_id:: ${task.shortId}
type:: task
status:: ${task.status}
priority:: ${task.priority}
work_level:: ${task.workLevel}
${deepMetadata}area:: ${task.area}
created:: ${meta.created}
updated:: ${task.updated}
version:: ${task.version}

### 用户原话

${meta.userOriginal}

### 执行定义

${task.detail}

### 验收

${task.acceptance}
${deepSections}`
}

export function thoughtRecordTemplate(input: {
  id: string
  shortId: string
  created: string
  version: string
  content: string
}) {
  return `## ${input.created} 想法

id:: ${input.id}
short_id:: ${input.shortId}
status:: inbox
type:: thought
created:: ${input.created}
version:: ${input.version}

### 内容

${input.content}

### 回答

暂无。
`
}

export function dialogueRecordTemplate(input: {
  id: string
  shortId: string
  created: string
  version: string
  mode: string
  content: string
  acceptance: string
}) {
  return `## ${input.created} 研究

id:: ${input.id}
short_id:: ${input.shortId}
type:: dialogue
status:: pending
created:: ${input.created}
updated:: ${input.created}
version:: ${input.version}
mode:: ${input.mode}
tags:: research
related_tasks:: 无
related_thoughts:: 无
related_documents:: 无

### 内容

${input.content}

### 回答

待研究。

### 验收标准

${input.acceptance}
`
}

export function constraintRecordTemplate(input: {
  title: string
  id: string
  shortId: string
  status: string
  scope: string
  created: string
  version: string
  content: string
}) {
  return `## ${input.title}

id:: ${input.id}
short_id:: ${input.shortId}
type:: constraint
status:: ${input.status}
scope:: ${input.scope}
created:: ${input.created}
updated:: ${input.created}
version:: ${input.version}

### 内容

${input.content}
`
}

export function versionRecordTemplate(input: {
  title: string
  id: string
  shortId: string
  label: string
  created: string
  goal: string
  summary: string
}) {
  return `## ${input.title}

id:: ${input.id}
short_id:: ${input.shortId}
label:: ${input.label}
status:: active
created:: ${input.created}
completed:: 无

### 版本目标

${input.goal}

### 内容描述

${input.summary}

### 主要成果

- 无。

### 遗留事项

- 无。
`
}

export function questionRecordTemplate(input: {
  title: string
  id: string
  shortId: string
  status: string
  kind: string
  scope: string
  version: string
  blocking: string
  created: string
  relations: string
  origin: string
  role: string
  question: string
  background: string
  recommendation: string
}) {
  return `## ${input.title}

id:: ${input.id}
short_id:: ${input.shortId}
type:: question
status:: ${input.status}
kind:: ${input.kind}
scope:: ${input.scope}
version:: ${input.version}
blocking:: ${input.blocking}
created:: ${input.created}
updated:: ${input.created}
source_refs:: ${input.relations}
origin:: ${input.origin}

### 问题

${input.question}

### 背景

${input.background}

### 建议

${input.recommendation}

### 结论

待确认。

### 对话记录

#### ${input.role} · ${input.created}

${input.question}
`
}

export function projectRunLogRecordTemplate(input: ProjectRunLogInput & { shortId: string; created: string }) {
  const decisions = input.recordLevel === 'deep' && input.decisions.length
    ? `\n### 关键判断\n\n${markdownList(input.decisions)}\n`
    : ''
  return `## ${singleLine(input.title) || 'Agent Run 工作记录'}

type:: agent-log
log_short_id:: ${input.shortId}
created:: ${input.created}
task_short_id:: ${singleLine(input.taskShortId)}
version:: ${singleLine(input.version)}
record_level:: ${input.recordLevel}
source:: ${singleLine(input.source)}
idempotency_key:: ${singleLine(input.idempotencyKey)}

### 结果

${markdownList(input.result)}
${decisions}

### 修改文件

${markdownList(input.changedFiles)}

### 验证

${markdownList(input.verification)}
`
}

function markdownList(values: string[]) {
  const normalized = values.map(singleLine).filter(Boolean)
  return normalized.length ? normalized.map((value) => `- ${value}`).join('\n') : '- 无。'
}

function singleLine(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}
