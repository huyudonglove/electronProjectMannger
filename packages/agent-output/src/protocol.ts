export const OUTPUT_ARTIFACT_SCHEMA_VERSION = 1 as const
export const DEFAULT_OUTPUT_PREVIEW_CHARACTERS = 4_000

export interface OutputArtifact {
  schemaVersion: typeof OUTPUT_ARTIFACT_SCHEMA_VERSION
  ref: string
  sha256: string
  mediaType: 'text/plain; charset=utf-8'
  bytes: number
  characters: number
  createdAt: string
}

export interface StoredOutput {
  artifact: OutputArtifact
  content: string
}

export interface PutOutputOptions {
  createdAt?: string
}

export interface OutputStore {
  put(content: string, options?: PutOutputOptions): Promise<OutputArtifact>
  read(ref: string): Promise<StoredOutput>
}

export interface OutputPreview {
  text: string
  truncated: boolean
  originalCharacters: number
  omittedCharacters: number
}

export function createOutputPreview(content: string, maxCharacters: number): OutputPreview {
  const limit = Math.max(0, Math.floor(maxCharacters))
  if (content.length <= limit) {
    return {
      text: content,
      truncated: false,
      originalCharacters: content.length,
      omittedCharacters: 0,
    }
  }
  if (limit === 0) {
    return {
      text: '',
      truncated: true,
      originalCharacters: content.length,
      omittedCharacters: content.length,
    }
  }

  const marker = '\n… output preview shortened …\n'
  if (marker.length >= limit) {
    return {
      text: content.slice(0, limit),
      truncated: true,
      originalCharacters: content.length,
      omittedCharacters: content.length - limit,
    }
  }
  const available = limit - marker.length
  const headLength = Math.ceil(available / 2)
  const tailLength = Math.floor(available / 2)
  return {
    text: `${content.slice(0, headLength)}${marker}${content.slice(content.length - tailLength)}`,
    truncated: true,
    originalCharacters: content.length,
    omittedCharacters: content.length - available,
  }
}
