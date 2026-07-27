import {
  applyProjectRunCompletionUpdate,
  applyProjectTaskStatusUpdate,
  type ProjectRunUpdateResult,
} from '@electron-manager/project-core'

import type { PreparedProjectRun, ProjectRunUpdatePlan } from './types.js'

export async function applyPreparedProjectRunStart(
  managerDataRoot: string,
  prepared: PreparedProjectRun,
): Promise<ProjectRunUpdateResult | null> {
  if (!prepared.startUpdate) return null
  return applyProjectTaskStatusUpdate(managerDataRoot, prepared.projectRoot, prepared.startUpdate)
}

export async function applyProjectRunUpdatePlan(
  managerDataRoot: string,
  projectRoot: string,
  plan: ProjectRunUpdatePlan,
): Promise<ProjectRunUpdateResult> {
  if (plan.outcome !== 'ready' || !plan.log) {
    throw new Error(`Project run update plan is not writable: ${plan.outcome}`)
  }
  return applyProjectRunCompletionUpdate(managerDataRoot, projectRoot, {
    taskUpdate: plan.taskStatusUpdate,
    log: {
      source: plan.source,
      idempotencyKey: plan.idempotencyKey,
      title: plan.log.title,
      taskId: plan.log.taskId,
      taskShortId: plan.log.taskShortId,
      version: plan.log.version,
      recordLevel: plan.log.recordLevel,
      result: [...plan.log.result],
      changedFiles: [...plan.log.changedFiles],
      verification: [...plan.log.verification],
      decisions: [...plan.log.decisions],
    },
  })
}
