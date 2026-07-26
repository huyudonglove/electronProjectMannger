import { createHash } from 'node:crypto'

import { AgentCoreError, stableJson, type JsonValue, type ToolRequest } from '@electron-manager/agent-core'

export function computeActionDigest(toolName: string, input: Record<string, JsonValue>) {
  return createHash('sha256')
    .update(toolName)
    .update('\n')
    .update(stableJson(input))
    .digest('hex')
}

export function assertActionDigest(request: ToolRequest) {
  const expected = computeActionDigest(request.name, request.input)
  if (request.actionDigest !== expected) {
    throw new AgentCoreError('ACTION_DIGEST_MISMATCH', `Action digest does not match ${request.name} input`, {
      details: { requestId: request.id },
    })
  }
}
