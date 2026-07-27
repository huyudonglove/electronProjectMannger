import path from 'node:path'

import {
  AgentCoreError,
  toAgentError,
  type AgentRuntime,
  type EffectExpectation,
  type EffectReconcileResult,
  type RuntimeToolSnapshot,
  type RuntimeContext,
  type ToolDefinition,
  type ToolEffectPlan,
  type ToolRequest,
  type ToolResult,
} from '@electron-manager/agent-core'

import { createLocalToolModules } from './local-tools.js'
import { resolveProjectPath } from './path-guard.js'
import { LocalRuntimeServices } from './runtime-services.js'
import { ToolRegistry, type ToolModule, type ToolRegistrySnapshot } from './tool-registry.js'

export interface LocalRuntimeOptions {
  maxOutputChars?: number
  timeoutMs?: number
  maxWriteChars?: number
  allowedPackageScripts?: string[]
  clock?: () => string
  modules?: ToolModule[]
}

export class LocalAgentRuntime implements AgentRuntime {
  readonly projectRoot: string
  readonly maxOutputChars: number
  readonly timeoutMs: number
  readonly maxWriteChars: number
  readonly allowedPackageScripts?: string[]
  readonly services: LocalRuntimeServices
  readonly registry: ToolRegistry
  readonly #clock: () => string

  constructor(projectRoot: string, options: LocalRuntimeOptions = {}) {
    this.projectRoot = path.resolve(projectRoot)
    this.maxOutputChars = options.maxOutputChars ?? 20_000
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.maxWriteChars = options.maxWriteChars ?? 1_000_000
    this.allowedPackageScripts = options.allowedPackageScripts
    this.#clock = options.clock || (() => new Date().toISOString())
    this.services = new LocalRuntimeServices(this.projectRoot, {
      maxOutputChars: this.maxOutputChars,
      timeoutMs: this.timeoutMs,
      maxWriteChars: this.maxWriteChars,
      ...(this.allowedPackageScripts ? { allowedPackageScripts: this.allowedPackageScripts } : {}),
      clock: this.#clock,
    })
    this.registry = new ToolRegistry(options.modules || createLocalToolModules(this.services))
  }

  toolDefinitions(): ToolDefinition[] {
    return this.registry.definitions()
  }

  probeTools(): Promise<ToolRegistrySnapshot> {
    return this.registry.probe()
  }

  async snapshotTools(): Promise<RuntimeToolSnapshot> {
    const snapshot = await this.probeTools()
    return {
      schemaVersion: snapshot.schemaVersion,
      revision: snapshot.revision,
      data: JSON.parse(JSON.stringify({ tools: snapshot.tools })) as RuntimeToolSnapshot['data'],
    }
  }

  async prepareEffect(request: ToolRequest, context: RuntimeContext): Promise<ToolEffectPlan> {
    await this.#assertAllowedContext(context)
    return await this.registry.prepareEffect(request)
  }

  async reconcileEffect(
    request: ToolRequest,
    expectedEffects: EffectExpectation[],
    context: RuntimeContext,
  ): Promise<EffectReconcileResult> {
    await this.#assertAllowedContext(context)
    return await this.registry.reconcileEffect(request, expectedEffects)
  }

  async execute(request: ToolRequest, context: RuntimeContext, signal?: AbortSignal): Promise<ToolResult> {
    const startedAt = this.#clock()
    try {
      if (signal?.aborted) throw new AgentCoreError('CANCELLED', 'Tool request was cancelled')
      await this.#assertAllowedContext(context)
      return await this.registry.execute(request, context, signal)
    } catch (error) {
      return {
        requestId: request.id,
        ok: false,
        summary: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt: this.#clock(),
        error: toAgentError(error, 'TOOL_EXECUTION_FAILED'),
      }
    }
  }

  async #assertContext(context: RuntimeContext) {
    const configured = await resolveProjectPath(this.projectRoot)
    const requested = await resolveProjectPath(context.projectRoot)
    if (configured.projectRoot !== requested.projectRoot) {
      throw new AgentCoreError('PATH_OUTSIDE_PROJECT', 'Runtime context project root does not match configured project root')
    }
  }

  async #assertAllowedContext(context: RuntimeContext) {
    await this.#assertContext(context)
    if (context.permission.effect === 'deny') throw new AgentCoreError('PERMISSION_DENIED', context.permission.reason)
    if (context.permission.effect === 'ask') throw new AgentCoreError('APPROVAL_REQUIRED', context.permission.reason)
  }
}

export { LocalAgentRuntime as LocalReadRuntime }
