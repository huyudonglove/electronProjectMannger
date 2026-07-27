export const REPO_MAP_SCHEMA_VERSION = 1 as const

export const DEFAULT_REPO_MAP_EXCLUDED_DIRECTORIES = [
  '.git',
  '.cache',
  '.next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
] as const

export interface RepoMapOptions {
  maxFiles?: number
  maxDepth?: number
  maxOutputBytes?: number
  excludedDirectories?: string[]
}

export interface ResolvedRepoMapOptions {
  maxFiles: number
  maxDepth: number
  maxOutputBytes: number
  excludedDirectories: string[]
}

export interface RepoMapSnapshot {
  schemaVersion: typeof REPO_MAP_SCHEMA_VERSION
  revision: string
  strategy: 'git' | 'filesystem'
  totalFiles: number
  mappedFiles: number
  truncated: boolean
  options: ResolvedRepoMapOptions
  paths: string[]
  content: string
}
