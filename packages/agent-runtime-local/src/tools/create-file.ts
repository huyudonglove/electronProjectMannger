import type { ToolDescriptor, ToolModule } from '../tool-registry.js'
import { toolPromptCopy } from '@electron-manager/agent-prompts'
import { nativeAvailability, type LocalRuntimeServices } from '../runtime-services.js'
import { requiredString, stringValue } from '../tool-input.js'

const promptCopy = toolPromptCopy('create_file')

export const createFileToolDescriptor: ToolDescriptor = {
      name: 'create_file',
      version: '1.0.0',
      title: '创建文件',
      description: promptCopy.description,
      useWhen: promptCopy.useWhen,
      avoidWhen: promptCopy.avoidWhen,
      risk: 'project_write',
      riskCategory: 'project_write',
      baseRiskLevel: 'medium',
      recovery: 'reconcile_then_resume',
      sideEffects: promptCopy.sideEffects,
      retryable: false,
      backends: [{ id: 'node-file-transaction', kind: 'native' }],
      preferredBackendId: 'node-file-transaction',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
}

export function createCreateFileTool(services: LocalRuntimeServices): ToolModule {
  return {
    descriptor: createFileToolDescriptor,
    async probe() {
      return nativeAvailability('create_file', 'node-file-transaction', services.now())
    },
    async prepareEffect(request) {
      services.assertDigest(request)
      const requestedPath = requiredString(request.input.path, 'path')
      const content = stringValue(request.input.content, 'content')
      const target = await services.prepareCreatePath(requestedPath)
      return {
        backend: 'node-file-transaction',
        inputHash: request.actionDigest,
        expectedEffects: [{
          kind: 'file',
          path: target.relativePath,
          operation: 'create',
          beforeHash: null,
          afterHash: services.hashContent(content),
        }],
      }
    },
    async reconcileEffect(request, expectedEffects) {
      services.assertDigest(request)
      const expectation = expectedEffects[0]
      if (expectedEffects.length !== 1 || !expectation || expectation.operation !== 'create') {
        return { outcome: 'blocked', summary: 'create_file recovery evidence is incomplete' }
      }
      const actual = await services.inspectWritableFile(expectation.path)
      if (actual.state === 'present' && actual.hash === expectation.afterHash) {
        const at = services.now()
        return {
          outcome: 'completed',
          summary: `Recovered completed create for ${expectation.path}`,
          result: {
            requestId: request.id,
            ok: true,
            summary: `Created ${expectation.path}`,
            changedPaths: [expectation.path],
            startedAt: at,
            completedAt: at,
            metadata: { path: expectation.path, operation: 'create', afterHash: expectation.afterHash, reconciled: true },
          },
        }
      }
      if (actual.state === 'missing') {
        const at = services.now()
        return {
          outcome: 'not_applied',
          summary: `Create was not applied: ${expectation.path}`,
          result: {
            requestId: request.id,
            ok: false,
            summary: `Create was not applied: ${expectation.path}`,
            startedAt: at,
            completedAt: at,
            error: {
              code: 'TOOL_EXECUTION_FAILED',
              message: `Create was not applied: ${expectation.path}`,
              retryable: true,
              details: { recovery: 'not_applied', path: expectation.path },
            },
          },
        }
      }
      return { outcome: 'blocked', summary: `Create target differs from expected content: ${expectation.path}` }
    },
    async execute(request) {
      const startedAt = services.now()
      services.assertDigest(request)
      const requestedPath = requiredString(request.input.path, 'path')
      const content = stringValue(request.input.content, 'content')
      const created = await services.createFile(requestedPath, content)
      return {
        requestId: request.id,
        ok: true,
        summary: `Created ${created.path}`,
        changedPaths: [created.path],
        startedAt,
        completedAt: services.now(),
        metadata: { path: created.path, operation: 'create', afterHash: created.afterHash },
      }
    },
  }
}
