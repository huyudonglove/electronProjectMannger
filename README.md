# Electron Manager

Electron Manager is a local-first desktop workspace for managing project context, agent collaboration notes, research records, tasks, and a Markdown-based knowledge base.

It is designed for people who work with coding agents across many sessions and do not want important project context to disappear inside chat history.

## What It Does

- Opens any local project folder and creates a lightweight collaboration entry.
- Stores project management data outside the project source tree, in Electron's app data directory.
- Keeps the main data readable as Markdown.
- Tracks tasks, thoughts, research records, knowledge notes, work logs, and open questions.
- Generates an `agent-brief.json` and local collaboration skill so another agent can quickly rebuild project context.
- Provides a desktop UI for browsing and updating the local project knowledge layer.

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
| Knowledge | `Kxxx` | Distilled long-term knowledge, reusable answers, runbooks, and decisions. |
| Work Logs | `Lxxx` | Agent execution records after real work is done. |
| Open Questions | `Qxxx` | Pending decisions or confirmations surfaced from tasks, thoughts, or logs. |

Research records do not automatically become knowledge notes. When you want to preserve a stable conclusion, distill one or more `Dxxx` records into `Kxxx` knowledge notes.

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
~/Library/Application Support/@electron-manager/desktop/
  projects.json
  projects/
    <projectId>/
      project.json
      agent-brief.json
      index.json
      00_项目管理/
      01_知识结构/
      04_记录库/
        想法与问题.md
        研究.md
        Agent 工作记录.md
      skills/project-collaboration/SKILL.md
```

The selected project folder only receives a lightweight pointer file:

```text
.agent-collaboration.md
```

The full management data is not stored in your project source tree. Markdown is the primary source of truth. JSON files are used for configuration, generated indexes, and agent sync caches.

## Agent Collaboration Flow

Another agent should start from the project pointer:

```text
.agent-collaboration.md
```

That file points to the managed data directory. The most important generated files are:

```text
<managed-data-root>/agent-brief.json
<managed-data-root>/skills/project-collaboration/SKILL.md
<managed-data-root>/00_项目管理/数据层规范.md
<managed-data-root>/00_项目管理/Agent 同步交接.md
```

The generated brief and skill explain how to read project context, update tasks, write work logs, handle research records, and preserve open questions.

## Data Rules

Electron Manager intentionally keeps data rules explicit so humans and agents can both understand the project state.

- Tasks keep user wording, agent understanding, execution scope, acceptance criteria, and open questions.
- Thoughts are inbox items. Triage a thought by writing an answer and optionally creating or linking a task.
- Work logs are written after real task execution or verification, not for ordinary thought triage.
- Open questions are displayed as independent `Qxxx` items. Task IDs, thought IDs, and work-log IDs are relation labels, not question IDs.
- Research records preserve thinking history and lightweight answers.
- Knowledge notes preserve stable, reusable conclusions.
- When data structures change, existing Markdown should be migrated directly instead of adding long-lived compatibility branches.

Agent work logs should keep these sections:

```markdown
### 用户目标
### 需求理解
### 产出
### 关键步骤
### 执行动作
### 验证
### 验收标准
### 未确认事项
```

Research records use:

```markdown
### 内容
### 回答
### 验收标准
```

When an agent continues from a `Dxxx` research record, it should read both `### 内容` and `### 验收标准`.

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

它适合经常和 Coding Agent 多轮协作的人：当项目上下文、技术判断、研究过程和任务执行记录散落在不同聊天里时，Electron Manager 可以把这些信息沉淀到本地、可读、可迁移的数据层里。

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
- Markdown 数据可读性和可迁移性
- Electron + Vue 桌面界面

产品形态还会随着真实使用继续变化。稳定发布前，数据格式和 UI 都可能继续调整。

## 核心概念

Electron Manager 会把项目上下文拆成几类记录：

| 区域 | ID | 用途 |
| --- | --- | --- |
| 想法 | `Ixxx` | 收集临时想法、问题、粗略输入。 |
| 任务 | `Txxx` | 需要执行的工作项，带状态和验收标准。 |
| 研究 | `Dxxx` | 学习过程、问答、调研、思路演进和判断过程。 |
| 知识 | `Kxxx` | 沉淀后的长期知识、可复用答案、运行手册和决策。 |
| 工作记录 | `Lxxx` | Agent 真正执行任务后的记录。 |
| 待确认 | `Qxxx` | 从任务、想法或工作记录中提取出的待确认问题。 |

研究记录不会自动进入知识库。当你希望把一段稳定结论长期保存时，可以把一个或多个 `Dxxx` 研究记录沉淀成 `Kxxx` 知识条目。

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
~/Library/Application Support/@electron-manager/desktop/
  projects.json
  projects/
    <projectId>/
      project.json
      agent-brief.json
      index.json
      00_项目管理/
      01_知识结构/
      04_记录库/
        想法与问题.md
        研究.md
        Agent 工作记录.md
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
<managed-data-root>/00_项目管理/数据层规范.md
<managed-data-root>/00_项目管理/Agent 同步交接.md
```

这些文件会告诉 Agent 如何读取上下文、更新任务、写工作记录、处理研究记录，以及保留待确认事项。

## 数据规则

Electron Manager 会尽量把数据规则写清楚，让人和 Agent 都能理解项目状态。

- 任务保留用户原话、Agent 理解、执行范围、验收标准和未确认事项。
- 想法是收集入口。整理想法时，应写入回答，并在需要时创建或关联任务。
- 工作记录只在实际执行任务或完成验证后写入，不为普通想法整理单独写工作记录。
- 待确认事项以独立 `Qxxx` 展示。任务 ID、想法 ID、工作记录 ID 只是关联标签，不复用为问题 ID。
- 研究记录保存思路演进和简短回答。
- 知识条目保存稳定、可复用的长期结论。
- 数据结构变化时，应直接迁移已有 Markdown，而不是长期保留兼容分支。

Agent 工作记录建议保留这些段落：

```markdown
### 用户目标
### 需求理解
### 产出
### 关键步骤
### 执行动作
### 验证
### 验收标准
### 未确认事项
```

研究记录使用：

```markdown
### 内容
### 回答
### 验收标准
```

当 Agent 继续处理某条 `Dxxx` 研究记录时，应该同时读取 `### 内容` 和 `### 验收标准`。

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
