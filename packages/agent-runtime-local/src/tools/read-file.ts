import type { ToolDescriptor, ToolModule } from '../tool-registry.js'
import { nativeAvailability, type LocalRuntimeServices } from '../runtime-services.js'
import { optionalNumber, requiredString } from '../tool-input.js'

export const readFileToolDescriptor: ToolDescriptor = {
      name: 'read_file',
      version: '1.0.0',
      title: '读取文件',
      description: 'Read a bounded line range from a project text file.',
      useWhen: 'Use after locating a relevant project text file and only request the needed line range.',
      avoidWhen: 'Do not use for binary files, paths outside the project, or unbounded full-repository reads.',
      risk: 'read',
      riskCategory: 'read',
      baseRiskLevel: 'low',
      recovery: 'safe_replay',
      sideEffects: [],
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
