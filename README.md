# Electron Manager

Electron Manager is a local project collaboration hub. It opens any project folder, stores project management data inside Electron Manager's own app data directory, and keeps the data readable for users and agents.

## Shape

```text
apps/desktop
  Electron shell and renderer UI

packages/project-core
  Markdown data layer
  managed project data initialization
  agent-brief generation
```

## Start

```bash
pnpm install
pnpm dev
```

The desktop app opens with a project picker. It is not bound to any specific React project.

## Initialized Data

For each selected project, Electron Manager creates managed data under Electron's app data directory:

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
        研究.md
      skills/project-collaboration/SKILL.md
```

The selected project folder only gets a lightweight `.agent-collaboration.md` pointer. Full management data is not stored in the project folder.

Markdown is the primary data store. JSON files are configuration, generated indexes, project indexes, or agent sync caches.

## Data Rules

Task cards keep the task-oriented fields: user wording, agent understanding, execution scope, acceptance, and open questions.

The intended workflow is: thought/input -> answered triage -> optional task -> task status updates -> agent work log after task execution and verification. Thought triage alone updates the thought's `### 回答` and any necessary task card; it should not create an agent work log.

Agent work logs should be written with explicit sections so the desktop UI can show complete context instead of `未记录` placeholders:

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

Open questions are displayed as independent QID items, such as `Q001-71FF`. Task short IDs like `T008`, thought short IDs like `I008`, and work-log reference IDs like `L008` are relation labels only; they are not reused as open-question IDs. Work logs remain execution byproducts, not execution modules. When an open question is answered, the reply is written back to the related task, thought, or work log and appears in the collaboration reply history.

Knowledge notes live in `01_知识结构/` and use `Kxxx` IDs. They preserve stable knowledge, detailed answers, documents, runbooks, decisions refined from research notes, and reusable context. When old knowledge documents miss required fields, write explicit fields such as `无` or `暂无` into Markdown instead of relying only on UI fallbacks. The Knowledge Base view shows only `Kxxx` notes; the Documents view is the full Markdown browser for the local data layer. Research notes do not automatically become knowledge notes. When the user explicitly asks to distill/summarize into the knowledge base, collect currently undistilled `Dxxx` records, compare them with existing `Kxxx`, then create, update, merge, or refine knowledge notes. If there is a conflict or missing decision, create an open question linked to the relevant `Dxxx`/`Kxxx`.

When the data structure, field set, or canonical file name changes, migrate the existing Markdown data directly and fill missing values with explicit content such as `无` or `暂无`. Avoid adding long-lived runtime compatibility branches for old data; the Markdown should be brought to the current shape.

Research notes live in `04_记录库/研究.md` and use `Dxxx` IDs. They preserve learning/research thought evolution, key Q&A, comparisons, technical background, and important project decisions or context. User-facing save forms collect content and acceptance criteria; `### 回答` is filled by an agent as a short reply. Detailed answers and reusable conclusions belong in knowledge notes. If the user explicitly asks to save something, write a research note; if an agent judges something is worth preserving, it should ask first. Executable work still belongs in tasks, task execution belongs in agent work logs, and unresolved questions still use QIDs.

If these rules change after a project has already been initialized, refresh that project's guidance files instead of re-initializing it. Re-initialization is not needed and can create a separate managed data root.

## Agent Collaboration

Other agents should start from:

```text
.agent-collaboration.md
<managed-data-root>/agent-brief.json
<managed-data-root>/skills/project-collaboration/SKILL.md
```

The local skill explains task status flow, working log rules, and how to read the project data.

For an already initialized project, the managed files that matter most are:

```text
<managed-data-root>/00_项目管理/数据层规范.md
<managed-data-root>/00_项目管理/Agent 同步交接.md
<managed-data-root>/skills/project-collaboration/SKILL.md
```

## Verify

```bash
pnpm build
pnpm test
```

## macOS Package

```bash
pnpm pack:mac
pnpm dist:mac
```

`pnpm pack:mac` builds a local `.app` at `release/mac-arm64/Electron Manager.app` and applies ad-hoc signing.

`pnpm dist:mac` builds a shareable artifact:

- `release/Electron Manager-<version>-arm64.zip`

The `.app` can be copied directly, but a `.zip` is safer when sending the app to other Mac users because it preserves the app bundle. These builds are ad-hoc signed but not Apple notarized, so other users may see a macOS security warning and need to right-click the app, choose Open, and confirm. For broad distribution, add Apple Developer ID signing and notarization later.
