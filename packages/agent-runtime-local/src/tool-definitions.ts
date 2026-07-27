import type { ToolDefinition } from '@electron-manager/agent-core'

import type { ToolDescriptor } from './tool-registry.js'
import { applyPatchToolDescriptor } from './tools/apply-patch.js'
import { createFileToolDescriptor } from './tools/create-file.js'
import { execCommandToolDescriptor } from './tools/exec-command.js'
import { gitDiffToolDescriptor } from './tools/git-diff.js'
import { gitStatusToolDescriptor } from './tools/git-status.js'
import { listFilesToolDescriptor } from './tools/list-files.js'
import { readFileToolDescriptor } from './tools/read-file.js'
import { searchTextToolDescriptor } from './tools/search-text.js'

export const localReadToolDescriptors: ToolDescriptor[] = [
  listFilesToolDescriptor,
  searchTextToolDescriptor,
  readFileToolDescriptor,
  gitStatusToolDescriptor,
  gitDiffToolDescriptor,
]

export const localWriteToolDescriptors: ToolDescriptor[] = [
  createFileToolDescriptor,
  applyPatchToolDescriptor,
]

export const localProcessToolDescriptors: ToolDescriptor[] = [execCommandToolDescriptor]

export const localToolDescriptors: ToolDescriptor[] = [
  ...localReadToolDescriptors,
  ...localWriteToolDescriptors,
  ...localProcessToolDescriptors,
]

export const localReadToolDefinitions: ToolDefinition[] = localReadToolDescriptors
export const localWriteToolDefinitions: ToolDefinition[] = localWriteToolDescriptors
export const localProcessToolDefinitions: ToolDefinition[] = localProcessToolDescriptors
export const localToolDefinitions: ToolDefinition[] = localToolDescriptors
