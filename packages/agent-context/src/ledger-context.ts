import type { RunLedger, ToolDefinition } from '@electron-manager/agent-core'
import {
  CODER_ACTION_PROTOCOL_PROMPT,
  NEXT_ACTION_PROMPT,
  TOOL_CATALOG_PROMPT,
  renderNextActionPrompt,
  renderToolCatalogPrompt,
} from '@electron-manager/agent-prompts'

import { ContextAssembler } from './assembler.js'
import { ContextSourceRegistry } from './registry.js'
import type { ContextBudget, ContextCompactor, ContextSource } from './types.js'

export function createLedgerContextAssembler(budget: ContextBudget, compactor?: ContextCompactor) {
  return new ContextAssembler({
    budget,
    registry: new ContextSourceRegistry(createLedgerContextSources()),
    ...(compactor ? { compactor } : {}),
  })
}

export function createLedgerContextSources(): ContextSource[] {
  return [systemSource(), capabilitySource(), runFactsSource(), toolResultsSource(), newestTurnSource()]
}

function systemSource(): ContextSource {
  return {
    descriptor: {
      id: 'builtin.system-protocol',
      revision: CODER_ACTION_PROTOCOL_PROMPT.revision,
      region: 'stable_system_prefix',
      scope: 'system',
      trust: 'trusted_system',
      priority: 100,
      required: true,
      compressible: false,
      maxTokens: 4_000,
    },
    collect: () => [{
      id: 'agent-action-protocol',
      role: 'system',
      content: CODER_ACTION_PROTOCOL_PROMPT.text,
      sourceRefs: ['agent-core:action-protocol'],
    }],
  }
}

function capabilitySource(): ContextSource {
  return {
    descriptor: {
      id: 'builtin.capabilities',
      revision: TOOL_CATALOG_PROMPT.revision,
      region: 'stable_capability_prefix',
      scope: 'capability',
      trust: 'trusted_system',
      priority: 95,
      required: true,
      compressible: false,
      maxTokens: 4_000,
    },
    collect: ({ tools }) => [{
      id: 'tool-catalog',
      role: 'system',
      content: renderToolCatalogPrompt(canonicalJson([...tools]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(({ name, description, risk, riskCategory, baseRiskLevel }) => ({
          name,
          description,
          riskCategory: riskCategory || risk,
          baseRiskLevel,
        })))),
      sourceRefs: tools.map((tool) => `tool:${tool.name}`).sort(),
    }],
  }
}

function runFactsSource(): ContextSource {
  return {
    descriptor: {
      id: 'builtin.run-facts',
      revision: '1',
      region: 'recent_dynamic_context',
      scope: 'run',
      trust: 'trusted_run',
      priority: 100,
      required: true,
      compressible: false,
      maxTokens: 60_000,
    },
    collect: ({ ledger }) => [{
      id: `run-facts-step-${ledger.stepCount}`,
      role: 'user',
      content: canonicalJson(runFacts(ledger)),
      sourceRefs: [`run:${ledger.runId}:ledger`],
      sequence: ledger.stepCount * 1_000 + 100,
    }],
  }
}

function toolResultsSource(): ContextSource {
  return {
    descriptor: {
      id: 'builtin.tool-results',
      revision: '1',
      region: 'recent_dynamic_context',
      scope: 'session',
      trust: 'untrusted',
      priority: 90,
      required: false,
      compressible: true,
      maxTokens: 30_000,
    },
    collect: ({ ledger }) => ledger.toolExecutions
      .filter((execution) => execution.result)
      .slice(-12)
      .map((execution, index) => ({
        id: `tool-result-${execution.request.id}`,
        role: 'tool' as const,
        toolRequestId: execution.request.id,
        content: canonicalJson({
          tool: execution.request.name,
          ok: execution.result!.ok,
          summary: execution.result!.summary,
          output: execution.result!.output,
          error: execution.result!.error,
        }),
        sourceRefs: [`tool-request:${execution.request.id}`],
        sequence: ledger.stepCount * 1_000 + 200 + index,
      })),
  }
}

function newestTurnSource(): ContextSource {
  return {
    descriptor: {
      id: 'builtin.newest-turn',
      revision: NEXT_ACTION_PROMPT.revision,
      region: 'newest_message',
      scope: 'session',
      trust: 'trusted_run',
      priority: 100,
      required: true,
      compressible: false,
      maxTokens: 1_000,
    },
    collect: ({ ledger }) => [{
      id: `turn-${ledger.stepCount}`,
      role: 'user',
      content: renderNextActionPrompt({
        phase: ledger.phase,
        step: ledger.stepCount,
        workLevel: ledger.workLevel,
      }),
      sourceRefs: [`run:${ledger.runId}:step:${ledger.stepCount}`],
      sequence: ledger.stepCount * 1_000 + 999,
    }],
  }
}

function runFacts(ledger: RunLedger) {
  return {
    runId: ledger.runId,
    phase: ledger.phase,
    objective: ledger.objective,
    constraints: ledger.constraints,
    workLevel: ledger.workLevel,
    intent: ledger.intent,
    acceptanceCriteria: ledger.acceptanceCriteria,
    verificationPlan: ledger.verificationPlan,
    inspectedFiles: ledger.inspectedFiles,
    decisions: ledger.decisions.slice(-12),
    changes: ledger.changes,
    verifications: ledger.verifications,
    failures: ledger.failures,
    successfulEvidenceRefs: [
      ...ledger.toolExecutions
        .filter((execution) => execution.result?.ok)
        .map((execution) => execution.request.id),
      ...ledger.verifications
        .filter((verification) => verification.status === 'passed')
        .map((verification) => verification.checkId),
    ],
    nextAction: ledger.nextAction,
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
