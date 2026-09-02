import type { Ref } from 'vue'
import type { AnyRecord } from '../utils/record-formatters'
import { useMarkdownDialogModel } from './resource-library/useMarkdownDialogModel'
import { useResourceViewModels } from './resource-library/useResourceViewModels'
import type { DeleteResource, ResourceKind, ResourceViewItem } from './resource-library/types'

type ResourceLibraryOptions = {
  dashboard: Readonly<Ref<AnyRecord | null>>
  projectRoot: Readonly<Ref<string>>
  knowledge: Readonly<Ref<AnyRecord[]>>
  documents: Readonly<Ref<AnyRecord[]>>
  userConstraints: Readonly<Ref<AnyRecord[]>>
  systemConstraints: Readonly<Ref<AnyRecord[]>>
  knowledgeQuery: Readonly<Ref<string>>
  documentQuery: Readonly<Ref<string>>
  constraintQuery: Readonly<Ref<string>>
  markdownDocument: Ref<AnyRecord | null>
  deleteKnowledgeNote: DeleteResource
  deleteDocumentNote: DeleteResource
  deleteConstraintRecord: DeleteResource
}

export function useResourceLibrary(options: ResourceLibraryOptions) {
  const viewModels = useResourceViewModels(options)
  const markdownDialog = useMarkdownDialogModel(options)

  function deleteResourceViewItem(kind: ResourceKind, item: ResourceViewItem) {
    if (kind === 'knowledge') return options.deleteKnowledgeNote(item.record)
    if (kind === 'document') return options.deleteDocumentNote(item.record)
    return options.deleteConstraintRecord(item.record)
  }

  return {
    ...viewModels,
    ...markdownDialog,
    deleteResourceViewItem,
  }
}

export type { ResourceKind, ResourceViewItem } from './resource-library/types'
