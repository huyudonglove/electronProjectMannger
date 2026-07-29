import { createHash } from 'node:crypto'

import { AgentCoreError, type ModelStreamEvent, type NormalizedUsage, type SessionSummary } from '@electron-manager/agent-core'
import {
  SessionSummarizerError,
  type SessionSummarizer,
  type SessionSummarizerInput,
  type SessionSummarizerResult,
} from '@electron-manager/agent-memory'
import type { ModelRouter } from '@electron-manager/agent-model-router'
import { SESSION_SUMMARIZER_PROMPT } from '@electron-manager/agent-prompts'

export function createModelRouteSessionSummarizer(
  router: ModelRouter,
  routeId: string,
  routeRevision: string,
): SessionSummarizer {
  return {
    summarize: (input) => summarize(router, routeId, routeRevision, input),
  }
}

async function summarize(
  router: ModelRouter,
  routeId: string,
  routeRevision: string,
  input: SessionSummarizerInput,
): Promise<SessionSummarizerResult> {
  const contextRevision = hash(canonicalJson({
    routeId,
    routeRevision,
    sourceRefs: input.sourceRefs,
    observations: input.observations,
  }))
  const usage: NormalizedUsage = { inputTokens: 0, outputTokens: 0 }
  let attemptCount = 0
  let summaryText = ''
  let terminal = false

  try {
    for await (const event of router.stream({
      runId: input.runId,
      turnId: `${input.runId}:summary:${contextRevision.slice(0, 16)}`,
      contextRevision,
      messages: summaryMessages(input),
      tools: [],
      maxOutputTokens: Math.min(2_000, router.profile.maxOutputTokens),
      allowedActions: ['finish'],
    })) {
      if (event.type === 'model_attempt') attemptCount += 1
      else if (event.type === 'usage') addUsage(usage, event)
      else if (event.type === 'action') {
        if (event.action.kind !== 'finish') throw new AgentCoreError('MODEL_ERROR', 'Summarizer route must return a finish action')
        summaryText = event.action.summary
      } else if (event.type === 'completed') terminal = true
      else if (event.type === 'error') throw new AgentCoreError('MODEL_ERROR', event.error.message)
    }
    if (!terminal || !summaryText.trim()) throw new AgentCoreError('MODEL_ERROR', 'Summarizer route returned no completed summary')
    return {
      summary: parseSummary(summaryText),
      routeId,
      routeRevision,
      attemptCount,
      usage,
    }
  } catch (error) {
    throw new SessionSummarizerError(
      error instanceof Error ? error.message : String(error),
      { routeId, routeRevision, attemptCount, usage },
      { cause: error },
    )
  }
}

function summaryMessages(input: SessionSummarizerInput) {
  return [{
    role: 'system' as const,
    content: SESSION_SUMMARIZER_PROMPT.text,
  }, {
    role: 'user' as const,
    content: canonicalJson({
      objective: input.objective,
      allowedSourceRefs: input.sourceRefs,
      observations: input.observations,
      deterministicSummary: input.deterministicSummary,
    }),
  }]
}

function parseSummary(value: string): SessionSummary {
  let parsed: unknown
  try {
    parsed = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
  } catch (error) {
    throw new AgentCoreError('MODEL_ERROR', 'Summarizer finish.summary is not valid JSON', { cause: error })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AgentCoreError('MODEL_ERROR', 'Summarizer finish.summary must be a JSON object')
  }
  return parsed as SessionSummary
}

function addUsage(target: NormalizedUsage, event: Extract<ModelStreamEvent, { type: 'usage' }>) {
  target.inputTokens += event.inputTokens
  target.outputTokens += event.outputTokens
  target.cachedInputTokens = (target.cachedInputTokens ?? 0) + (event.cachedInputTokens ?? 0)
  target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + (event.cacheWriteTokens ?? 0)
  target.reasoningTokens = (target.reasoningTokens ?? 0) + (event.reasoningTokens ?? 0)
  for (const key of ['cachedInputTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
    if (!target[key]) delete target[key]
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

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
