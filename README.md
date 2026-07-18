# Electron Manager

Electron Manager is a local-first desktop workspace for managing project context, agent collaboration notes, research records, tasks, and a Markdown-based knowledge base.

It is designed for people who work with coding agents across many sessions and do not want important project context to disappear inside chat history.

## What It Does

- Opens any local project folder and creates a lightweight collaboration entry.
- Stores project management data outside the project source tree, in Electron's app data directory.
- Keeps the main data readable as Markdown.
- Tracks versioned tasks, thoughts, research records, work logs, stable questions, and risks.
- Generates an `agent-brief.json` and local collaboration skill so another agent can quickly rebuild project context.
- Provides a desktop UI for browsing project data and a shared global knowledge base.

## Current Status

This project is early but usable. The current focus is:

- local-first project memory
- agent handoff context
- research-to-knowledge workflows
- Markdown data portability
- Electron + Vue desktop UI

The product shape is still evolving through real usage. Expect data format and UI changes before a stable release.

## Screens and Concepts

Electron Manager organizes project context into a few record types:

| Area | ID | Purpose |
| --- | --- | --- |
| Thoughts | `Ixxx` | Inbox-style ideas, questions, and rough inputs. |
| Tasks | `Txxx` | Executable work items with status and acceptance criteria. |
| Research | `Dxxx` | Learning notes, Q&A, investigations, and thinking history. |
| Documents | `Wxxx` | Project-local Markdown documents, manuals, source material, and specs. |
| Knowledge | `Kxxx` | Distilled long-term knowledge, reusable answers, runbooks, and decisions. |
| Work Logs | `Lxxx` | Agent execution records after real work is done. |
| Versions | `Vxxx` | Human and agent collaboration stages with a goal, summary, and history boundary. |
| Questions | `Qxxx` | Stable decisions, clarifications, or blockers with explicit lifecycle states. |
| Risks | `Rxxx` | Verification limits, technical risks, and follow-up work that do not require a user reply. |

Research records and project documents do not automatically become knowledge notes. When you want to preserve a stable conclusion, distill one or more `Dxxx` records or `Wxxx` documents into `Kxxx` knowledge notes yourself, or ask an agent to judge whether they are worth adding.

## Tech Stack

- Electron
- Vue 3
- Vite
- TypeScript
- pnpm workspaces
- Markdown as the primary data layer

## Repository Layout

```text
apps/desktop/
  src/
    Electron main process
  preload.cjs
    Safe IPC bridge exposed to the renderer
  renderer-src/
    Vue renderer source
  renderer-vue/
    Generated Vite build output, ignored by git

packages/project-core/
  Markdown data initialization
  dashboard parsing
  project index management
  agent brief generation
  local collaboration skill/template generation

scripts/
  smoke tests
  macOS packaging helpers
```

## Getting Started

Requirements:

- Node.js
- pnpm
- macOS is the most tested platform right now

Install dependencies:

```bash
pnpm install
```

Run the desktop app:

```bash
pnpm dev
```

Build everything:

```bash
pnpm build
```

Run the smoke test:

```bash
pnpm test
```

## How Data Is Stored

For each selected project, Electron Manager creates managed data under Electron's app data directory.

On macOS this is usually:

```text
~/Library/Application Support/electron-manager/
  projects.json
  knowledge/
  projects/
    <projectId>/
      project.json
      agent-brief.json
      index.json
      record-counters.json
      versions/
        版本索引.md
        V001/
          工程任务.md
          想法与问题.md
          研究.md
          待确认事项.md
          风险与后续.md
          工作记录/
            YYYY-MM.md
      collaboration/
        数据层规范.md
        Agent 同步交接.md
        需求变更索引.md
        当前项目基线.md
      constraints/
        项目约束.md
      documents/
      skills/project-collaboration/SKILL.md
```

The selected project folder only receives a lightweight pointer file:

```text
.agent-collaboration.md
```

The full management data is not stored in your project source tree. Markdown is the primary source of truth. JSON files are used for configuration, generated indexes, and agent sync caches.

New projects are initialized directly with the current structure. Runtime reads do not migrate or repair old Markdown. If an existing project needs migration, follow [旧项目迁移说明](docs/旧项目迁移说明.md) separately.

## Agent Collaboration Flow

Another agent should start from the project pointer:

```text
.agent-collaboration.md
```

That file points to the managed data directory. The most important generated files are:

```text
<managed-data-root>/agent-brief.json
<managed-data-root>/skills/project-collaboration/SKILL.md
<managed-data-root>/collaboration/数据层规范.md
<managed-data-root>/collaboration/Agent 同步交接.md
<app-data-root>/knowledge/
```

The generated brief exposes `currentVersionRoot` and `currentDataPaths`. Agents read the current version by default and only expand into historical `versions/Vxxx/` directories when needed.

## Data Rules

Electron Manager intentionally keeps data rules explicit so humans and agents can both understand the project state.

- Tasks keep user wording, agent understanding, execution scope, and acceptance criteria.
- Version-scoped records are physically grouped under `versions/Vxxx/`. Completed versions are historical context; new records go only to the active version.
- Work logs are split by month under the owning version so no single log file grows forever.
- Record writes are serialized and atomically replaced. Persistent counters prevent IDs from being reused after deletion.
- Record Markdown is maintained in descending ID order as a writing rule: larger `Txxx`/`Ixxx`/`Dxxx`/`Wxxx`/`Kxxx`/`Lxxx` entries should appear above smaller IDs, not be fixed by UI sorting.
- Thoughts are inbox items. Triage a thought by writing an answer and optionally creating or linking a task.
- Any change to project deliverables—source, configuration, tests, project documents, knowledge notes, or collaboration rules—requires one work log. Use `record_level:: light` for small changes, `standard` for normal multi-step work, and `deep` for research, architecture, or long-lived rule changes. Ordinary answers, thought triage, collaboration metadata updates, and generated `agent-brief.json`, `index.json`, or baseline caches do not create separate logs.
- Questions are independent `Qxxx` items with `open`, `decided`, `resolved`, or `expired` status. Task, thought, and log IDs are relation labels.
- Verification limits, risks, and follow-ups are independent `Rxxx` items and never enter the pending-user-decision list.
- Research records use an explicit `breadth` or `depth` mode and a `pending`, `doing`, `done`, or `archived` status. Capturing research creates only a D record. Short results stay in D; substantial results create a linked `Wxxx` only when completed, followed by exactly one work log.
- Documents preserve project-local Markdown material and use independent `Wxxx` IDs.
- Knowledge notes preserve stable, reusable conclusions.
- The Documents view only shows Markdown files under the project-local `documents/` folder; it does not aggregate task, thought, research, collaboration, or work-log files. Documents are not automatically added to the knowledge base.
- Research records, documents, and knowledge notes can be deleted independently. Deletion does not cascade. `related_documents` and similar fields express references only; they do not imply automatic deletion or reference rewriting. Deleting a `Kxxx` knowledge note removes that global Markdown note for all projects.

Standard and deep Agent work logs should keep these sections:

```markdown
record_level:: standard | deep

### 用户目标
### 需求理解
### 验收标准
### 产出
### 关键步骤
### 执行动作
### 验证
### 验收结果
### 已知风险
### 后续事项
```

Acceptance criteria are defined before execution. Verification records the checks performed; acceptance results state whether those criteria passed, partially passed, or failed.

Light file-change logs only need:

```markdown
### 用户目标
### 产出
### 修改文件
### 验证
### 验收结果
### 已知风险
```

Every project-file change still gets a log; only the amount of detail changes.

Research records use:

```markdown
status:: pending | doing | done | archived
mode:: breadth | depth

### 内容
### 回答
### 验收标准
```

Pending and in-progress research appears in `agent-brief.json.activeResearch`. An agent sets the record to `doing`, writes the result inline or to a linked `Wxxx`, then marks it `done` and writes one completion log.

## Packaging for macOS

Build a local `.app`:

```bash
pnpm pack:mac
```

Build a zip artifact:

```bash
pnpm dist:mac
```

Build a dmg artifact:

```bash
pnpm dmg:mac
```

Current builds are ad-hoc signed and not Apple notarized. Other Mac users may need to right-click the app, choose **Open**, and confirm the security prompt.

## Development Notes

- `renderer-src/` is the Vue source.
- `renderer-vue/` is generated by Vite and ignored by git.
- `packages/project-core` owns the Markdown data layer and generated collaboration files.
- `scripts/smoke-test.mjs` exercises the core data flow.
- The app is local-first and does not require a hosted backend.

## Roadmap Ideas

- Split the current Vue app into smaller view and shared components.
- Add stronger TypeScript types for the renderer IPC API and dashboard data.
- Improve research-to-knowledge distillation workflows.
- Add richer search and filtering across research, knowledge, tasks, and logs.
- Add better release signing and notarization for macOS distribution.

## License

No license has been selected yet. Add a license before publishing the repository publicly.

---

# Electron Manager 中文说明

Electron Manager 是一个本地优先的桌面工作台，用来管理项目上下文、Agent 协作记录、研究记录、任务，以及基于 Markdown 的本地知识库。

它适合经常和 Coding Agent 多轮协作的人：当项目上下文、技术判断、研究过程和任务执行记录散落在不同聊天里时，Electron Manager 可以把这些信息沉淀到本地、可读、可移植的数据层里。

## 它能做什么

- 打开任意本地项目文件夹，并为项目创建轻量协作入口。
- 将项目管理数据保存到 Electron Manager 自己的应用数据目录，不直接塞进项目源码目录。
- 使用 Markdown 作为主要数据源，方便人和 Agent 一起阅读。
- 管理任务、想法、研究记录、知识条目、Agent 工作记录和待确认事项。
- 生成 `agent-brief.json` 和本地协作 skill，帮助新的 Agent 快速恢复项目上下文。
- 提供桌面 UI，用来浏览和更新本地项目知识层。

## 当前状态

项目还处在早期阶段，但已经可以使用。当前重点是：

- 本地优先的项目记忆
- Agent 交接上下文
- 研究记录到知识库的沉淀流程
- Markdown 数据可读性和可移植性
- Electron + Vue 桌面界面

产品形态还会随着真实使用继续变化。稳定发布前，数据格式和 UI 都可能继续调整。

## 核心概念

Electron Manager 会把项目上下文拆成几类记录：

| 区域 | ID | 用途 |
| --- | --- | --- |
| 想法 | `Ixxx` | 收集临时想法、问题、粗略输入。 |
| 任务 | `Txxx` | 需要执行的工作项，带状态和验收标准。 |
| 研究 | `Dxxx` | 学习过程、问答、调研、思路演进和判断过程。 |
| 文档 | `Wxxx` | 项目本地 Markdown 文档、手册、资料和规格说明。 |
| 知识 | `Kxxx` | 沉淀后的长期知识、可复用答案、运行手册和决策。 |
| 工作记录 | `Lxxx` | Agent 真正执行任务后的记录。 |
| 版本 | `Vxxx` | 人和 Agent 共用的协作阶段，包含目标、概要和历史边界。 |
| 协作问题 | `Qxxx` | 需要决定、澄清或解除阻塞的稳定记录。 |
| 风险与后续 | `Rxxx` | 不要求用户逐条回复的验证限制、技术风险和后续事项。 |

研究记录和项目文档不会自动进入知识库。当你希望把一段稳定结论长期保存时，可以自己把一个或多个 `Dxxx` 研究记录或 `Wxxx` 文档沉淀成 `Kxxx` 知识条目，也可以让 Agent 帮你判断是否值得沉淀。

## 技术栈

- Electron
- Vue 3
- Vite
- TypeScript
- pnpm workspaces
- Markdown 主数据层

## 仓库结构

```text
apps/desktop/
  src/
    Electron 主进程
  preload.cjs
    暴露给渲染层的安全 IPC 桥
  renderer-src/
    Vue 渲染层源码
  renderer-vue/
    Vite 构建产物，已被 git 忽略

packages/project-core/
  Markdown 数据初始化
  Dashboard 数据解析
  项目索引管理
  agent brief 生成
  本地协作 skill / 模板生成

scripts/
  smoke test
  macOS 打包辅助脚本
```

## 快速开始

环境要求：

- Node.js
- pnpm
- 当前主要在 macOS 上测试

安装依赖：

```bash
pnpm install
```

启动桌面应用：

```bash
pnpm dev
```

构建：

```bash
pnpm build
```

运行 smoke test：

```bash
pnpm test
```

## 数据存储方式

每个被打开的项目，都会在 Electron 的应用数据目录下创建一份管理数据。

macOS 下通常是：

```text
~/Library/Application Support/electron-manager/
  projects.json
  knowledge/
  projects/
    <projectId>/
      project.json
      agent-brief.json
      index.json
      record-counters.json
      versions/
        版本索引.md
        V001/
          工程任务.md
          想法与问题.md
          研究.md
          待确认事项.md
          风险与后续.md
          工作记录/
            YYYY-MM.md
      collaboration/
        数据层规范.md
        Agent 同步交接.md
        需求变更索引.md
        当前项目基线.md
      constraints/
        项目约束.md
      documents/
      skills/project-collaboration/SKILL.md
```

被管理的项目目录里只会写入一个轻量指针文件：

```text
.agent-collaboration.md
```

完整管理数据不会写进你的项目源码目录。Markdown 是主要数据源；JSON 主要用于配置、索引和 Agent 同步缓存。

## Agent 协作流程

新的 Agent 应该先读取项目里的协作入口：

```text
.agent-collaboration.md
```

这个文件会指向 Electron Manager 管理的数据目录。关键文件包括：

```text
<managed-data-root>/agent-brief.json
<managed-data-root>/skills/project-collaboration/SKILL.md
<managed-data-root>/collaboration/数据层规范.md
<managed-data-root>/collaboration/Agent 同步交接.md
<app-data-root>/knowledge/
```

`agent-brief.json` 会直接给出 `currentVersionRoot` 和 `currentDataPaths`。Agent 默认只读取当前版本，只有上下文不足或用户明确追溯时才进入历史版本目录。

## 数据规则

Electron Manager 会尽量把数据规则写清楚，让人和 Agent 都能理解项目状态。

- 任务保留用户原话、Agent 理解、执行范围和验收标准。
- 任务、想法、研究、协作问题、风险和工作记录按版本物理归档到 `versions/Vxxx/`；已完成版本作为历史，新记录只进入当前版本。
- 工作记录在版本内按月份分片，避免单个文件无限增长。
- Markdown 修改采用串行队列和原子替换；记录 ID 使用持久计数器，删除后不会复用。
- 所有记录型 Markdown 都按 ID 倒序维护：更大的 `Txxx`/`Ixxx`/`Dxxx`/`Wxxx`/`Kxxx`/`Lxxx` 应该在更小 ID 上方，这是写入准则，不靠界面排序修正。
- 想法是收集入口。整理想法时，应写入回答，并在需要时创建或关联任务。
- 只要修改源码、配置、测试、项目文档、知识条目或协作规则等交付文件，就必须写一条工作记录；小改动使用 `record_level:: light`，正常开发使用 `standard`，研究、架构和长期规则变更使用 `deep`。普通想法整理、协作元数据更新和自动生成的 brief/index/基线缓存不单独写工作记录。
- 协作线程以独立 `Qxxx` 展示，`open` 表示待用户回复，`decided` 表示待 Agent 跟进，完成后进入历史；每次回复追加保存，历史线程也能继续讨论。归档由 Agent 或系统处理，不作为用户日常操作。任务 ID、想法 ID、工作记录 ID 只是关联标签。
- 验证限制、技术风险和后续事项使用独立 `Rxxx`，不会混入需要用户决定的列表。
- 研究记录明确使用 `breadth` 广度或 `depth` 深度模式，以及 `pending / doing / done / archived` 状态。保存研究时只创建 D；短结果留在 D，较长结果完成后才创建关联 `Wxxx`，最后只写一条完成工作记录。
- 文档保存项目本地 Markdown 资料，使用独立 `Wxxx` 编号。
- 知识条目保存稳定、可复用的长期结论。
- 文档页只展示项目本地 `documents/` 文件夹里的 Markdown，不再汇总任务、想法、研究、协作或工作记录文件。文档不会自动进入知识库。
- 研究、文档、知识条目都可以独立删除，删除操作不级联。`related_documents` 等字段只表达引用关系，不代表自动删除或自动改写引用。删除 `Kxxx` 知识条目会删除全局知识库中的 Markdown，对所有项目生效。

标准和深度 Agent 工作记录建议保留这些段落：

```markdown
record_level:: standard | deep

### 用户目标
### 需求理解
### 验收标准
### 产出
### 关键步骤
### 执行动作
### 验证
### 验收结果
### 已知风险
### 后续事项
```

验收标准在执行前定义；验证记录实际检查过程，验收结果在验证后明确写为通过、部分通过或未通过。

轻量文件修改记录只需保留：

```markdown
### 用户目标
### 产出
### 修改文件
### 验证
### 验收结果
### 已知风险
```

研究记录使用：

```markdown
status:: pending | doing | done | archived
mode:: breadth | depth

### 内容
### 回答
### 验收标准
```

待研究和进行中的记录会进入 `agent-brief.json.activeResearch`。Agent 领取后改为 `doing`，完成时写回 D 或按需创建 W，再改为 `done` 并写一条完成记录。

## macOS 打包

构建本地 `.app`：

```bash
pnpm pack:mac
```

构建 zip：

```bash
pnpm dist:mac
```

构建 dmg：

```bash
pnpm dmg:mac
```

当前构建使用 ad-hoc 签名，没有做 Apple notarization。其他 Mac 用户打开时可能会看到安全提示，需要右键应用，选择 **Open**，然后确认打开。

## 开发说明

- `renderer-src/` 是 Vue 源码。
- `renderer-vue/` 是 Vite 构建产物，已被 git 忽略。
- `packages/project-core` 负责 Markdown 数据层和协作文件生成。
- `scripts/smoke-test.mjs` 用于验证核心数据流程。
- 应用是本地优先设计，不依赖后端服务。

## 后续方向

- 将当前 Vue 应用继续拆成更小的页面组件和通用组件。
- 为 renderer IPC API 和 dashboard 数据补充更强的 TypeScript 类型。
- 优化研究记录到知识库的沉淀流程。
- 增强跨研究、知识、任务、工作记录的搜索和筛选。
- 为 macOS 分发补充正式签名和 notarization。

## 开源协议

当前还没有选择开源协议。公开发布前建议添加 `LICENSE` 文件。
