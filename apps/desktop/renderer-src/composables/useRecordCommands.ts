import { createQuickCreateCommands } from './record-commands/quick-create'
import { createRecordMutationCommands } from './record-commands/record-mutations'
import {
  createRecordCommandRuntime,
  type RecordCommandsOptions,
} from './record-commands/runtime'

export type {
  QuickConstraintForm,
  QuickDialogueForm,
  QuickTaskForm,
  QuickThoughtForm,
  RecordCommandsOptions,
  StatusForm,
} from './record-commands/runtime'

export function useRecordCommands(options: RecordCommandsOptions) {
  const runtime = createRecordCommandRuntime(options)
  const quickCreate = createQuickCreateCommands(runtime)
  const mutations = createRecordMutationCommands(runtime)
  const guard = runtime.withMutationGuard

  return {
    createTask: guard(quickCreate.createTask),
    saveThought: guard(quickCreate.saveThought),
    saveDialogue: guard(quickCreate.saveDialogue),
    saveConstraint: guard(quickCreate.saveConstraint),
    deleteConstraintRecord: guard(mutations.deleteConstraintRecord),
    deleteThought: guard(mutations.deleteThought),
    deleteTask: guard(mutations.deleteTask),
    deleteDialogueRecord: guard(mutations.deleteDialogueRecord),
    deleteDocumentNote: guard(mutations.deleteDocumentNote),
    deleteKnowledgeNote: guard(mutations.deleteKnowledgeNote),
    updateTaskStatus: guard(mutations.updateTaskStatus),
    updateThoughtStatus: guard(mutations.updateThoughtStatus),
    updateDialogueStatus: guard(mutations.updateDialogueStatus),
  }
}
