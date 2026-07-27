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
- Runs eligible project tasks with a checkpointed local Agent and synchronizes completed work back to the task and work log.

## Current Status

This project is early but usable. The local project-management flow and the first end-to-end desktop Agent flow are implemented:

- local-first project memory
- agent handoff context
- research-to-knowledge workflows
- Markdown data portability
- OpenAI Responses model settings with OS-encrypted API-key storage
- task-level Agent runs with local checkpoints, progress events, approval handling, cancellation, and project-record synchronization
- a project-scoped local tool runtime for inspection, file edits, Git status/diff, and repository verification scripts

The product shape is still evolving through real usage. Expect data format, Agent policy, and UI changes before a stable release. Automated tests do not replace a live OpenAI run or packaged-app verification on the target Mac.

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
    Electron main process, Agent IPC, and safe-storage adapter
  preload.cjs
    Explicit IPC bridge exposed to the renderer
  renderer-src/
    Vue UI, including Agent settings and task-run controls
  renderer-vue/
    Generated Vite build output, ignored by git

packages/project-core/
  Markdown project data, dashboards, indexes, and generated collaboration context

packages/agent-core/
  Run ledger, step state machine, approval protocol, and checkpoint contracts
packages/agent-config/             Layered Agent configuration and tool policy
packages/agent-context/            Budgeted context assembly and caching
packages/agent-memory/             Deterministic session compaction
packages/agent-model-router/       Model selection, retry, and snapshot compatibility
packages/agent-runtime-local/      Project-scoped files, Git reads, and restricted commands
packages/agent-output/             Durable large-output artifacts
packages/agent-repo-map/           Repository map context
packages/agent-checkpoint-sqlite/  SQLite run checkpoints
packages/agent-provider-openai/    OpenAI Responses provider and SSE transport
packages/agent-runner/             Headless composition and run repository
packages/agent-project-adapter/    Project task input and completion synchronization
packages/agent-credential-vault/   Encrypted credential persistence
packages/agent-desktop-config/     Desktop defaults, settings, providers, and permissions
packages/agent-desktop-coordinator/ Desktop run lifecycle and renderer-facing views

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

Run all automated Agent tests and the project-core smoke test:

```bash
pnpm test
```

Useful narrower checks:

```bash
pnpm build:agent
pnpm test:agent
```

An optional live provider smoke test requires `OPENAI_API_KEY` and makes a real API request:

```bash
pnpm --filter @electron-manager/agent-provider-openai smoke:live
```

## How Data Is Stored

For each selected project, Electron Manager creates managed data under Electron's app data directory.

On macOS this is usually:

```text
~/Library/Application Support/electron-manager/
  projects.json
  knowledge/
  agent/
    settings.json
    credentials.json
    runs/
      <projectId>/
        runs.sqlite
        outputs/
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

Agent settings, encrypted credentials, SQLite checkpoints, and output artifacts live under the app-data `agent/` directory. API keys are encrypted and decrypted only in the Electron main process through the operating system's secure-storage facility; the renderer can only read credential presence and metadata.

New projects are initialized directly with the current structure. Runtime reads do not migrate or repair old Markdown. If an existing project needs migration, follow [旧项目迁移说明](docs/旧项目迁移说明.md) separately.

## Desktop Agent Flow

Configure the OpenAI profile from the **Agent** screen, then open an active task from the current version and choose **交给 Agent**. A task must have an execution definition and acceptance criteria; deep tasks also require their depth reason, constraints, and rollback plan. Blocking project questions prevent a run from starting.

The desktop coordinator turns the task and active project constraints into a versioned run, stores every committed step in SQLite, publishes progress to the renderer, and can continue a persisted run after the app is reopened. The task detail shows its phase, file progress, recent events, approval requests, continue/cancel controls, and terminal state. On successful completion, the project adapter updates the task and writes the corresponding work log idempotently.

## Agent Permission Boundary

Starting **交给 Agent** is the user's authorization for that task. Within the run, the desktop policy automatically allows the bundled read tools and project-file writes so ordinary edits do not pause for repeated approval. Repository verification scripts still require one explicit approval because a project's package scripts can contain arbitrary commands.

The runtime still enforces hard boundaries:

- File reads and writes stay inside the opened project root; path traversal and writable symlink components are rejected.
- Writes to `.git` internals are rejected. Existing files are changed through atomic, hash-aware patches; new-file creation never overwrites an existing target.
- Process execution has no outer shell and accepts only `pnpm` or `npm` repository scripts from the allowlist (`build`, `check`, `lint`, `test`, and `typecheck`). Dependency installation, arbitrary commands, forwarded script arguments, network tools, and Git writes are not available.
- Unsupported tool risk classes are denied. Deep-task plans still require explicit workflow approval before execution.
- Model credentials never cross the preload bridge as plaintext and are not included in renderer settings responses.

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

- Tasks keep user wording, one combined execution definition, acceptance, and `work_level:: light | standard | deep`.
- Version-scoped records are physically grouped under `versions/Vxxx/`. Completed versions are historical context; new records go only to the active version.
- Work logs are split by month under the owning version so no single log file grows forever.
- Record writes are serialized and atomically replaced. Persistent counters prevent IDs from being reused after deletion.
- Entries in aggregate Markdown files are maintained in descending ID order: larger `Txxx`/`Ixxx`/`Dxxx`/`Qxxx`/`Rxxx`/`Lxxx`/`Cxxx`/`Vxxx` records appear above smaller IDs. `Wxxx` and `Kxxx` are separate files named by ID.
- Thoughts are inbox items. Triage a thought by writing an answer and optionally creating or linking a task.
- Any change to project deliverables—source, configuration, tests, project documents, knowledge notes, or collaboration rules—requires one work log. The log's `record_level` must match the task's final `work_level`. Ordinary answers, thought triage, collaboration metadata updates, and generated `agent-brief.json`, `index.json`, or baseline caches do not create separate logs.
- `light` means one local, reversible goal. `standard` means an understood normal feature or fix. `deep` is reserved for architecture, migration, cross-system contracts, security boundaries, irreversible work, or high-impact decisions. Deep tasks require one primary `depth_reason`, constraints, and a plan with rollback; size or duration alone does not make work deep. An internal IPC change that ships atomically without old/new peers coexisting remains standard.
- Clear light work executes directly. Standard, deep, or materially uncertain work starts with a concise current plan that may change as evidence changes. The user goal and acceptance criteria remain the stable anchor; changing the goal requires returning to the user.
- Intermediate plan churn is not durable collaboration data. Keep the current effective scope, actual key decisions, result, and verification; preserve an intermediate attempt only when it creates a high-impact decision, risk, or follow-up.
- Optimize for overall completion time. When subagents are available, delegate clearly bounded, independent parallel work or specialist investigation. Keep simple sequential work local, and let the main agent retain the goal, acceptance, integration, and final verification.
- Consecutive light changes may share one task and log only when they belong to the same user goal, version, functional area, and acceptance cycle. Unrelated goals or work requiring separate scheduling, rollout, acceptance, or risk tracking stay separate. Immediate light work with no tracking need may use `task_short_id:: T000`.
- Priority is urgency, not complexity: `high` is reserved for current blockers, security/data-loss issues, and release-critical work.
- Questions are independent `Qxxx` items with `open`, `decided`, `resolved`, or `expired` status. Task, thought, and log IDs are relation labels.
- Verification limits, risks, and follow-ups are independent `Rxxx` items and never enter the pending-user-decision list.
- Built-in Agent runs receive only the current goal, acceptance criteria, task constraints, active user project constraints, phase facts, and evidence. Brief navigation, generated system constraints, task status updates, and log-writing mechanics stay in the project adapter instead of being repeated in every model turn.
- Research records use an explicit `breadth` or `depth` mode and a `pending`, `doing`, `done`, or `archived` status. Capturing research creates only a D record. Short results stay in D; substantial results create a linked `Wxxx` only when completed, followed by exactly one work log.
- Documents preserve project-local Markdown material and use independent `Wxxx` IDs.
- Knowledge notes preserve stable, reusable conclusions.
- The Documents view only shows Markdown files under the project-local `documents/` folder; it does not aggregate task, thought, research, collaboration, or work-log files. Documents are not automatically added to the knowledge base.
- Research records, documents, and knowledge notes can be deleted independently. Deletion does not cascade. `related_documents` and similar fields express references only; they do not imply automatic deletion or reference rewriting. Deleting a `Kxxx` knowledge note removes that global Markdown note for all projects.

Linked light and standard logs keep only execution evidence:

```markdown
### 结果
### 修改文件
### 验证
```

Deep logs add `### 关键判断` only when execution creates or changes a high-impact decision. `T000` light logs additionally require `### 用户目标` because no task card exists. Continuing risks and follow-ups go to `Rxxx`. Every project-file change still gets one log per task and acceptance cycle, not per file.

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
- 使用带检查点的本地 Agent 执行符合条件的项目任务，并把完成结果同步回任务和工作记录。

## 当前状态

项目还处在早期阶段，但已经可以使用。本地项目管理流程和首个端到端桌面 Agent 流程已经实现：

- 本地优先的项目记忆
- Agent 交接上下文
- 研究记录到知识库的沉淀流程
- Markdown 数据可读性和可移植性
- OpenAI Responses 模型设置，以及由操作系统加密保存的 API Key
- 任务级 Agent Run，支持本地检查点、进度事件、审批、取消和项目记录同步
- 项目范围内的本地工具运行时，支持检查、文件修改、Git 状态/差异读取和仓库验证脚本

产品形态还会随着真实使用继续变化。稳定发布前，数据格式、Agent 策略和 UI 都可能继续调整。自动化测试不能替代真实 OpenAI Run，也不能替代目标 Mac 上的打包应用验证。

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
    Electron 主进程、Agent IPC 和安全存储适配器
  preload.cjs
    显式暴露给渲染层的 IPC 桥
  renderer-src/
    Vue UI，包括 Agent 设置和任务 Run 控件
  renderer-vue/
    Vite 构建产物，已被 git 忽略

packages/project-core/
  Markdown 项目数据、Dashboard、索引和生成的协作上下文

packages/agent-core/
  Run 台账、步骤状态机、审批协议和检查点契约
packages/agent-config/             分层 Agent 配置和工具策略
packages/agent-context/            有预算限制的上下文组装和缓存
packages/agent-memory/             确定性的会话压缩
packages/agent-model-router/       模型选择、重试和快照兼容
packages/agent-runtime-local/      项目范围文件、Git 读取和受限命令
packages/agent-output/             持久化大输出产物
packages/agent-repo-map/           仓库映射上下文
packages/agent-checkpoint-sqlite/  SQLite Run 检查点
packages/agent-provider-openai/    OpenAI Responses Provider 和 SSE 传输
packages/agent-runner/             无界面编排和 Run 仓库
packages/agent-project-adapter/    项目任务输入和完成同步
packages/agent-credential-vault/   加密凭据持久化
packages/agent-desktop-config/     桌面默认值、设置、Provider 和权限
packages/agent-desktop-coordinator/ 桌面 Run 生命周期和渲染层视图

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

运行全部 Agent 自动化测试和 project-core smoke test：

```bash
pnpm test
```

常用的局部检查：

```bash
pnpm build:agent
pnpm test:agent
```

可选的真实 Provider smoke test 需要 `OPENAI_API_KEY`，并会发起真实 API 请求：

```bash
pnpm --filter @electron-manager/agent-provider-openai smoke:live
```

## 数据存储方式

每个被打开的项目，都会在 Electron 的应用数据目录下创建一份管理数据。

macOS 下通常是：

```text
~/Library/Application Support/electron-manager/
  projects.json
  knowledge/
  agent/
    settings.json
    credentials.json
    runs/
      <projectId>/
        runs.sqlite
        outputs/
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

Agent 设置、加密凭据、SQLite 检查点和输出产物都保存在应用数据目录的 `agent/` 下。API Key 只会在 Electron 主进程中通过操作系统安全存储能力加密和解密；渲染层只能读取凭据是否存在及其元数据。

新项目会直接使用当前结构初始化。运行时读取不会迁移或修复旧 Markdown；已有项目需要迁移时，请单独参阅[旧项目迁移说明](docs/旧项目迁移说明.md)。

## 桌面 Agent 流程

先在 **Agent** 页面配置 OpenAI Profile，再打开当前版本中的活动任务并选择 **交给 Agent**。任务必须包含执行定义和验收标准；deep 任务还必须提供深度原因、约束和回退方案。项目存在阻塞中的协作问题时，不能启动 Run。

桌面 Coordinator 会把任务和当前项目约束转换为带版本的 Run，将每个已提交步骤保存到 SQLite，并向渲染层发布进度；应用重新打开后也能继续持久化的 Run。任务详情会显示阶段、文件进度、最近事件、审批请求、继续/取消控件和终态。成功完成后，项目适配器会以幂等方式更新任务并写入对应工作记录。

## Agent 权限边界

用户点击 **交给 Agent**，即表示授权 Agent 执行该任务。Run 内会自动允许内置读取工具和项目文件写入，普通编辑不会反复请求批准。仓库验证脚本仍需一次明确审批，因为项目的 package script 可能包含任意命令。

运行时仍会强制执行以下边界：

- 文件读写必须位于已打开的项目根目录内；拒绝路径穿越和包含可写符号链接的路径。
- 拒绝写入 `.git` 内部目录。修改现有文件时使用原子、带哈希校验的补丁；创建新文件时绝不覆盖已有目标。
- 进程执行不经过外层 shell，只接受白名单中的 `pnpm` 或 `npm` 仓库脚本：`build`、`check`、`lint`、`test` 和 `typecheck`。不支持安装依赖、任意命令、透传脚本参数、网络工具或 Git 写入。
- 不支持的工具风险类别会被拒绝；deep 任务方案在执行前仍需显式流程审批。
- 模型凭据不会以明文穿过 preload 桥，也不会出现在渲染层设置响应中。

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

- 任务保留用户原话、合并后的执行定义、验收标准和 `work_level:: light | standard | deep`。
- 任务、想法、研究、协作问题、风险和工作记录按版本物理归档到 `versions/Vxxx/`；已完成版本作为历史，新记录只进入当前版本。
- 工作记录在版本内按月份分片，避免单个文件无限增长。
- Markdown 修改采用串行队列和原子替换；记录 ID 使用持久计数器，删除后不会复用。
- 同一聚合 Markdown 内按 ID 倒序维护 `Txxx`/`Ixxx`/`Dxxx`/`Qxxx`/`Rxxx`/`Lxxx`/`Cxxx`/`Vxxx`；`Wxxx` 和 `Kxxx` 是按 ID 命名的独立文件，不适用文件内排序。
- 想法是收集入口。整理想法时，应写入回答，并在需要时创建或关联任务。
- 只要修改源码、配置、测试、项目文档、知识条目或协作规则等交付文件，就必须写一条工作记录；日志的 `record_level` 必须与任务最终的 `work_level` 一致。普通想法整理、协作元数据更新和自动生成的 brief/index/基线缓存不单独写工作记录。
- `light` 是单一、局部、易回退的修改；`standard` 是方案明确的常规功能或修复；`deep` 只用于架构、迁移、跨系统契约、权限安全边界、不可逆操作或高影响方案取舍。deep 必须写一个主 `depth_reason`、关键约束和方案与回退；文件多、步骤多或耗时长本身不构成 deep。同一应用内可原子升级且无需新旧端共存的普通 IPC 调整仍是 standard。
- 简单明确的 light 工作直接执行；standard、deep 或范围不明确的工作先建立简洁的当前计划，执行中可按证据动态调整。用户目标和验收始终作为稳定锚点，目标本身需要变化时必须回到用户确认。
- 中间计划演变不作为长期协作数据。只保留当前有效范围、实际关键判断、结果和验证；只有产生高影响决策、风险或后续事项时才记录中间尝试。
- 以整体完成效率为优先。环境支持子 Agent 时，可委派边界清楚、彼此独立、可并行或适合专项调查的工作；简单顺序工作不强行拆分，主 Agent 保留目标、验收、整合和最终验证责任。
- 同一用户目标、版本、功能区域和验收轮次内的连续 light 修改可共用一张任务和一条日志；无关目标或需要独立排期、发布、验收、风险跟踪的工作必须分开。无需跟踪的即时 light 修改可使用 `task_short_id:: T000`。
- priority 只表示紧急程度，不表示复杂度；`high` 仅用于当前阻塞、安全或数据损坏、发布关键问题。
- 协作问题是独立的 `Qxxx` 记录，状态为 `open`、`decided`、`resolved` 或 `expired`；任务、想法和工作记录 ID 只是关联标签。
- 验证限制、技术风险和后续事项使用独立 `Rxxx`，不会混入需要用户决定的列表。
- 内置 Agent 运行时只接收当前目标、验收、任务约束、有效的用户项目约束、阶段事实和证据。brief 导航、系统生成约束、任务状态和日志写入由项目适配器处理，不再每轮重复塞进模型上下文。
- 研究记录明确使用 `breadth` 广度或 `depth` 深度模式，以及 `pending / doing / done / archived` 状态。保存研究时只创建 D；短结果留在 D，较长结果完成后才创建关联 `Wxxx`，最后只写一条完成工作记录。
- 文档保存项目本地 Markdown 资料，使用独立 `Wxxx` 编号。
- 知识条目保存稳定、可复用的长期结论。
- 文档页只展示项目本地 `documents/` 文件夹里的 Markdown，不再汇总任务、想法、研究、协作或工作记录文件。文档不会自动进入知识库。
- 研究、文档、知识条目都可以独立删除，删除操作不级联。`related_documents` 等字段只表达引用关系，不代表自动删除或自动改写引用。删除 `Kxxx` 知识条目会删除全局知识库中的 Markdown，对所有项目生效。

关联任务的 light/standard 工作记录只保留执行证据：

```markdown
### 结果
### 修改文件
### 验证
```

deep 日志只在执行中形成或改变高影响取舍时增加“关键判断”；没有任务卡的 `T000` light 日志额外保留“用户目标”。持续风险和后续工作写入 `Rxxx`。所有文件修改仍必须记录，但计数单位是同一任务和验收轮次，不是每个文件一条。

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
