import { createHash } from 'node:crypto'
import path from 'node:path'

import { DATA_DIR } from '../paths.js'
import type { ProjectConfig } from '../types.js'
import { slug } from '../utils.js'
import { readProjectIndex } from './project-registry.js'
import { readProjectFile } from './storage.js'

export function createProjectId(projectRoot: string, projectName = path.basename(projectRoot)) {
  return `${slug(projectName)}-${createHash('sha1').update(path.resolve(projectRoot)).digest('hex').slice(0, 10)}`
}

export function resolveDataRoot(managerDataRoot: string, projectRoot: string, projectName = path.basename(projectRoot)) {
  return path.join(managerDataRoot, DATA_DIR, createProjectId(projectRoot, projectName))
}

export async function resolveExistingDataRoot(managerDataRoot: string, projectRoot: string) {
  const project = (await readProjectIndex(managerDataRoot))
    .find((item) => path.resolve(item.projectRoot) === path.resolve(projectRoot))
  return project?.dataRoot || resolveDataRoot(managerDataRoot, projectRoot)
}

export async function readProjectConfig(managerDataRoot: string, projectRoot: string): Promise<ProjectConfig> {
  const raw = await readProjectFile(await resolveExistingDataRoot(managerDataRoot, projectRoot), 'project.json')
  return JSON.parse(raw) as ProjectConfig
}
