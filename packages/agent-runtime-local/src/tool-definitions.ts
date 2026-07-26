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
