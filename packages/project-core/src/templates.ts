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

export function tasksTemplate(projectName: string) {
  const now = localTime()
  return `${taskRecordsTemplate()}

## 初始化 ${projectName} 项目协作数据

id:: task-${Date.now()}-init-agent-hub
short_id:: T001
type:: task
status:: done
priority:: high
area:: tool
created:: ${now}
updated:: ${now}
version:: V001
question_refs:: 无

### 用户原话

初始化项目协作数据。

### Agent 理解

已为项目创建 Electron Manager 管理数据、agent brief 和本地协作 skill。

### 执行范围

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
`
}

export function dataSpecTemplate() {
  return `# 数据层规范

## 基本原则

- Markdown 是主数据源。
- JSON 只作为配置、同步包和可再生成缓存。
- 版本是协作记录的物理边界：任务、想法、研究、问题和风险保存在 \`versions/Vxxx/\`，工作记录保存在 \`versions/Vxxx/工作记录/YYYY-MM.md\`。
- 已完成版本默认只读；新记录只写入 \`agent-brief.json.currentDataPaths\` 指向的当前版本文件。
- 所有项目记录必须写入 \`version:: Vxxx\`，用于标识产生或主要维护阶段，避免后续检索遗漏版本上下文。
- 任务、想法、研究、问题、风险和工作记录按版本进入默认展示和检索范围；文档和项目约束是项目级资料，版本号只用于追溯，不决定是否可见。
- 任务卡必须保留用户原话、Agent 理解、执行范围和验收。
- 所有记录型 Markdown 都必须按 ID 倒序维护：较大的 \`Txxx\`、\`Ixxx\`、\`Dxxx\`、\`Wxxx\`、\`Kxxx\`、\`Lxxx\`、\`Cxxx\` 写在较小 ID 上方，例如 \`T036\` 在 \`T001\` 上面、\`D036\` 在 \`D012\` 上面。这是写入准则，不依赖界面排序或解析层重排。
- 只要修改了项目交付文件（源码、配置、测试、项目文档、知识条目或协作规则），就必须写一条 Lxxx 工作记录；普通问答、想法整理、协作元数据更新和自动生成的 agent-brief/index/基线缓存不单独写日志。
- 工作记录使用 \`record_level:: light | standard | deep\`。light 只要求用户目标、产出、修改文件、验证、验收结果和已知风险；standard 增加需求理解、验收标准、关键步骤、执行动作和后续事项；deep 保留完整记录，并补充关键判断。
- 工作记录本身是交付记录，不因为写入任务状态、问题回复、研究状态或派生缓存而递归生成新的工作记录。
- 验收标准必须在执行前定义和读取，用来约束产出、实现和验证；验证记录实际检查了什么，验收结果在验证后明确写为通过、部分通过或未通过。
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

## 详细规则

完整的数据规则和日志模板见同一数据目录下的 数据层规范.md。

- 想法/输入是收集入口，不代表承诺执行。
- 整理想法时只更新当前版本 \`想法与问题.md\` 的 \`### 回答\`，必要时创建或关联任务短 ID。
- 任务是执行单位，必须有明确状态：\`todo\`、\`doing\`、\`done\` 或 \`abandoned\`。
- Agent 开始执行任务前，把任务改为 \`doing\`；验收通过后改为 \`done\`。
- Agent 工作记录只记录任务执行、代码/文档/规则修改和验收过程，不记录单纯想法整理。

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

### 用户目标

用户希望达成什么。

### 用户原话

用户原始输入。若没有单独原话，可省略。

### 需求理解

Agent 对目标、边界、风险和上下文的理解。

### 验收标准

- 判断任务完成的标准，必须在执行前明确。

### 产出

- 已完成的可见结果。

### 关键步骤

- 最关键的实现或判断步骤。

### 关键判断

- 重要取舍和原因。

### 执行动作

- 实际执行的代码、文档或数据修改。

### 修改文件

- /absolute/path/to/file

### 验证

- 使用过的验证命令和结果。

### 验收结果

通过：逐项说明验收标准是否满足；未完全满足时写为部分通过或未通过，并说明原因。

### 已知风险

无。

### 后续事项

无。
~~~

light 文件修改记录只需保留以下章节，并标注 \`record_level:: light\`：

~~~markdown
### 用户目标
### 产出
### 修改文件
### 验证
### 验收结果
### 已知风险
~~~

标准记录使用 \`record_level:: standard\`；研究、架构、协作规则或长期知识变更使用 \`record_level:: deep\`。自动生成的 \`agent-brief.json\`、\`index.json\` 和当前基线属于派生缓存，不作为独立文件修改触发日志。
`
}

export function handoffTemplate(projectRoot: string) {
  return `# Agent 同步交接

## 启动顺序

1. 先读取 Electron Manager 管理数据目录中的 \`agent-brief.json\` 和 \`${BASELINE_PATH}\`。
2. 再读取 \`skills/project-collaboration/SKILL.md\`，写任务和工作记录时必须遵守其中规则。
3. 从 \`agent-brief.json.currentDataPaths\` 获取当前版本的实际文件路径；默认只检索这些文件。
4. 信息不足或用户指定历史版本时，再读取 \`${VERSIONS_PATH}\` 和对应 \`versions/Vxxx/\` 目录。
5. 所有项目记录都必须写入当前 \`version:: Vxxx\`；文档和项目约束的版本号只用于来源追溯，不参与版本过滤。
6. 写入或整理记录时，任务、想法、研究、文档、知识、工作记录和项目约束 Markdown 都必须按 ID 倒序维护：较大的 \`Txxx\`、\`Ixxx\`、\`Dxxx\`、\`Wxxx\`、\`Kxxx\`、\`Lxxx\`、\`Cxxx\` 写在较小 ID 上方，例如 \`T036\` 在 \`T001\` 上面。
7. 从 \`agent-brief.json.activeResearch\` 领取待研究项；处理 \`Dxxx\` 前改为 doing，同时使用 \`mode:: breadth | depth\`、\`### 内容\` 和 \`### 验收标准\`。完成后写回回答、可选 W 文档和 done 状态，最后只写一条 L 工作记录。
8. 需要长期知识时读取全局共享知识库 \`${GLOBAL_KNOWLEDGE_DIR}/\` 中的 \`Kxxx\` 条目；知识库不属于单个项目。
9. 需要当前项目全局约束时读取 \`${CONSTRAINTS_PATH}\` 中的 \`Cxxx\` 条目；系统生成的数据规范、交接说明和本地 SKILL 是只读系统约束。
10. 执行任务前设为 doing，验收后设为 done；只要修改源码、配置、测试、文档、知识或协作规则，就按 record_level 写一条 Lxxx。
11. light 只写目标、产出、修改文件、验证、验收结果、风险；standard/deep 的完整模板和字段以 数据层规范.md 为准。
12. 任务状态、问题回复、研究状态和 brief/index/基线等派生缓存不单独触发日志；想法整理只补 ### 回答。

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
record_level:: deep
question_refs:: 无

### 用户目标

初始化项目协作数据。

### 需求理解

为当前项目创建可供 Electron Manager 和其他 Agent 共同读取的本地协作数据。

### 验收标准

- Electron Manager 管理数据目录存在。
- agent-brief.json 存在。
- 本地协作 skill 存在。

### 产出

- Electron Manager 管理数据目录。
- agent-brief.json。
- 本地协作 skill。

### 关键步骤

- 创建 Markdown 主数据文件。
- 写入项目协作入口。
- 生成 Agent 同步说明。

### 执行动作

- 创建 Electron Manager 管理数据目录。
- 生成 agent-brief.json。
- 生成本地协作 skill。

### 验证

- Electron Manager 管理数据目录存在。
- agent-brief.json 存在。
- 本地协作 skill 存在。

### 验收结果

通过：项目协作数据、Agent brief 和本地协作 skill 均已生成。

### 已知风险

无。

### 后续事项

无。
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
  return `# Project Collaboration Skill

Use this skill when working on this project with Electron Manager initialized data.

## Data Root

\`${dataRoot}\`

## Start Here

1. Read \`${path.join(dataRoot, 'agent-brief.json')}\`.
2. Read the current project baseline: \`${path.join(dataRoot, BASELINE_PATH)}\`.
3. Read this skill file before writing records: \`${path.join(dataRoot, SKILL_PATH)}\`.
4. Work within the current version from \`${path.join(dataRoot, VERSIONS_PATH)}\` by default.
5. Resolve the exact current task, thought, research, question, risk, and work-log paths from \`agent-brief.json.currentDataPaths\`.
6. Read current question threads for conversations waiting on the user or Agent; read current risks for verification limits and follow-up work.
7. Read historical \`versions/Vxxx/\` directories only when the current context is insufficient or the user explicitly requests history.
8. Read \`${path.join(dataRoot, CONSTRAINTS_PATH)}\` for project-wide constraints.

## Rules

- Use the active version and the paths in \`agent-brief.json.currentDataPaths\` by default. Completed versions are read-only history; project documents, knowledge notes, and constraints remain project-wide.
- Before executing a task, set its status to \`doing\`.
- After verification, set its status to \`done\`.
- Keep all record Markdown physically ordered by descending record ID: larger \`Txxx\`, \`Ixxx\`, \`Dxxx\`, \`Wxxx\`, \`Kxxx\`, \`Lxxx\`, and \`Cxxx\` entries must appear above smaller IDs, for example \`T036\` above \`T001\` and \`D036\` above \`D012\`. This is a writing rule; do not rely on UI sorting or parser reordering to fix record order.
- Keep user wording, Agent understanding, execution scope, and acceptance explicit in tasks.
- Any change to source, configuration, tests, project documents, knowledge notes, or collaboration rules requires one agent log with \`log_short_id:: Lxxx\` and \`record_level:: light | standard | deep\`. Use \`task_short_id:: Txxx\` for real task execution and \`T000\` for a general log. Ordinary answers, thought triage, collaboration metadata updates, and generated brief/index/baseline caches do not create a separate log.
- Use \`light\` for small file changes. It requires only \`### 用户目标\`, \`### 产出\`, \`### 修改文件\`, \`### 验证\`, \`### 验收结果\`, and \`### 已知风险\`.
- Use \`standard\` for normal multi-step development and add \`### 需求理解\`, \`### 验收标准\`, \`### 关键步骤\`, \`### 执行动作\`, and \`### 后续事项\`. Use \`deep\` for research, architecture, or long-lived rule changes and keep the full log including \`### 关键判断\`.
- Define and read acceptance criteria before execution and verification when using standard or deep. Use \`### 验证\` for the checks performed, then use \`### 验收结果\` to state whether the criteria passed, partially passed, or failed.
- Keep questions append-only in the current version's 待确认事项.md: open waits for the user, decided waits for the Agent, resolved is complete. Use Qxxx only for a genuine decision, clarification, blocker, or follow-up.
- Put technical risks and non-conversational follow-ups in 风险与后续.md. Do not create inline 未确认事项 sections.
- Use Wxxx for project documents, Kxxx for shared stable knowledge, and Cxxx for project constraints. These records are independently deletable; references do not cascade.
- Shared knowledge root: \`${path.join(path.dirname(path.dirname(dataRoot)), GLOBAL_KNOWLEDGE_DIR)}\`.
- Treat agent-brief.json.activeResearch as the queue. New research creates pending D only; use mode:: breadth or mode:: depth, then write the answer, optional W document, done status, and one L log.
- Handle thoughts by adding a conclusion in ### 回答 and an optional related task. Thought triage alone does not create an L log.
- Generated brief/index/baseline files are derived caches and do not independently trigger logs.
- Runtime reads do not migrate or repair old Markdown. Initialize new projects directly; handle old-project migration separately before copying data into the current structure.
- Do not revert unrelated user or agent changes.

## Copyable Sync Prompt

\`\`\`text
请读取当前项目的 .agent-collaboration.md，找到 Electron Manager 数据目录；然后读取 agent-brief.json 和 skills/project-collaboration/SKILL.md，按这些文件中的规则建立上下文并协作。
\`\`\`
`
}
