import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { ManagedProject, ProjectConfig } from '../types.js'
import { atomicWriteFile, withFileMutation } from './storage.js'

export function projectOpenTime(project: ManagedProject) {
  return project.lastOpenedAt || project.createdAt || ''
}

export async function readProjectIndex(managerDataRoot: string): Promise<ManagedProject[]> {
  try {
    return JSON.parse(await readFile(path.join(managerDataRoot, 'projects.json'), 'utf8')) as ManagedProject[]
  } catch {
    return []
  }
}

export async function upsertProjectIndex(managerDataRoot: string, config: ProjectConfig, recordOpen = true) {
  const indexPath = path.join(managerDataRoot, 'projects.json')
  await withFileMutation(indexPath, async () => {
    const projects = await readProjectIndex(managerDataRoot)
    const existing = projects.find((project) => project.projectId === config.projectId)
    const now = recordOpen ? new Date().toISOString() : existing?.lastOpenedAt || config.createdAt
    const next: ManagedProject = {
      projectId: config.projectId,
      projectName: config.name,
      projectRoot: config.projectRoot,
      dataRoot: config.dataRoot,
      createdAt: existing?.createdAt || config.createdAt,
      lastOpenedAt: now,
    }
    const merged = recordOpen
      ? [next, ...projects.filter((project) => project.projectId !== config.projectId)]
      : projects.map((project) => project.projectId === config.projectId ? next : project)
    await atomicWriteFile(indexPath, `${JSON.stringify(merged, null, 2)}\n`)
  })
}

export async function removeProjectFromIndex(managerDataRoot: string, projectId: string) {
  const indexPath = path.join(managerDataRoot, 'projects.json')
  await withFileMutation(indexPath, async () => {
    const projects = await readProjectIndex(managerDataRoot)
    const next = projects.filter((project) => project.projectId !== projectId)
    await atomicWriteFile(indexPath, `${JSON.stringify(next, null, 2)}\n`)
  })
}
