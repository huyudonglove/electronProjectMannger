import path from 'node:path'

export function desktopAgentSettingsPath(managerDataRoot: string) {
  return path.join(requireRoot(managerDataRoot), 'agent', 'settings.json')
}

export function desktopAgentProjectStoragePaths(managerDataRoot: string, projectId: string) {
  const id = String(projectId || '').trim()
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`Desktop Agent project id is invalid: ${id || 'empty'}`)
  const root = path.join(requireRoot(managerDataRoot), 'agent', 'runs', id)
  return {
    checkpointPath: path.join(root, 'runs.sqlite'),
    outputDirectory: path.join(root, 'outputs'),
  }
}

function requireRoot(value: string) {
  if (!String(value || '').trim()) throw new Error('Manager data root is required')
  return path.resolve(value)
}
