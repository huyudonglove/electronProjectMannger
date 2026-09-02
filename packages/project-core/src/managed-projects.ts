import type { ManagedProject, ProjectMetadataSyncResult } from './types.js'
import { updateProjectMetadata } from './project-lifecycle.js'
import { readProjectConfig } from './internal/project-context.js'
import {
  projectOpenTime,
  readProjectIndex,
  removeProjectFromIndex,
  upsertProjectIndex,
} from './internal/project-registry.js'

export async function listManagedProjects(managerDataRoot: string): Promise<ManagedProject[]> {
  return (await readProjectIndex(managerDataRoot))
    .slice()
    .sort((a, b) => projectOpenTime(b).localeCompare(projectOpenTime(a)))
}

export async function updateAllProjectMetadata(managerDataRoot: string): Promise<ProjectMetadataSyncResult[]> {
  const projects = await listManagedProjects(managerDataRoot)
  const results: ProjectMetadataSyncResult[] = []
  for (const project of projects) {
    try {
      await updateProjectMetadata(managerDataRoot, project.projectRoot)
      results.push({
        projectId: project.projectId,
        projectName: project.projectName,
        projectRoot: project.projectRoot,
        status: 'updated',
        error: '',
      })
    } catch (error) {
      results.push({
        projectId: project.projectId,
        projectName: project.projectName,
        projectRoot: project.projectRoot,
        status: 'failed',
        error: String(error),
      })
    }
  }
  return results
}

export async function recordProjectOpen(managerDataRoot: string, projectRoot: string) {
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  await upsertProjectIndex(managerDataRoot, config)
  return config
}

export async function removeManagedProject(managerDataRoot: string, projectId: string): Promise<ManagedProject[]> {
  const id = String(projectId || '').trim()
  if (!id) throw new Error('项目 ID 不能为空')
  await removeProjectFromIndex(managerDataRoot, id)
  return listManagedProjects(managerDataRoot)
}
