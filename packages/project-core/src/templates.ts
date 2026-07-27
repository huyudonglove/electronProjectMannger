import path from 'node:path'
import { localTime } from './utils.js'
import {
  BASELINE_PATH,
  CONSTRAINTS_PATH,
  DOCUMENTS_DIR,
  GLOBAL_KNOWLEDGE_DIR,
  SKILL_PATH,
  VERSIONS_PATH,
} from './paths.js'

const WORK_LEVEL_BOUNDARIES = {
  light: {
    zh: '目标单一、改动局部且可快速回退，不改变架构、数据结构、公开接口、权限或安全边界；通常在同一功能区域内完成，并可用直接检查或既有测试验证。',
    en: 'Use for one bounded goal with local, easily reversible changes. It must not change architecture, data schemas, public contracts, permissions, or security boundaries, and should be verifiable with focused checks or existing tests.',
  },
  standard: {
    zh: '一个完整的常规功能或缺陷修复，包含多个相关步骤或组件，会改变可见行为或内部协作，但方案明确、风险可控，不涉及架构、数据或协议迁移、跨系统契约或信任边界变化。',
    en: 'Use for one normal feature or fix spanning related steps or components. It may change observable behavior or internal collaboration, but it does not change architecture, data or protocol migration, cross-system contracts, or trust boundaries.',
  },
  deep: {
    zh: '仅用于架构、数据或协议迁移、跨系统契约、权限与安全边界、不可逆操作，或存在多个高影响方案必须记录取舍的工作。',
    en: 'Reserve for architecture, data or protocol migration, cross-system contracts, permission or security boundaries, irreversible work, or high-impact alternatives that require an explicit decision.',
  },
} as const

function workLevelRulesZh() {
  return `## 工作等级与合并规则

- 指令冲突时按以下顺序处理：运行时安全边界 > 用户当前明确目标与确认 > 任务验收和任务约束 > 当前项目约束 > 协作记录规则 > 计划、并行和子 Agent 启发式策略。
- 每张执行任务必须写 \`work_level:: light | standard | deep\`；它表示工作复杂度，与 \`priority:: low | medium | high\` 的紧急程度相互独立。
- \`light\`：${WORK_LEVEL_BOUNDARIES.light.zh}
- \`standard\`：${WORK_LEVEL_BOUNDARIES.standard.zh}
- \`deep\`：${WORK_LEVEL_BOUNDARIES.deep.zh}
- deep 任务必须写 \`depth_reason:: architecture | migration | cross_system | security | irreversible | decision\`，并补充“关键约束”和“方案与回退”。文件多、步骤多或耗时长本身不构成 deep。
- \`depth_reason\` 是单值主原因；优先选择直接决定验收与回退方式的原因：权限/信任边界用 security，数据或版本化协议兼容用 migration，不可逆操作用 irreversible，其次才是 architecture、cross_system、decision；其余条件写入关键约束。跨系统指独立部署、独立版本或独立责任边界的系统契约。同一应用内可随同一版本原子升级、无需新旧端共存的普通模块或 IPC 调整仍是 standard；需要新旧端并存或独立升级时才属于协议迁移。
- 命中更高等级的任一条件就使用更高等级。任务执行中范围扩大时，先更新 \`work_level\` 再继续；对应工作记录的 \`record_level\` 必须与任务最终等级一致。
- 同一用户目标、同一版本、同一功能区域、同一轮验收中的连续 light 修改允许合并为一张任务和一条工作记录。必须列全修改文件、实际动作和验证结果。
- 不得仅因为改动都很小就合并无关目标；需要独立排期、独立验收、独立发布或具有独立风险的改动必须分开。
- 当 light 修改立即执行、无需排期或后续跟踪时，可以不创建任务卡，使用 \`task_short_id:: T000\`；同一用户目标在本轮验收关闭前的小修合并为一条日志，验收关闭后的新修改必须新建 Lxxx。
- 简单明确的 light 工作直接执行，不为形式完整额外创建计划；standard、deep 或范围尚不明确的工作先建立简洁、可执行的当前计划。
- 用户目标和验收是稳定锚点，执行计划只是可替换的工作状态。执行中应按新证据动态调整计划，但不得静默改变目标；目标需要变化、无法实现或与新约束冲突时，回到用户确认。
- 不保存无价值的计划演变过程。协作数据只保留目标、当前有效范围、实际关键判断、结果和验证；中间尝试仅在形成高影响决策、风险或后续事项时记录。
- 以整体完成效率为优先：运行环境支持子 Agent 时，可将边界清楚、彼此独立、能够并行或适合专项调查的工作交给子 Agent。简单顺序工作或协调成本高于收益时不要拆分；主 Agent 始终保留目标、验收、依赖协调、结果整合和最终验证责任。
- priority 只表示紧急程度：\`high\` 仅用于阻塞当前工作、安全或数据损坏、发布关键问题；普通计划工作使用 \`medium\`；非紧急优化使用 \`low\`。priority 不得用于推断 work_level。`
}

function workLevelRulesEn() {
  return `## Work levels and merging

- Resolve instruction conflicts in this order: runtime safety boundaries > the user's current explicit goal and confirmations > task acceptance and task constraints > active project constraints > collaboration record rules > planning, parallelism, and subagent heuristics.
- Every executable task must declare \`work_level:: light | standard | deep\`. Work level describes complexity; \`priority:: low | medium | high\` describes urgency. They are independent.
- \`light\`: ${WORK_LEVEL_BOUNDARIES.light.en}
- \`standard\`: ${WORK_LEVEL_BOUNDARIES.standard.en}
- \`deep\`: ${WORK_LEVEL_BOUNDARIES.deep.en}
- A deep task must declare \`depth_reason:: architecture | migration | cross_system | security | irreversible | decision\` and include \`### 关键约束\` plus \`### 方案与回退\`. File count, step count, or duration alone never makes work deep.
- \`depth_reason\` is one primary trigger. Choose the reason that directly controls acceptance and rollback: use security for trust boundaries, migration for data or versioned-protocol compatibility, irreversible for irreversible operations, then architecture, cross_system, or decision. Put other triggers in \`### 关键约束\`. Cross-system means independently deployed, versioned, or owned systems. An internal module or IPC change that ships atomically without old/new peers coexisting is standard; independently upgraded or coexisting peers make it a protocol migration.
- Use the highest level whose boundary is triggered. If scope grows during execution, update \`work_level\` before continuing. The related log's \`record_level\` must match the task's final work level.
- Consecutive light changes may share one task and one log only when they belong to the same user goal, active version, functional area, and acceptance cycle. List every changed file, action, and verification result.
- Never merge unrelated goals merely because each change is small. Work requiring separate scheduling, acceptance, rollout, or risk tracking stays separate.
- An immediately executed light change that needs no scheduling or follow-up may skip a task card and use \`task_short_id:: T000\`. Consolidate related tweaks before the current acceptance cycle closes; changes after closure require a new Lxxx.
- Execute clear light work directly without creating a plan for ceremony. Create a concise, actionable current plan for standard, deep, or materially uncertain work.
- The user goal and acceptance criteria are the stable anchor; the execution plan is replaceable working state. Update the plan as evidence changes, but never silently change the goal. Return to the user when the goal itself must change, is infeasible, or conflicts with a new constraint.
- Do not preserve low-value plan churn. Collaboration data keeps the goal, current effective scope, actual key decisions, result, and verification; record intermediate attempts only when they create a high-impact decision, risk, or follow-up.
- Optimize for overall completion time. When the runtime supports subagents, delegate clearly bounded, independent work that can run in parallel or benefits from specialist investigation. Do not split simple sequential work or work whose coordination cost exceeds the gain. The main agent retains the goal, acceptance criteria, dependency coordination, integration, and final verification.
- Priority is urgency only: use \`high\` for current blockers, security or data-loss issues, and release-critical work; \`medium\` for normal planned work; and \`low\` for non-urgent improvements. Priority never determines work level.`
}

export function agentBriefWorkInstructions() {
  return [
    '按边界确定 work_level:: light | standard | deep：light 是单一局部且易回退的修改；standard 是方案明确的常规功能或修复；deep 仅用于架构、迁移、跨系统契约、安全边界、不可逆操作或高影响取舍，并必须记录 depth_reason、关键约束和回退。priority 只表示紧急程度。',
    '简单明确的 light 工作直接执行，只做最小必要检查；standard、deep 或范围不明确的工作先给出简洁计划。目标和验收是稳定锚点，计划按证据动态替换；不得静默改变目标，也不保存无价值的计划演变。',
    '同一目标、版本、功能区域和验收轮次中的连续 light 修改可以合并，并让 record_level 与最终 work_level 一致；无关目标、独立排期、发布或风险必须分开。无需跟踪的即时 light 工作可使用 task_short_id:: T000。',
    '运行环境支持时，以整体效率为准，可将边界清楚、彼此独立、可并行或适合专项调查的工作交给子 Agent；简单顺序工作不强行拆分，主 Agent 保留目标、验收、整合和最终验证责任。',
  ]
}

export function tasksTemplate(projectName: string) {
  const now = localTime()
  return `${taskRecordsTemplate()}

## 初始化 ${projectName} 项目协作数据

id:: task-${Date.now()}-init-agent-hub
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

初始化项目协作数据。

### 执行定义

- 创建任务、输入、研究、工作记录、文档目录和协作规则文件。
- 生成 agent-brief.json。
- 生成本地协作 skill。

### 验收

- Electron Manager 管理数据目录存在。
- agent-brief.json 存在。
- skills/project-collaboration/SKILL.md 存在。
`
}

export function taskRecordsTemplate() {
  return `# 工程任务

> 当前版本的任务数据源。每个带任务元数据的二级标题是一张任务卡。
> 写入时必须按 short_id 倒序维护：较大的 Txxx 写在较小的 Txxx 上方，例如 T036 在 T001 上面。
> 执行任务必须标注 work_level；同一目标和验收轮次内的连续 light 小修改允许合并，不得把无关事项混在一起。
`
}

export function dataSpecTemplate() {
  return `# 数据层规范

## 基本原则

- Markdown 是主数据源。
- JSON 只作为配置、同步包和可再生成缓存。
- 版本是协作记录的物理边界：任务、想法、研究、问题和风险保存在 \`versions/Vxxx/\`，工作记录保存在 \`versions/Vxxx/工作记录/YYYY-MM.md\`。
- 已完成版本默认只读；新记录只写入 \`agent-brief.json.currentDataPaths\` 指向的当前版本文件。
- 所有项目级和版本级记录必须写入 \`version:: Vxxx\`，用于标识产生或主要维护阶段，避免后续检索遗漏版本上下文；跨项目共享的全局知识除外。
- 任务、想法、研究、问题、风险和工作记录按版本进入默认展示和检索范围；文档和项目约束是项目级资料，版本号只用于追溯，不决定是否可见。
- 任务卡必须保留用户原话、执行定义和验收，并在执行前标注 \`work_level:: light | standard | deep\`。执行定义合并 Agent 对需求的理解与本次执行范围，避免重复段落。
- 简单明确的 light 工作直接执行；standard、deep 或范围不明确的工作先建立简洁可执行的当前计划，执行中按证据动态调整。用户目标和验收始终是稳定锚点，计划只是可替换的工作状态，不得静默改变目标。
- 不把中间计划演变写成长期协作负担；只保留当前有效范围、实际关键判断、结果和验证。目标需要变化、不可行或与新约束冲突时，回到用户确认。
- 以整体完成效率为优先。运行环境支持子 Agent 时，可并行委派边界清楚、彼此独立或适合专项调查的工作；简单顺序工作和协调成本高于收益的工作不拆分。主 Agent 负责目标、验收、依赖协调、结果整合和最终验证。
- 同一聚合 Markdown 内的记录必须按 ID 倒序维护：较大的 \`Txxx\`、\`Ixxx\`、\`Dxxx\`、\`Qxxx\`、\`Rxxx\`、\`Lxxx\`、\`Cxxx\`、\`Vxxx\` 写在较小 ID 上方。\`Wxxx\` 和 \`Kxxx\` 是按 ID 命名的独立文件，不适用文件内排序。这是写入准则，不依赖界面排序或解析层重排。
- 只要修改了项目交付文件（源码、配置、测试、项目文档、知识条目或协作规则），就必须写一条 Lxxx 工作记录；普通问答、想法整理、协作元数据更新和自动生成的 agent-brief/index/基线缓存不单独写日志。
- 工作记录使用 \`record_level:: light | standard | deep\`，并与关联任务最终的 \`work_level\` 保持一致。关联任务的日志只记录结果、修改文件和验证；deep 仅在执行中实际形成或改变高影响取舍时增加关键判断。只有使用 \`task_short_id:: T000\` 的即时 light 日志额外保留用户目标。
- 工作记录本身是交付记录，不因为写入任务状态、问题回复、研究状态或派生缓存而递归生成新的工作记录。
- 验收必须在任务中提前定义和读取；日志的结果直接说明完成情况，验证记录实际检查了什么，不再复制任务中的需求和验收内容。
- 研究使用 \`Dxxx\` 作为工作队列和引用 ID，保存状态、模式、概要、研究标准、结果摘要和可选详细文档引用。
- 处理 \`Dxxx\` 研究时，必须同时读取 \`mode:: breadth | depth\`、\`### 内容\` 和 \`### 验收标准\`；模式决定研究方法，验收标准决定完成口径，都不是仅供 UI 展示的备注。
- \`breadth\` 是广度研究：至少覆盖 3 条实质不同的路径、方案或视角，比较依据、优缺点、适用条件和未知项，最后排序并指出值得转入深度研究的方向。
- \`depth\` 是深度研究：聚焦一个明确对象或路径，追踪证据、源码或实现细节、约束与反例，验证关键结论，并标明置信度、剩余缺口、风险和下一步。
- 广度研究在继续搜索不再产生新的重要类别时停止；深度研究在核心问题已有证据支撑，或无法继续的阻塞条件已明确记录时停止。用户可以用验收标准覆盖或细化对应模式的默认要求。
- 新建研究只创建 \`status:: pending\` 的 D 记录，不提前创建 W 文档或 L 工作记录。Agent 开始处理时改为 \`doing\`；短结果直接写入 \`### 回答\`，较长或需要长期引用的结果完成后才创建 \`${DOCUMENTS_DIR}/\` 中的 W 文档并关联；最后改为 \`done\`，并只写一条实际完成研究的工作记录。
- 研究状态固定为 \`pending | doing | done | archived\`。当前版本中 pending 和 doing 的研究必须进入 \`agent-brief.json.activeResearch\`。
- 文档保存项目本地资料、手册、说明和附件型 Markdown，使用 \`Wxxx\` 作为引用 ID；文档不自动进入知识库。
- 文档属于项目整体，不随版本切换隐藏；历史版本和当前版本都读取同一组项目文档。文档的 \`version::\` 仅表示来源版本。
- 知识条目保存沉淀后的稳定知识、可复用结论、方案和运行经验，使用 \`Kxxx\` 作为引用 ID。
- 研究、文档和知识条目允许独立删除；删除操作不级联，引用关系只由 \`related_documents\` 等字段表达。删除 \`Dxxx\` 研究不删除关联 \`Wxxx\` 文档，删除 \`Wxxx\` 文档不改写研究引用；删除 \`Kxxx\` 知识条目会删除全局共享知识库中的 Markdown，对所有项目生效。
- 项目约束保存当前项目全局规则、长期约定和 Agent 必须遵守的协作准则，使用 \`Cxxx\` 作为引用 ID，并用 \`version:: Vxxx\` 标识来源版本；约束始终项目级可见，不参与版本过滤。系统生成的数据规范、交接说明和本地 SKILL 作为只读系统约束展示，不从用户约束文件删除。
- 数据结构、字段或文件名调整后，统一更新当前模板并单独整理已有 Markdown；没有内容写 \`无\` 或 \`暂无\`，不要把旧格式兼容逻辑塞进运行时。
- 双向协作线程写入当前版本的 \`待确认事项.md\`，使用稳定 \`Qxxx\`。每次回复都追加到 \`### 对话记录\`，不得覆盖旧消息。
- 问题状态表达下一位行动者：\`open\` 表示待用户回复，\`decided\` 表示待 Agent 跟进，\`resolved\` 表示线程已完成，\`expired\` 仅用于 Agent/系统归档已被替代或确实无关的线程，不作为用户日常操作。
- 验证限制、技术风险和后续事项写入当前版本的 \`风险与后续.md\`，使用 \`Rxxx\`，不得塞入任务、想法或工作记录的“未确认事项”。
- 工作记录仍是任务副产品，不是独立执行模块。
- 执行任务前将状态改为 doing，完成验收后改为 done。
- 输入/想法被处理时，不能只修改 status；必须写入 \`### 回答\`，说明处理结论、关联任务或不处理原因。
- 整理输入/想法时，只更新当前版本 \`想法与问题.md\` 的 \`### 回答\` 和必要任务卡；不要为单纯想法整理写 Agent 工作记录。
- 只有执行工程任务、修改代码、配置、测试、文档、知识或协作规则，或完成研究验收后，才写入 Agent 工作记录；其中真实文件修改必须至少使用 \`record_level:: light\`，单纯想法整理和协作元数据维护不写工作记录。

${workLevelRulesZh()}

## 详细规则

字段格式见下文；Agent 操作协作数据时以 \`${SKILL_PATH}\` 为完整规则来源。

- 想法/输入是收集入口，不代表承诺执行。
- 整理想法时只更新当前版本 \`想法与问题.md\` 的 \`### 回答\`，必要时创建或关联任务短 ID。
- 任务是执行单位，必须有明确状态：\`todo\`、\`doing\`、\`done\` 或 \`abandoned\`。
- Agent 开始执行任务前，把任务改为 \`doing\`；验收通过后改为 \`done\`。
- Agent 工作记录只记录任务执行、代码/文档/规则修改和验收过程，不记录单纯想法整理。

## 工程任务格式

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

\`depth_reason\`、关键约束和方案与回退只属于 deep 任务，light/standard 不生成这些字段。执行定义合并 Agent 理解和本次执行范围；任务保存意图与完成口径，工作记录不再重复这些内容。

## 输入/想法记录格式

\`\`\`markdown
## YYYY-MM-DD HH:mm 想法

id:: thought-...
short_id:: I001
status:: inbox
type:: thought
created:: YYYY-MM-DD HH:mm
version:: V001
question_refs:: 无

### 内容

用户输入原文。

### 回答

处理结论。若已转成任务，写明关联任务短 ID；若不处理，写明原因。

\`\`\`

\`status\` 表示处理状态，\`### 回答\` 表示处理结论。标记为 done/handled 前必须先补充回答。
如果想法产生真正需要用户决定的问题，在当前版本 \`待确认事项.md\` 新建独立 QID，并把 \`Ixxx\` 写入 \`source_refs\`。
如果想法被整理成任务，只在回答中写明关联任务短 ID；后续 Agent 工作记录只记录该任务真正执行和验收的过程。

## 知识条目格式

\`\`\`markdown
# 知识标题

id:: knowledge-...
short_id:: K001
type:: knowledge
status:: draft | active | archived
created:: YYYY-MM-DD HH:mm
updated:: YYYY-MM-DD HH:mm
tags:: electron, local-first
aliases:: 无
source_project:: 项目名称
source:: D123
related_records:: D123
related_tasks:: T001
related_notes:: K002
summary:: 这条知识保存的稳定结论。

## 正文

稳定知识、方案、运行经验或长期复用信息。
\`\`\`

知识条目是沉淀后的长期知识，不替代研究或文档。研究保存内容和简单回复；文档保存项目本地资料；知识条目保存详细答案、稳定结论、方案和经验。知识库位于 Electron Manager app data 外层的全局 \`${GLOBAL_KNOWLEDGE_DIR}/\` 目录，所有项目共享。知识文档被 Electron 读取或刷新 guidance 时，如果缺少 \`id\`、\`short_id\`、\`type\`、\`status\`、\`tags\`、\`source_project\`、\`summary\` 等字段，应直接补写为明确值，例如 \`无\` 或 \`暂无\`，不只依赖界面默认值。

展示规则：

- 知识库入口只展示 \`Kxxx\` 知识条目。
- 文档入口只展示项目数据目录下 \`${DOCUMENTS_DIR}/\` 文件夹中的 Markdown，不汇总任务、想法、研究、协作或工作记录等模块文件。
- \`无\`、\`暂无\` 等占位字段应保留在 Markdown 中，但不作为卡片关联信息展示。
- 研究和文档不会自动进入知识库；用户明确说“沉淀”“整理成知识库”“形成 K”，或要求 Agent 判断是否值得沉淀时，Agent 才汇总相关 \`Dxxx\`/\`Wxxx\`。
- 沉淀时应对照已有 \`Kxxx\`，判断新增、合并、更新、冲突或升华；不同主题可生成多个 \`Kxxx\`。
- 如果与已有知识冲突、缺少判断依据或需要用户选择，在当前版本 \`待确认事项.md\` 创建独立 QID，并关联相关 \`Dxxx\`/\`Wxxx\`/\`Kxxx\`；仅需补充验证或后续跟进时写入当前版本 \`风险与后续.md\`。
- 生成或更新 \`Kxxx\` 时必须写明来源项目和来源记录，例如 \`source_project:: 项目名称\`、\`source:: D003\` 和 \`related_records:: D003\`。

## 文档格式

\`\`\`markdown
# 文档标题

id:: document-...
short_id:: W001
type:: document
status:: active | archived
created:: YYYY-MM-DD HH:mm
updated:: YYYY-MM-DD HH:mm
version:: V001
tags:: document
summary:: 这份文档的简短摘要。

## 正文

项目本地手册、说明、资料或其他 Markdown 文档。
\`\`\`

文档位于项目本地 \`${DOCUMENTS_DIR}/\` 目录，使用 \`Wxxx\` 独立编号。文档和知识库都是 Markdown，但语义不同：文档是项目资料，知识库是沉淀后的稳定结论。不要自动把文档转成知识；只有用户明确要求，或用户要求 Agent 判断是否值得沉淀时，Agent 才评估并建议生成或更新 \`Kxxx\`。

删除文档时，只删除该 \`Wxxx\` 文档本身，不自动改写引用它的 \`Dxxx\` 研究记录。\`related_documents\` 只表达关系，不代表删除级联。

## 项目约束格式

\`\`\`markdown
## 约束标题

id:: constraint-...
short_id:: C001
type:: constraint
status:: active | draft | archived
scope:: project
created:: YYYY-MM-DD HH:mm
updated:: YYYY-MM-DD HH:mm
version:: V001

### 内容

需要当前项目所有 Agent 长期遵守的规则、边界或协作准则。
\`\`\`

约束位于项目本地 \`${CONSTRAINTS_PATH}\`，用于保存用户手动输入或要求 Agent 长期遵守的项目级全局规则。\`version::\` 只标识约束首次产生或主要维护的版本，约束不随版本切换隐藏。新增约束时按 \`Cxxx\` 倒序写入；删除操作只删除用户约束，不删除系统生成的数据规范、交接说明或本地 SKILL。

## 研究格式

\`\`\`markdown
## YYYY-MM-DD HH:mm 研究

id:: dialogue-...
short_id:: D123
type:: dialogue
status:: pending | doing | done | archived
created:: YYYY-MM-DD HH:mm
updated:: YYYY-MM-DD HH:mm
version:: V001
mode:: breadth | depth
tags:: research, breadth
related_tasks:: T001
related_thoughts:: I001
related_documents:: 无

### 内容

研究问题或概要。

### 回答

待研究。

### 验收标准

按广度研究默认标准执行。用户可以在这里补充或覆盖标准。
\`\`\`

当用户要求处理某条 \`Dxxx\` 研究，或 Agent 从 \`activeResearch\` 领取研究时，先把状态改为 \`doing\`，读取 \`mode::\` 和 \`### 验收标准\`，再按对应模式执行。短结果直接写入 D 的 \`### 回答\`；较长或需要长期引用的结果才创建 W 文档并写入 \`related_documents::\`。完成后把状态改为 \`done\`，最后写一条 L 工作记录。保存研究请求本身不写工作记录。

删除 \`Dxxx\` 研究时，只删除研究记录本身，不自动删除关联 \`Wxxx\` 文档。\`related_documents\` 只表达关系，不代表删除级联。

研究不替代想法或任务：方案空间、原因和证据适合研究；明确的修改要求、缺陷和待办必须进入任务；待确认事项仍使用独立 QID。

写入触发规则：

- 用户明确说“记一下”“保存到研究”“这段很重要”“后面 Agent 要知道”时，直接写入研究。
- Agent 判断某段对话值得长期保留时，先询问用户是否保存为 \`Dxxx\`。
- 学习/预研项目中，思路演进、关键问答、方案比较和技术背景都可以进入研究。
- 常规工程项目中，研究主要保存重要背景、决策、约定和上下文。
- 临时 UI 微调、已进入任务的执行细节、工作记录验收过程、待确认事项和普通聊天不写研究。

## Agent 工作记录格式

~~~markdown
## YYYY-MM-DD HH:mm 工作标题

type:: agent-log
log_short_id:: L001
created:: YYYY-MM-DD HH:mm
task_short_id:: T001
version:: V001
record_level:: standard

### 结果

完成情况及可见结果。

### 修改文件

- /absolute/path/to/file

### 验证

- 使用过的验证命令和结果。
~~~

使用 \`task_short_id:: T000\` 的即时 light 日志因为没有任务卡可回查，额外保留用户目标：

~~~markdown
### 用户目标
### 结果
### 修改文件
### 验证
~~~

deep 日志只在执行中实际形成或改变高影响取舍时，在结果之后增加 \`### 关键判断\`；完全按任务既定方案执行时省略。任务原话、执行定义、验收、关键约束和原定回退方案都留在任务卡，不复制到日志。持续风险、验证缺口和后续工作写入独立 \`Rxxx\`，日志只在结果中引用编号，不重复正文。自动生成的 \`agent-brief.json\`、\`index.json\` 和当前基线属于派生缓存，不作为独立文件修改触发日志。
`
}

export function handoffTemplate(projectRoot: string) {
  return `# Agent 同步交接

## 启动顺序

1. 先读取 Electron Manager 管理数据目录中的 \`agent-brief.json\`。
2. 再读取 \`skills/project-collaboration/SKILL.md\`；任务等级、合并和日志格式以该文件为唯一完整规则来源。
3. 只有需要人类可读的项目概览时才读取 \`${BASELINE_PATH}\`，不要默认与 agent brief 重复加载。
4. 从 \`agent-brief.json.currentDataPaths\` 获取当前版本的实际文件路径；默认只检索当前工作相关文件。
5. 信息不足或用户指定历史版本时，再读取 \`${VERSIONS_PATH}\` 和对应 \`versions/Vxxx/\` 目录。
6. 执行前标注 \`work_level:: light | standard | deep\`；工作记录的 \`record_level\` 必须与任务最终等级一致。
7. 同一目标和验收轮次中的连续 light 修改允许合并；无关目标、独立排期、独立发布或独立风险不得合并。
8. 无需排期和后续跟踪的即时 light 修改可不创建任务卡，使用 \`task_short_id:: T000\` 写一条 light 日志。
9. 简单明确的 light 工作直接执行；standard、deep 或范围不明确的工作先建立简洁计划，执行时允许动态调整，但用户目标和验收必须始终保留为稳定锚点。
10. 不记录无价值的计划演变；只保留当前有效范围、关键判断、结果和验证。目标本身需要变化时回到用户确认。
11. 以整体完成效率为优先；环境支持时，可将边界清楚、彼此独立、可并行或适合专项调查的工作交给子 Agent。简单顺序工作不强行拆分，主 Agent 保留目标、验收、整合和最终验证责任。
12. 执行任务前设为 doing，验收后设为 done；所有文件修改仍必须列入对应 Lxxx 的修改文件和验证结果。
13. 任务状态、问题回复、研究状态和 brief/index/基线等派生缓存不单独触发日志；想法整理只补 ### 回答。

## 工作流顺序

\`\`\`text
想法/输入 -> 整理回答 -> 必要时产生任务 -> 任务进入 todo/doing/done -> 任务执行并验收后写 Agent 工作记录
\`\`\`


## 本地 Skill

协作说明位于 Electron Manager 管理数据目录中的 \`skills/project-collaboration/SKILL.md\`。
`
}

export function thoughtsTemplate() {
  return `# 想法与问题

> 这里记录输入、想法、问题和待确认回复。
> 写入时必须按 short_id 倒序维护：较大的 Ixxx 写在较小的 Ixxx 上方，例如 I036 在 I001 上面。
`
}

export function dialoguesTemplate() {
  return `# 研究

> 这里记录待研究队列、广度/深度模式、结果摘要和可选详细文档引用；新建研究只写 D，完成后按需生成 W 和一条 L。
> 写入时必须按 short_id 倒序维护：较大的 Dxxx 写在较小的 Dxxx 上方，例如 D036 在 D012 上面。
`
}

export function agentLogTemplate() {
  return `${agentLogRecordsTemplate()}

## 初始化 Agent Hub

type:: agent-log
log_short_id:: L001
created:: ${localTime()}
task_short_id:: T001
version:: V001
record_level:: light

### 结果

- Electron Manager 管理数据目录。
- agent-brief.json。
- 本地协作 skill。

### 修改文件

- 项目协作入口和 Electron Manager 管理数据文件。

### 验证

- Electron Manager 管理数据目录存在。
- agent-brief.json 存在。
- 本地协作 skill 存在。
`
}

export function agentLogRecordsTemplate() {
  return `# Agent 工作记录

> 当前版本当月的执行记录。只要修改项目交付文件就必须记录；使用 record_level:: light | standard | deep 区分记录深度。写入时必须按记录 ID 倒序维护：较大的 Lxxx 写在较小的 Lxxx 上方，例如 L036 在 L001 上面。
`
}

export function changeIndexTemplate() {
  return `# 需求变更索引

> 业务范围、页面能力、交互方式和数据模型变化记录在这里。
`
}

export function constraintsTemplate() {
  return `# 项目约束

> 当前项目的全局约束、协作准则和长期规则。手动写入时使用 Cxxx、标注 version:: Vxxx，并按 short_id 倒序维护：较大的 Cxxx 写在较小的 Cxxx 上方，例如 C036 在 C001 上面。
> 系统生成的协作规则会在界面中作为只读约束展示；这里主要保存用户手动补充或要求 Agent 长期遵守的项目约束。
`
}

export function questionsTemplate() {
  return `# 待确认事项

> 这里保存使用稳定 QID 的双向协作线程。验证限制、风险和后续事项写入同版本的 风险与后续.md。
> 状态表示下一位行动者：open（待用户回复）、decided（待 Agent 跟进）、resolved（已完成）、expired（仅 Agent/系统归档）。
> 每次回复都追加到 ### 对话记录，不覆盖旧消息。
`
}

export function risksTemplate() {
  return `# 风险与后续

> 保存验证限制、技术风险和后续事项，不要求用户逐条回复。
> 类型：risk、verification、follow-up。状态：open、resolved、expired。
`
}

export function versionsTemplate(projectName: string) {
  const now = localTime()
  return `# 版本索引

> 版本是人和 Agent 共用的阶段上下文。新记录默认归入当前 active 版本。

## ${projectName} 初始版本

id:: version-${Date.now()}-initial
short_id:: V001
label:: v0.1
status:: active
created:: ${now}
completed:: 无

### 版本目标

建立当前项目的稳定协作上下文。

### 内容描述

项目初始化后的当前工作阶段。

### 主要成果

- 无。

### 遗留事项

- 无。
`
}

export function skillTemplate(projectRoot: string, dataRoot: string) {
  return `---
name: project-collaboration
description: Manage tasks, work logs, research, questions, risks, documents, knowledge, and constraints for an Electron Manager initialized project. Use whenever an Agent reads or changes project collaboration data.
---

# Project Collaboration Skill

Use this skill when working on this project with Electron Manager initialized data.

## Data Root

\`${dataRoot}\`

## Start Here

1. Read \`${path.join(dataRoot, 'agent-brief.json')}\`.
2. Use this skill as the single complete source for task levels, merging, and log structure: \`${path.join(dataRoot, SKILL_PATH)}\`.
3. Read the current baseline only when a human-readable overview is needed: \`${path.join(dataRoot, BASELINE_PATH)}\`.
4. Work within the current version from \`${path.join(dataRoot, VERSIONS_PATH)}\` by default.
5. Resolve exact current paths from \`agent-brief.json.currentDataPaths\`.
6. Read question, risk, research, knowledge, and historical records only when relevant to the current work.
7. Read \`${path.join(dataRoot, CONSTRAINTS_PATH)}\` for project-wide constraints.

## Rules

- Use the active version and the paths in \`agent-brief.json.currentDataPaths\` by default. Completed versions are read-only history; project documents, knowledge notes, and constraints remain project-wide.
- Before executing a task, set its status to \`doing\`.
- After verification, set its status to \`done\`.
- Keep entries in each aggregate Markdown file physically ordered by descending record ID: larger \`Txxx\`, \`Ixxx\`, \`Dxxx\`, \`Qxxx\`, \`Rxxx\`, \`Lxxx\`, \`Cxxx\`, and \`Vxxx\` entries appear above smaller IDs. \`Wxxx\` and \`Kxxx\` are separate files named by ID, so in-file ordering does not apply. Do not rely on UI sorting or parser reordering to fix record order.
- Keep user wording, one combined execution definition, acceptance, and \`work_level\` explicit in tasks. Deep tasks additionally require \`depth_reason\`, \`### 关键约束\`, and \`### 方案与回退\`.
- Any change to source, configuration, tests, project documents, knowledge notes, or collaboration rules requires one agent log with \`log_short_id:: Lxxx\` per task and acceptance cycle, not per changed file. Consolidate related tweaks before that cycle closes; after it closes, a new change gets a new log.
- A linked light or standard log contains only \`### 结果\`, \`### 修改文件\`, and \`### 验证\`. A deep log adds \`### 关键判断\` only when execution creates or changes a high-impact decision. A \`T000\` light log also contains \`### 用户目标\` because no task card exists.
- Define and read acceptance in the task before execution. State completion in \`### 结果\` and record checks in \`### 验证\`; do not copy task intent, scope, or acceptance into the log.
- Keep questions append-only in the current version's 待确认事项.md: open waits for the user, decided waits for the Agent, resolved is complete. Use Qxxx only for a genuine conversational decision, clarification, or blocker.
- Put technical risks and non-conversational follow-ups in 风险与后续.md. Do not create inline 未确认事项 sections.
- Store continuing risks, verification gaps, and follow-up work in one \`Rxxx\`; mention its ID in the log result instead of copying the risk text.
- Use Wxxx for project documents, Kxxx for shared stable knowledge, and Cxxx for project constraints. These records are independently deletable; references do not cascade.
- Shared knowledge root: \`${path.join(path.dirname(path.dirname(dataRoot)), GLOBAL_KNOWLEDGE_DIR)}\`.
- Treat agent-brief.json.activeResearch as the queue. New research creates pending D only; use mode:: breadth or mode:: depth, then write the answer, optional W document, done status, and one L log.
- Handle thoughts by adding a conclusion in ### 回答 and an optional related task. Thought triage alone does not create an L log.
- Generated brief/index/baseline files are derived caches and do not independently trigger logs.
- Runtime reads do not migrate or repair old Markdown. Initialize new projects directly; handle old-project migration separately before copying data into the current structure.
- Do not revert unrelated user or agent changes.

${workLevelRulesEn()}

## Record Formats

\`\`\`markdown
## Task title

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

Only deep tasks include \`depth_reason\`, \`### 关键约束\`, and \`### 方案与回退\`.

\`\`\`markdown
## Work title

type:: agent-log
log_short_id:: L001
created:: YYYY-MM-DD HH:mm
task_short_id:: T001
version:: V001
record_level:: light | standard | deep

### 结果
### 修改文件
### 验证
\`\`\`

Only deep logs with a new or changed decision insert this after \`### 结果\`:

\`\`\`markdown
### 关键判断
\`\`\`

A \`T000\` log inserts \`### 用户目标\` before \`### 结果\`.

\`\`\`markdown
## Risk or follow-up title

id:: risk-...
short_id:: R001
type:: risk-record
kind:: risk | verification | follow-up
status:: open | resolved | expired
version:: V001
created:: YYYY-MM-DD HH:mm
updated:: YYYY-MM-DD HH:mm
source_refs:: T001,L001

### 内容

### 处理建议
\`\`\`

## Copyable Sync Prompt

\`\`\`text
请读取当前项目的 .agent-collaboration.md，找到 Electron Manager 数据目录；然后读取 agent-brief.json 和 skills/project-collaboration/SKILL.md，按这些文件中的规则建立上下文并协作。
\`\`\`
`
}
