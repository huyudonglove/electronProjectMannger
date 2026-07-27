import type { LocalRuntimeServices } from './runtime-services.js'
import type { ToolModule } from './tool-registry.js'
import { createApplyPatchTool } from './tools/apply-patch.js'
import { createCreateFileTool } from './tools/create-file.js'
import { createExecCommandTool } from './tools/exec-command.js'
import { createGitDiffTool } from './tools/git-diff.js'
import { createGitStatusTool } from './tools/git-status.js'
import { createListFilesTool } from './tools/list-files.js'
import { createReadFileTool } from './tools/read-file.js'
import { createSearchTextTool } from './tools/search-text.js'

export function createLocalToolModules(services: LocalRuntimeServices): ToolModule[] {
  return [
    createListFilesTool(services),
    createSearchTextTool(services),
    createReadFileTool(services),
    createGitStatusTool(services),
    createGitDiffTool(services),
    createCreateFileTool(services),
    createApplyPatchTool(services),
    createExecCommandTool(services),
  ]
}
