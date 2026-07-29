import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface AgentChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface AgentChatConversation {
  id: string
  projectRoot: string
  title: string
  createdAt: string
  updatedAt: string
  messages: AgentChatMessage[]
}

export interface LegacyAgentChatTaskLink {
  conversationId: string
  taskId: string
  messageId: string
}

interface AgentChatStoreFile {
  schemaVersion: 2
  conversations: AgentChatConversation[]
}

export class AgentChatStore {
  readonly filePath: string
  readonly #clock: () => string
  #queue: Promise<void> = Promise.resolve()
  #migrationChecked = false

  constructor(managerDataRoot: string, options: { clock?: () => string } = {}) {
    if (!String(managerDataRoot || '').trim()) throw new Error('Manager data root is required')
    this.filePath = path.join(path.resolve(managerDataRoot), 'agent', 'chat-conversations.json')
    this.#clock = options.clock || (() => new Date().toISOString())
  }

  async list(projectRoot: string): Promise<AgentChatConversation[]> {
    await this.#ensureCurrentSchema()
    await this.#queue
    const root = normalizeProjectRoot(projectRoot)
    const data = await this.#load()
    return data.conversations
      .filter((conversation) => conversation.projectRoot === root)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((conversation) => structuredClone(conversation))
  }

  async legacyTaskLinks(projectRoot: string): Promise<LegacyAgentChatTaskLink[]> {
    await this.#queue
    const root = normalizeProjectRoot(projectRoot)
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.filePath, 'utf8'))
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
    if (!isObject(parsed) || Number(parsed.schemaVersion) !== 1 || !Array.isArray(parsed.conversations)) return []
    return parsed.conversations.flatMap((value) => {
      if (!isObject(value) || value.projectRoot !== root || typeof value.id !== 'string' || typeof value.taskId !== 'string' || !Array.isArray(value.messages)) return []
      const message = [...value.messages].reverse().find((candidate) => isObject(candidate) && candidate.role === 'user' && typeof candidate.id === 'string')
      if (!isObject(message) || typeof message.id !== 'string') return []
      return [{ conversationId: value.id, taskId: value.taskId, messageId: message.id }]
    })
  }

  async appendUser(projectRoot: string, conversationId: string | undefined, content: string) {
    const root = normalizeProjectRoot(projectRoot)
    const text = normalizeMessageContent(content)
    return await this.#exclusive(async () => {
      const data = await this.#load()
      const at = this.#clock()
      let conversation = conversationId
        ? data.conversations.find((candidate) => candidate.id === conversationId)
        : undefined
      if (conversation && conversation.projectRoot !== root) throw new Error('Chat conversation belongs to another project')
      if (!conversation) {
        conversation = {
          id: randomUUID(),
          projectRoot: root,
          title: conversationTitle(text),
          createdAt: at,
          updatedAt: at,
          messages: [],
        }
        data.conversations.push(conversation)
      }
      const message = { id: randomUUID(), role: 'user' as const, content: text, createdAt: at }
      conversation.messages.push(message)
      conversation.updatedAt = at
      await this.#write(data)
      return { conversation: structuredClone(conversation), message: structuredClone(message) }
    })
  }

  async appendAssistant(projectRoot: string, conversationId: string, content: string) {
    const root = normalizeProjectRoot(projectRoot)
    const text = normalizeMessageContent(content)
    return await this.#exclusive(async () => {
      const data = await this.#load()
      const conversation = data.conversations.find((candidate) => candidate.id === conversationId)
      if (!conversation || conversation.projectRoot !== root) throw new Error('Chat conversation does not exist')
      const at = this.#clock()
      conversation.messages.push({ id: randomUUID(), role: 'assistant', content: text, createdAt: at })
      conversation.updatedAt = at
      await this.#write(data)
      return structuredClone(conversation)
    })
  }

  async delete(projectRoot: string, conversationId: string) {
    const root = normalizeProjectRoot(projectRoot)
    const id = requiredString(conversationId, 'conversation.id')
    return await this.#exclusive(async () => {
      const data = await this.#load()
      const index = data.conversations.findIndex((candidate) => candidate.id === id && candidate.projectRoot === root)
      if (index < 0) throw new Error('Chat conversation does not exist')
      data.conversations.splice(index, 1)
      await this.#write(data)
      return true
    })
  }

  async #load(): Promise<AgentChatStoreFile> {
    let raw = ''
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (isNotFound(error)) return { schemaVersion: 2, conversations: [] }
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(`Agent Chat store is not valid JSON: ${this.filePath}`, { cause: error })
    }
    return validateStoreFile(parsed)
  }

  async #write(data: AgentChatStoreFile) {
    const validated = validateStoreFile(data)
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, this.filePath)
  }

  async #ensureCurrentSchema() {
    if (this.#migrationChecked) return
    await this.#exclusive(async () => {
      if (this.#migrationChecked) return
      const data = await this.#load()
      await this.#write(data)
      this.#migrationChecked = true
    })
  }

  async #exclusive<T>(operation: () => Promise<T>) {
    const previous = this.#queue
    let release!: () => void
    this.#queue = new Promise<void>((resolve) => { release = resolve })
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

function validateStoreFile(value: unknown): AgentChatStoreFile {
  if (!isObject(value) || ![1, 2].includes(Number(value.schemaVersion)) || !Array.isArray(value.conversations)) {
    throw new Error('Unsupported Agent Chat store schema')
  }
  return {
    schemaVersion: 2,
    conversations: value.conversations.map(validateConversation),
  }
}

function validateConversation(value: unknown): AgentChatConversation {
  if (!isObject(value) || !Array.isArray(value.messages)) throw new Error('Agent Chat conversation is invalid')
  const conversation: AgentChatConversation = {
    id: requiredString(value.id, 'conversation.id'),
    projectRoot: normalizeProjectRoot(requiredString(value.projectRoot, 'conversation.projectRoot')),
    title: requiredString(value.title, 'conversation.title'),
    createdAt: requiredString(value.createdAt, 'conversation.createdAt'),
    updatedAt: requiredString(value.updatedAt, 'conversation.updatedAt'),
    messages: value.messages.map(validateMessage),
  }
  return conversation
}

function validateMessage(value: unknown): AgentChatMessage {
  if (!isObject(value) || !['user', 'assistant'].includes(String(value.role || ''))) {
    throw new Error('Agent Chat message is invalid')
  }
  return {
    id: requiredString(value.id, 'message.id'),
    role: value.role as AgentChatMessage['role'],
    content: requiredString(value.content, 'message.content'),
    createdAt: requiredString(value.createdAt, 'message.createdAt'),
  }
}

function normalizeProjectRoot(value: string) {
  if (!String(value || '').trim()) throw new Error('Project root is required')
  return path.resolve(value)
}

function normalizeMessageContent(value: string) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error('Chat message is required')
  if (normalized.length > 20_000) throw new Error('Chat message is too long')
  return normalized
}

function conversationTitle(content: string) {
  const firstLine = content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '新对话'
  return firstLine.length > 72 ? `${firstLine.slice(0, 72).trimEnd()}…` : firstLine
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNotFound(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
