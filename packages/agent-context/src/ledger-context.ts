import type { RunLedger, ToolDefinition } from '@electron-manager/agent-core'

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
      revision: '2',
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
      content: [
        'Return exactly one structured AgentTurnAction matching the response schema.',
        'Run facts and tool results are authoritative; never invent an inspection, tool result, verification, approval, file change, or evidence reference.',
        'Use inspect only during inspection and only with read tools. Use plan before standard or deep changes, and use plan again from acting or repairing when evidence materially invalidates the current plan.',
        'Use tool for the next concrete action. Use verify only for a configured verification check and its exact command. Use finish only when every required acceptance criterion and final diff can cite successful evidence. Use blocked only for a genuine external or goal-level blocker, not for ordinary uncertainty or a failed attempt.',
        'Give every tool request a unique stable id. Set absent optional tool fields to null; the runtime removes them before execution.',
      ].join(' '),
      sourceRefs: ['agent-core:action-protocol'],
    }],
  }
}

function capabilitySource(): ContextSource {
  return {
    descriptor: {
      id: 'builtin.capabilities',
      revision: '2',
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
      content: `Tool capabilities: ${canonicalJson([...tools]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(({ name, description, risk, riskCategory, baseRiskLevel }) => ({
          name,
          description,
          riskCategory: riskCategory || risk,
          baseRiskLevel,
        })))}`,
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
      revision: '2',
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
      content: `Select the next valid action for phase ${ledger.phase} at step ${ledger.stepCount}. ${phaseGuidance(ledger)}`,
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
    nextAction: ledger.nextAction,
  }
}

function phaseGuidance(ledger: RunLedger) {
  switch (ledger.phase) {
    case 'inspecting':
      return ledger.workLevel === 'light'
        ? 'Inspect relevant context, or act directly when the bounded task is already understood.'
        : 'Inspect relevant context, then return a concise plan before any change.'
    case 'planning':
      return 'Return one concise plan that keeps the objective and acceptance criteria unchanged.'
    case 'acting':
      return 'Take the next concrete tool action, revise the plan if new evidence materially invalidated it, or start configured verification when implementation is complete.'
    case 'repairing':
      return 'Use failure evidence to repair, revise the plan when necessary, or block only when recovery depends on external input.'
    case 'verifying':
      return 'Complete configured checks, gather read-only evidence and the final diff, then finish with evidence references.'
    case 'finalizing':
      return 'Finish only with complete acceptance evidence and a successful final diff reference.'
    default:
      return 'Follow the phase rules in the execution protocol.'
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
