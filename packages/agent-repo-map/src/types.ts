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

export const CODE_MAP_SCHEMA_VERSION = 1 as const

export interface CodeMapOptions extends RepoMapOptions {
  maxSourceBytes?: number
}

export interface ResolvedCodeMapOptions extends ResolvedRepoMapOptions {
  maxSourceBytes: number
}

export interface CodeMapFileRecord {
  path: string
  kind: 'source' | 'test' | 'config' | 'other'
  language: string
  bytes: number
  modifiedAtMs: number
  contentHash?: string
  imports: string[]
  exports: string[]
}

export interface CodeMapSnapshot {
  schemaVersion: typeof CODE_MAP_SCHEMA_VERSION
  revision: string
  projectKey: string
  generatedAt: string
  updatedAt: string
  repoMap: RepoMapSnapshot
  options: ResolvedCodeMapOptions
  files: CodeMapFileRecord[]
  stats: {
    totalFiles: number
    analyzedFiles: number
    sourceFiles: number
    testFiles: number
    configFiles: number
    dependencyEdges: number
    exportedSymbols: number
    languages: Record<string, number>
  }
  content: string
}
