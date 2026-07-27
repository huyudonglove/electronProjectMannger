export type DesktopAgentErrorCode =
  | 'PROJECT_TASK_INVALID'
  | 'RUN_NOT_FOUND'
  | 'RUN_IDENTITY_MISMATCH'
  | 'RUN_OPERATION_ACTIVE'
  | 'PROJECT_SYNC_FAILED'

export class DesktopAgentCoordinatorError extends Error {
  readonly code: DesktopAgentErrorCode
  readonly details?: unknown

  constructor(code: DesktopAgentErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'DesktopAgentCoordinatorError'
    this.code = code
    this.details = details
  }
}

export function serializeDesktopAgentError(error: unknown) {
  if (error instanceof DesktopAgentCoordinatorError) {
    return { code: error.code, message: error.message, details: error.details }
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
  }
}
