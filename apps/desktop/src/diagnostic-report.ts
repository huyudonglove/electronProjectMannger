import type { DesktopRunDetail, DesktopRunView } from '@electron-manager/agent-desktop-coordinator'
import type { CodeMapSnapshot } from '@electron-manager/agent-repo-map'

import type { AppDiagnosticView } from './app-diagnostics.js'
import type { ModelDiagnosticView } from './model-diagnostics.js'

export interface DiagnosticReportInput {
  projectKey: string
  codeMap: CodeMapSnapshot
  runs: DesktopRunView[]
  selectedRun?: DesktopRunDetail | null
  appDiagnostics: AppDiagnosticView[]
  modelDiagnostics: ModelDiagnosticView[]
  appVersion?: string
}

export function buildDiagnosticReport(input: DiagnosticReportInput) {
  const selectedRunView = input.selectedRun ? withoutProjectRoot(input.selectedRun.run) : null
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    appVersion: input.appVersion || 'unknown',
    projectKey: input.projectKey,
    codeMap: {
      revision: input.codeMap.revision,
      updatedAt: input.codeMap.updatedAt,
      ...input.codeMap.stats,
    },
    runSummary: {
      total: input.runs.length,
      active: input.runs.filter((run) => run.status === 'running').length,
      failed: input.runs.filter((run) => ['failed', 'blocked'].includes(run.status)).length,
    },
    selectedRun: input.selectedRun ? {
      run: selectedRunView!,
      events: input.selectedRun.events.slice(-200),
    } : null,
    applicationDiagnostics: input.appDiagnostics.slice(0, 100),
    modelDiagnostics: input.modelDiagnostics.slice(0, 100),
  }
  return { report, text: renderDiagnosticReport(report) }
}

function renderDiagnosticReport(report: {
  generatedAt: string
  appVersion: string
  projectKey: string
  codeMap: { revision: string; updatedAt: string; totalFiles: number }
  runSummary: { total: number; active: number; failed: number }
  selectedRun: { run: Omit<DesktopRunView, 'projectRoot'>; events: DesktopRunDetail['events'] } | null
  applicationDiagnostics: AppDiagnosticView[]
  modelDiagnostics: ModelDiagnosticView[]
}) {
  const lines = [
    '# Electron Manager 脱敏诊断报告',
    `生成时间：${report.generatedAt}`,
    `应用版本：${report.appVersion}`,
    `项目标识：${report.projectKey}`,
    `代码地图：${report.codeMap.revision.slice(0, 12)} · ${report.codeMap.totalFiles} 文件 · 更新 ${report.codeMap.updatedAt}`,
    `Run：${report.runSummary.total} 总计 · ${report.runSummary.active} 运行中 · ${report.runSummary.failed} 失败/阻塞`,
  ]
  if (report.selectedRun) {
    const run = report.selectedRun.run
    lines.push('', `## 选中 Run ${run.runId}`, `状态：${run.status} / ${run.phase} · revision ${run.revision}`, `任务：${run.task?.shortId || '-'} ${run.task?.title || ''}`, `恢复判断：${run.resume.reason}`)
    for (const event of report.selectedRun.events) lines.push(`[${event.sequence}] ${event.at} ${event.type}/${event.phase} ${event.summary}${event.payload ? ` ${JSON.stringify(event.payload)}` : ''}`)
  }
  lines.push('', '## 应用诊断')
  for (const entry of report.applicationDiagnostics) lines.push(`${entry.at} ${entry.level} ${entry.category}/${entry.event} ${entry.message}`)
  lines.push('', '## 模型诊断')
  for (const entry of report.modelDiagnostics) lines.push(`${entry.at} ${entry.result || entry.level} ${entry.routeId || '-'} ${entry.profileId || entry.model} attempt=${entry.attempt || '-'} ${entry.errorCategory || ''} ${entry.error || ''}`)
  return lines.join('\n').slice(0, 100_000)
}

function withoutProjectRoot(run: DesktopRunView): Omit<DesktopRunView, 'projectRoot'> {
  const { projectRoot: _projectRoot, ...view } = run
  return view
}
