import type { ToolDefinition } from '@electron-manager/agent-core'

export const localReadToolDefinitions: ToolDefinition[] = [
  {
    name: 'list_files',
    description: 'List project files under a project-relative directory using ripgrep and project ignore rules.',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project-relative directory. Defaults to the project root.' },
        includeHidden: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_text',
    description: 'Search text with ripgrep inside a project-relative path.',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        path: { type: 'string' },
        globs: { type: 'array', items: { type: 'string' } },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description: 'Read a bounded line range from a project text file.',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        startLine: { type: 'number' },
        endLine: { type: 'number' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'git_status',
    description: 'Read the current Git branch and concise working-tree status.',
    risk: 'read',
    inputSchema: { type: 'object', additionalProperties: false },
  },
  {
    name: 'git_diff',
    description: 'Read the current unstaged Git diff, optionally restricted to project-relative paths.',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: { paths: { type: 'array', items: { type: 'string' } } },
      additionalProperties: false,
    },
  },
]

export const localWriteToolDefinitions: ToolDefinition[] = [
  {
    name: 'create_file',
    description: 'Create a new UTF-8 text file. The target must not already exist and its parent must be inside the project.',
    risk: 'project_write',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'apply_patch',
    description: 'Atomically apply exact text replacements across one or more existing UTF-8 project files.',
    risk: 'project_write',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              oldText: { type: 'string' },
              newText: { type: 'string' },
              expectedOccurrences: { type: 'number' },
              expectedHash: { type: 'string', description: 'Optional SHA-256 hash of the file before any operation in this patch.' },
            },
            required: ['path', 'oldText', 'newText'],
            additionalProperties: false,
          },
        },
      },
      required: ['operations'],
      additionalProperties: false,
    },
  },
]

export const localProcessToolDefinitions: ToolDefinition[] = [
  {
    name: 'exec_command',
    description: 'Run an approved repository-defined package verification script without an outer shell. Scripts may have project-local side effects and must be followed by Git inspection.',
    risk: 'process',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', enum: ['pnpm', 'npm'] },
        args: { type: 'array', items: { type: 'string' } },
        cwd: { type: 'string', description: 'Existing project-relative directory. Defaults to the project root.' },
        timeoutMs: { type: 'number', description: 'Positive timeout bounded by the runtime maximum.' },
      },
      required: ['command', 'args'],
      additionalProperties: false,
    },
  },
]

export const localToolDefinitions: ToolDefinition[] = [
  ...localReadToolDefinitions,
  ...localWriteToolDefinitions,
  ...localProcessToolDefinitions,
]
