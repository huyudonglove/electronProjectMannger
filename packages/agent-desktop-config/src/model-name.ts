export const MAX_DESKTOP_MODEL_NAME_LENGTH = 128
export const FALLBACK_OPENAI_MODEL_CAPABILITIES = {
  contextWindow: 128_000,
  maxOutputTokens: 16_000,
} as const

export function normalizeDesktopModelName(value: unknown) {
  const model = String(value ?? '').trim()
  if (!model) throw new Error('OpenAI model name is required')
  if (model.length > MAX_DESKTOP_MODEL_NAME_LENGTH) {
    throw new Error(`OpenAI model name must not exceed ${MAX_DESKTOP_MODEL_NAME_LENGTH} characters`)
  }
  if (/[\u0000-\u001f\u007f]/.test(model)) {
    throw new Error('OpenAI model name contains unsupported control characters')
  }
  return model
}

export function desktopOpenAIModelCapabilities(value: unknown) {
  const model = normalizeDesktopModelName(value)
  if (model === 'gpt-5.6-luna' || model.startsWith('gpt-5.6-luna-')) {
    return { contextWindow: 400_000, maxOutputTokens: 128_000 }
  }
  if (
    model === 'gpt-5.6'
    || model === 'gpt-5.6-sol'
    || model.startsWith('gpt-5.6-sol-')
    || model === 'gpt-5.6-terra'
    || model.startsWith('gpt-5.6-terra-')
  ) {
    return { contextWindow: 1_050_000, maxOutputTokens: 128_000 }
  }
  return { ...FALLBACK_OPENAI_MODEL_CAPABILITIES }
}
