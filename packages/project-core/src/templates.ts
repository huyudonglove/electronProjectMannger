import path from 'node:path'

import { localTime } from './utils.js'
import {
  BASELINE_PATH,
  CONSTRAINTS_PATH,
  DATA_SPEC_PATH,
  DOCUMENTS_DIR,
  GLOBAL_KNOWLEDGE_DIR,
  RECORD_COUNTERS_PATH,
  RECORD_SUMMARY_PATH,
  VERSIONS_PATH,
} from './paths.js'

export function tasksTemplate(projectName: string) {
  const now = localTime()
  return `${taskRecordsTemplate()}

## 初始化 ${projectName} 项目记录

id:: task-${Date.now()}-init-records
short_id:: T001
type:: task
status:: done
priority:: medium
work_level:: light
area:: tool
created:: ${now}
updated:: ${now}
version:: V001

### 用户原话

初始化项目记录。

### 执行定义

创建任务、想法、研究、问题、风险、工作记录、文档、知识和约束的数据目录与索引。

### 验收

- Electron Manager 管理数据目录存在。
- ${RECORD_SUMMARY_PATH} 和 index.json 存在。
`
}

export function taskRecordsTemplate() {
  return `# 工程任务

> 当前版本的任务记录。每个带任务元数据的二级标题是一张独立任务卡。
> 写入时按 short_id 倒序维护；状态使用 todo、doing、done 或 abandoned。
`
}

export function dataSpecTemplate() {
  return `# 数据层规范

## 基本原则

- Markdown 是记录的主数据源；JSON 仅保存配置、索引和可再生成摘要。
- 版本是记录的物理边界：任务、想法、研究、问题和风险保存在 \`versions/Vxxx/\`，工作记录保存在 \`versions/Vxxx/工作记录/YYYY-MM.md\`。
- 已完成版本默认只读；新记录写入 \`${RECORD_SUMMARY_PATH}\` 的 \`currentDataPaths\` 所指向的当前版本文件。
- 项目文档保存在 \`${DOCUMENTS_DIR}/\`，项目约束保存在 \`${CONSTRAINTS_PATH}\`，全局知识保存在 \`${GLOBAL_KNOWLEDGE_DIR}/\`。
- 聚合 Markdown 内的 Txxx、Ixxx、Dxxx、Qxxx、Rxxx、Lxxx、Cxxx、Vxxx 按编号倒序维护；Wxxx 和 Kxxx 使用独立文件。
- 记录间的引用只表达来源或关联，不级联删除。
- 工作记录使用 \`record_level:: light | standard | deep\`，记录结果、修改文件、验证和必要的关键判断。
- 研究使用 \`status:: pending | doing | done | archived\` 与 \`mode:: breadth | depth\`；长结果可关联 Wxxx 文档。
- 问题状态使用 \`open | decided | resolved | expired\`，回复只追加到对话记录。
- 风险状态使用 \`open | resolved | expired\`，类型使用 \`risk | verification | follow-up\`。
- 运行时读取不负责迁移或修复旧 Markdown；旧项目迁移应作为独立流程执行。

## 任务格式

\`\`\`markdown
## 任务标题

id:: task-...
short_id:: T001
type:: task
status:: todo | doing | done | abandoned
priority:: low | medium | high
work_level:: light | standard | deep
depth_reason:: architecture | migration | cross_system | security | irreversible | decision
area:: tool
created:: YYYY-MM-DD HH:mm
updated:: YYYY-MM-DD HH:mm
version:: V001

### 用户原话
### 执行定义
### 验收
### 关键约束
### 方案与回退
\`\`\`

只有 deep 任务包含 depth_reason、关键约束和方案与回退。

## 工作记录格式

\`\`\`markdown
## 工作标题

type:: work-log
log_short_id:: L001
created:: YYYY-MM-DD HH:mm
task_short_id:: T001
version:: V001
record_level:: light | standard | deep

### 结果
### 修改文件
### 验证
\`\`\`

deep 记录在确有高影响取舍时增加 \`### 关键判断\`。

## 研究格式

\`\`\`markdown
## 研究标题

id:: dialogue-...
short_id:: D001
type:: dialogue
status:: pending | doing | done | archived
mode:: breadth | depth
version:: V001
related_tasks:: T001
related_thoughts:: I001
related_documents:: W001

### 内容
### 回答
### 验收标准
\`\`\`

## 文档与知识格式

项目文档使用 Wxxx，保存在 \`${DOCUMENTS_DIR}/\`；全局知识使用 Kxxx，保存在 \`${GLOBAL_KNOWLEDGE_DIR}/\`。两者均为独立 Markdown 文件，删除时不级联删除引用记录。

## 问题、风险与约束格式

Qxxx 保存问题与追加式回复；Rxxx 保存风险、验证缺口和后续事项；Cxxx 保存项目级约束。所有记录都保留 version 字段用于追溯来源。
`
}

export function thoughtsTemplate() {
  return `# 想法与问题

> 当前版本的输入记录。每条记录使用 Ixxx，并按编号倒序维护。
`
}

export function dialoguesTemplate() {
  return `# 研究

> 当前版本的研究记录。每条记录使用 Dxxx，并按编号倒序维护。
`
}

export function constraintsTemplate() {
  return `# 项目约束

> 保存用户维护的项目级规则和边界。每条记录使用 Cxxx，并按编号倒序维护。
`
}

export function questionsTemplate() {
  return `# 待确认事项

> 每条问题使用 Qxxx。open 表示待答复，decided 表示待跟进，resolved 表示完成，expired 表示不再适用。
> 每次回复追加到对话记录，不覆盖历史消息。
`
}

export function risksTemplate() {
  return `# 风险与后续

> 每条记录使用 Rxxx，类型为 risk、verification 或 follow-up，状态为 open、resolved 或 expired。
`
}

export function versionsTemplate(projectName: string) {
  const now = localTime()
  return `# 版本索引

> 每个版本使用 Vxxx，并按编号倒序维护。

## ${projectName} 初始版本

id:: version-${Date.now()}-initial
short_id:: V001
label:: 初始版本
status:: active
created:: ${now}
completed:: 无

### 版本目标

建立项目记录基线。

### 内容描述

初始化任务、想法、研究、问题、风险、工作记录、文档、知识和约束。

### 主要成果

- 初始化项目记录结构。

### 遗留事项

- 无。
`
}

export function workLogTemplate() {
  return `${workLogRecordsTemplate()}

## 初始化项目记录

type:: work-log
log_short_id:: L001
created:: ${localTime()}
task_short_id:: T001
version:: V001
record_level:: light
source:: system

### 结果

- 创建项目记录目录和基础索引。

### 修改文件

- ${RECORD_SUMMARY_PATH}
- index.json
- ${BASELINE_PATH}
- ${VERSIONS_PATH}

### 验证

- 项目记录可被读取。
`
}

export function workLogRecordsTemplate() {
  return `# 工作记录

> 按月份保存已完成工作的结果、修改文件和验证信息。每条记录使用 Lxxx，并按编号倒序维护。
`
}

export function changeIndexTemplate() {
  return `# 需求变更索引

> 保存需求变化与相关记录编号；不保存执行状态或运行信息。
`
}

export function recordSkillTemplate(dataRoot: string) {
  return `---
name: project-records
description: Read and maintain Electron Manager project records when work requires reading or updating the project's durable task, idea, research, question, risk, constraint, document, knowledge, version, or work-log data.
---

# Electron Manager Project Records

Use this skill only for the project's durable record layer.

## Locate Records

1. Read \`${path.join(dataRoot, RECORD_SUMMARY_PATH)}\`.
2. Use \`currentDataPaths\` from that summary for current-version tasks, ideas, research, questions, risks, and work logs.
3. Use \`${path.join(dataRoot, DATA_SPEC_PATH)}\` for the current Markdown schemas and ordering rules.
4. Use \`dataRoot\` and \`knowledgeRoot\` from the summary to locate project-wide and shared records.

## Write Records

- T records are tasks in \`currentDataPaths.tasks\`.
- I records are ideas in \`currentDataPaths.thoughts\`.
- D records are research in \`currentDataPaths.research\`.
- Q records are append-only questions and replies in \`currentDataPaths.questions\`.
- R records are risks, verification gaps, and follow-ups in \`currentDataPaths.risks\`.
- L records are monthly work logs under \`currentDataPaths.workLogs\`; new entries use \`type:: work-log\`.
- C records are project constraints in \`${path.join(dataRoot, CONSTRAINTS_PATH)}\`.
- W records are project documents under \`${path.join(dataRoot, DOCUMENTS_DIR)}\`.
- K records are shared knowledge under \`knowledgeRoot\`.
- V records are version metadata in \`${path.join(dataRoot, VERSIONS_PATH)}\`.

Write new version-scoped records only to the active version. Keep aggregate Markdown records ordered by descending short ID, and never reuse a previously allocated ID.

## Safe Direct Writes

- Do not write while Electron Manager or another agent is changing the same project records.
- Immediately before allocating an ID, re-read the target Markdown and \`${path.join(dataRoot, RECORD_COUNTERS_PATH)}\`. Choose the next unused ID above both the stored counter and every observed ID, then advance the matching counter when adding the record.
- For tracked work, set its T record to \`doing\`; after the requested verification succeeds, set it to \`done\` and write one L work log for completed code, configuration, or documentation changes.
- Use \`task_short_id:: T000\` only for immediate light work that does not need a task card.

## Preserve Existing Data

- Preserve completed-version and historical Markdown verbatim unless the user explicitly requests a migration.
- Re-read a target before writing and preserve unrelated records and user changes.
- Keep references non-owning: deleting one record does not delete referenced documents, knowledge, or other records.
- Do not replace \`${RECORD_SUMMARY_PATH}\`, \`index.json\`, or the generated baseline with handwritten source data; refresh those derived files through Electron Manager.
`
}
