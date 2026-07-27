import {
  AgentCoreError,
  type AgentRuntime,
  type EffectExpectation,
  type EffectReconcileResult,
  type RuntimeContext,
  type RuntimeToolSnapshot,
  type ToolEffectPlan,
  type ToolRequest,
  type ToolResult,
} from '@electron-manager/agent-core'

import {
  DEFAULT_OUTPUT_PREVIEW_CHARACTERS,
  createOutputPreview,
  type OutputStore,
} from './protocol.js'

export interface OutputExternalizingRuntimeOptions {
  previewCharacters?: number
}

export class OutputExternalizingRuntime implements AgentRuntime {
  readonly delegate: AgentRuntime
  readonly store: OutputStore
  readonly previewCharacters: number

  constructor(delegate: AgentRuntime, store: OutputStore, options: OutputExternalizingRuntimeOptions = {}) {
    this.delegate = delegate
    this.store = store
    this.previewCharacters = nonNegativeInteger(
      options.previewCharacters ?? DEFAULT_OUTPUT_PREVIEW_CHARACTERS,
      'previewCharacters',
    )
  }

  async execute(request: ToolRequest, context: RuntimeContext, signal?: AbortSignal): Promise<ToolResult> {
    return await this.#externalize(await this.delegate.execute(request, context, signal))
  }

  async prepareEffect(request: ToolRequest, context: RuntimeContext): Promise<ToolEffectPlan> {
    if (!this.delegate.prepareEffect) throw unsupported('prepareEffect')
    return await this.delegate.prepareEffect(request, context)
  }

  async reconcileEffect(
    request: ToolRequest,
    expectedEffects: EffectExpectation[],
    context: RuntimeContext,
  ): Promise<EffectReconcileResult> {
    if (!this.delegate.reconcileEffect) throw unsupported('reconcileEffect')
    const reconciled = await this.delegate.reconcileEffect(request, expectedEffects, context)
    if (!reconciled.result) return reconciled
    return { ...reconciled, result: await this.#externalize(reconciled.result) }
  }

  async snapshotTools(): Promise<RuntimeToolSnapshot> {
    if (!this.delegate.snapshotTools) throw unsupported('snapshotTools')
    return await this.delegate.snapshotTools()
  }

  async #externalize(result: ToolResult): Promise<ToolResult> {
    if (result.output === undefined) return result
    const artifact = result.outputRef
      ? undefined
      : await this.store.put(result.output, { createdAt: result.completedAt })
    const preview = createOutputPreview(result.output, this.previewCharacters)
    return {
      ...result,
      output: preview.text,
      outputRef: result.outputRef || artifact!.ref,
      metadata: {
        ...result.metadata,
        ...(artifact ? {
          outputBytes: artifact.bytes,
          outputCharacters: artifact.characters,
        } : {}),
        outputPreviewCharacters: preview.text.length,
        outputPreviewTruncated: preview.truncated,
        outputPreviewOmittedCharacters: preview.omittedCharacters,
      },
    }
  }
}

function nonNegativeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new AgentCoreError('INVALID_INPUT', `${name} must be a non-negative integer`)
  return value
}

function unsupported(method: string) {
  return new AgentCoreError('INTERNAL_ERROR', `Wrapped runtime does not implement ${method}`)
}
