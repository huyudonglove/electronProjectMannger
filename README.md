# Electron Manager

Electron Manager is a local-first desktop workspace for keeping durable project records in Markdown. It organizes tasks, ideas, research, questions, risks, constraints, documents, knowledge, versions, and work logs without embedding an execution agent or model runtime.

## What It Does

- Opens and tracks local project folders.
- Stores readable Markdown records outside the source repository.
- Separates records by project and version.
- Provides task, idea, research, question, risk, constraint, document, knowledge, and work-log views.
- Maintains a neutral `record-summary.json`, `index.json`, and human-readable project baseline.
- Generates a project-specific `skills/project-records/SKILL.md` for Agents.
- Keeps a shared global knowledge directory across managed projects.
- Preserves stable short IDs and serializes record writes.

Electron Manager records work; it does not execute tasks, call model providers, delegate task trees, or manage run checkpoints.

## Record Types

| Record | ID | Purpose |
| --- | --- | --- |
| Tasks | `Txxx` | Planned or completed project work. |
| Ideas | `Ixxx` | Inbox notes and later conclusions. |
| Research | `Dxxx` | Research requests, progress, results, and optional document links. |
| Questions | `Qxxx` | Decisions, clarifications, blockers, and append-only replies. |
| Risks | `Rxxx` | Risks, verification gaps, and follow-up items. |
| Constraints | `Cxxx` | Project-wide rules and boundaries. |
| Documents | `Wxxx` | Project-local Markdown material. |
| Knowledge | `Kxxx` | Stable reusable knowledge shared across projects. |
| Work Logs | `Lxxx` | Results, changed files, verification, and key decisions. |
| Versions | `Vxxx` | Historical boundaries for version-scoped records. |

References between records are non-owning. Deleting one record does not cascade into related records.

## Repository Layout

```text
apps/desktop/
  src/                    Electron main process
  preload.cjs             Safe IPC bridge
  renderer-src/           Vue renderer source
  renderer-vue/           Generated Vite output

packages/project-core/
  src/                    Markdown record model and storage
  tests/                  Focused record-layer tests

scripts/
  smoke-test.mjs          End-to-end record smoke test
```

## Development

Requirements:

- Node.js 22 or newer
- pnpm 10 or newer

Install and run:

```bash
pnpm install
pnpm dev
```

Build and test:

```bash
pnpm build
pnpm test
pnpm --filter @electron-manager/project-core test
pnpm --filter @electron-manager/project-core build && node scripts/smoke-test.mjs
```

## Data Storage

Electron Manager stores managed data under the application's data directory. On macOS this is typically:

```text
~/Library/Application Support/electron-manager/
  projects.json
  knowledge/
    Kxxx-*.md
  projects/
    <projectId>/
      project.json
      record-summary.json
      record-counters.json
      index.json
      metadata/
        数据层规范.md
        当前项目基线.md
        需求变更索引.md
      skills/
        project-records/
          SKILL.md
      constraints/
        项目约束.md
      documents/
        Wxxx-*.md
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
```

The selected source project is not modified with pointer files or runtime metadata. Markdown is the primary source of truth. JSON files contain project configuration, counters, and derived indexes that can be regenerated.

New projects are initialized directly with the current schema. Runtime reads do not silently migrate or repair old Markdown.

## Record Summary

`record-summary.json` is a data-only navigation summary. It exposes:

- the project data root and shared knowledge root;
- the current version;
- exact paths for current task, idea, research, question, risk, and work-log records;
- the generated project-record Skill path;
- compact lists of active tasks, research, questions, risks, and recent logs.

It contains no execution instructions, provider configuration, model history, task-tree context, delegation messages, run state, or approval state.

## Project Record Skill

Each initialized project gets a generated `skills/project-records/SKILL.md`. Its path can be copied from the overview.

The Skill explains how to locate `record-summary.json`, follow the current Markdown schemas, preserve historical records, and write neutral project records. It is an interoperability document only: Electron Manager still does not embed or run an Agent, model provider, tool runtime, approval flow, or delegated task tree. The source project receives no pointer file.

## Data Rules

- Version-scoped records live under `versions/Vxxx/`; completed versions are historical.
- Aggregate Markdown files keep records in descending short-ID order.
- Documents and knowledge notes are independent Markdown files.
- Persistent counters prevent a deleted short ID from being reused.
- Writes to aggregate files are serialized and atomically replaced.
- Task statuses are `todo`, `doing`, `done`, or `abandoned`.
- Research statuses are `pending`, `doing`, `done`, or `archived`.
- Question statuses are `open`, `decided`, `resolved`, or `expired`; replies append to history.
- Risk statuses are `open`, `resolved`, or `expired`.
- Work logs use `type:: work-log` and `record_level:: light | standard | deep`.
- Deep task records may include a primary depth reason, constraints, and rollback notes.
- Record links never imply ownership or cascading deletion.

## 中文说明

Electron Manager 是一个本地优先的项目记录桌面工具。它用 Markdown 保存任务、想法、研究、问题、风险、约束、文档、知识、版本和工作记录，不内置任务执行 Agent、模型 Provider、任务树委派、运行检查点或审批流程。

### 核心特点

- 项目记录保存在 Electron Manager 数据目录，不写入源码项目。
- `record-summary.json` 只提供记录位置和当前摘要，不包含执行指令。
- 每个项目生成 `skills/project-records/SKILL.md`，可从总览复制其路径。
- 当前版本的任务、想法、研究、问题、风险和工作记录保存在 `versions/Vxxx/`。
- 项目文档使用 `Wxxx`，共享知识使用 `Kxxx`。
- 聚合 Markdown 按短 ID 倒序维护，持久计数器确保删除后不复用编号。
- 记录之间只建立引用关系，删除时不会级联。
- 所有聚合写入串行执行并使用原子替换。

### 记录边界

任务是独立记录，不包含父子节点、上下文 ID、委派、节点消息、完成汇报或父级验收字段。工作记录使用中性的 `type:: work-log`，只保存结果、修改文件、验证和必要的关键判断。

问题记录保留追加式回复历史。`open` 表示待答复，`decided` 表示待跟进，`resolved` 表示已完成，`expired` 表示不再适用。

研究记录可以使用广度或深度模式；保存研究请求本身不会自动创建项目文档或工作记录。需要长期保存的详细结果可以手动写入 W 文档，再通过引用关联。

## License

No license file is currently included.
