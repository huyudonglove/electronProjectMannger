import type { AnyRecord } from '../../utils/record-formatters'

export type ResourceKind = 'knowledge' | 'document' | 'constraint'

export type ResourceViewItem = {
  key: string
  record: AnyRecord
  shortId?: string
  title: string
  summary?: string
  rowMeta?: string
  origin?: string
  folder?: string
  detailMeta?: string
  deletable?: boolean
}

export type DeleteResource = (record: AnyRecord) => void | Promise<void>
