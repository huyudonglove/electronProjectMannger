import type { ToolDescriptor, ToolModule } from '../tool-registry.js'
import { toolPromptCopy } from '@electron-manager/agent-prompts'
import { nativeAvailability, type LocalRuntimeServices } from '../runtime-services.js'
import { optionalNumber, requiredString } from '../tool-input.js'

const promptCopy = toolPromptCopy('read_file')

export const readFileToolDescriptor: ToolDescriptor = {
      name: 'read_file',
      version: '1.0.0',
      title: '读取文件',
      description: promptCopy.description,
      useWhen: promptCopy.useWhen,
      avoidWhen: promptCopy.avoidWhen,
      risk: 'read',
      riskCategory: 'read',
      baseRiskLevel: 'low',
      recovery: 'safe_replay',
      sideEffects: promptCopy.sideEffects,
      retryable: true,
      backends: [{ id: 'node-native', kind: 'native' }],
      preferredBackendId: 'node-native',
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
}

export function createReadFileTool(services: LocalRuntimeServices): ToolModule {
  return {
    descriptor: readFileToolDescriptor,
    async probe() {
      return nativeAvailability('read_file', 'node-native', services.now())
    },
    async execute(request) {
      const startedAt = services.now()
      const requestedPath = requiredString(request.input.path, 'path')
      const resolved = await services.resolvePath(requestedPath)
      const read = await services.readLines(resolved.absolutePath, {
        startLine: optionalNumber(request.input.startLine, 1),
        endLine: optionalNumber(request.input.endLine, 400),
      })
      const contentHash = await services.hashFile(resolved.absolutePath)
      return {
        requestId: request.id,
        ok: true,
        summary: `Read ${resolved.relativePath} lines ${read.startLine}-${read.endLine}`,
        output: read.output,
        truncated: read.truncated,
        startedAt,
        completedAt: services.now(),
        metadata: { path: resolved.relativePath, startLine: read.startLine, endLine: read.endLine, contentHash },
      }
    },
  }
}
