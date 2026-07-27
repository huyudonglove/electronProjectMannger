import type { ToolDescriptor, ToolModule } from '../tool-registry.js'
import { nativeAvailability, type LocalRuntimeServices } from '../runtime-services.js'

export const applyPatchToolDescriptor: ToolDescriptor = {
      name: 'apply_patch',
      version: '1.0.0',
      title: '应用补丁',
      description: 'Atomically apply exact text replacements across one or more existing UTF-8 project files.',
      useWhen: 'Use for bounded exact replacements after inspecting current file content and hashes.',
      avoidWhen: 'Do not use for fuzzy patches, shell patching, Git internals, or unreviewed broad rewrites.',
      risk: 'project_write',
      riskCategory: 'project_write',
      baseRiskLevel: 'medium',
      recovery: 'reconcile_then_resume',
      sideEffects: ['Modifies one or more existing project files'],
      retryable: false,
      backends: [{ id: 'node-file-transaction', kind: 'native' }],
      preferredBackendId: 'node-file-transaction',
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
}

export function createApplyPatchTool(services: LocalRuntimeServices): ToolModule {
  return {
    descriptor: applyPatchToolDescriptor,
    async probe() {
      return nativeAvailability('apply_patch', 'node-file-transaction', services.now())
    },
    async prepareEffect(request) {
      services.assertDigest(request)
      const operations = services.parsePatch(request.input.operations)
      const changes = await services.preparePatch(operations)
      return {
        backend: 'node-file-transaction',
        inputHash: request.actionDigest,
        expectedEffects: changes.map((change) => ({
          kind: 'file' as const,
          path: change.relativePath,
          operation: 'modify' as const,
          beforeHash: change.beforeHash,
          afterHash: change.afterHash,
        })),
      }
    },
    async reconcileEffect(request, expectedEffects) {
      services.assertDigest(request)
      if (!expectedEffects.length || expectedEffects.some((effect) => effect.operation !== 'modify' || !effect.beforeHash)) {
        return { outcome: 'blocked', summary: 'apply_patch recovery evidence is incomplete' }
      }
      const actual = await Promise.all(expectedEffects.map((effect) => services.inspectWritableFile(effect.path)))
      const allAfter = actual.every((file, index) => file.state === 'present' && file.hash === expectedEffects[index]!.afterHash)
      if (allAfter) {
        const at = services.now()
        return {
          outcome: 'completed',
          summary: `Recovered completed patch for ${expectedEffects.length} file(s)`,
          result: {
            requestId: request.id,
            ok: true,
            summary: `Patched ${expectedEffects.length} file(s)`,
            changedPaths: expectedEffects.map((effect) => effect.path),
            startedAt: at,
            completedAt: at,
            metadata: {
              files: expectedEffects.map((effect) => ({
                path: effect.path,
                beforeHash: effect.beforeHash,
                afterHash: effect.afterHash,
                reconciled: true,
              })),
            },
          },
        }
      }
      const allBefore = actual.every((file, index) => file.state === 'present' && file.hash === expectedEffects[index]!.beforeHash)
      if (allBefore) {
        const at = services.now()
        return {
          outcome: 'not_applied',
          summary: `Patch was not applied to ${expectedEffects.length} file(s)`,
          result: {
            requestId: request.id,
            ok: false,
            summary: `Patch was not applied to ${expectedEffects.length} file(s)`,
            startedAt: at,
            completedAt: at,
            error: {
              code: 'TOOL_EXECUTION_FAILED',
              message: 'Patch was not applied before restart',
              retryable: true,
              details: { recovery: 'not_applied' },
            },
          },
        }
      }
      return { outcome: 'blocked', summary: 'Patch targets do not consistently match before or after hashes' }
    },
    async execute(request) {
      const startedAt = services.now()
      services.assertDigest(request)
      const operations = services.parsePatch(request.input.operations)
      const changes = await services.applyPatch(operations)
      return {
        requestId: request.id,
        ok: true,
        summary: `Patched ${changes.length} file(s)`,
        changedPaths: changes.map((change) => change.path),
        startedAt,
        completedAt: services.now(),
        metadata: {
          files: changes.map((change) => ({ path: change.path, beforeHash: change.beforeHash, afterHash: change.afterHash })),
        },
      }
    },
  }
}
