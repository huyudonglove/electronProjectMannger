export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

export function normalizeDesktopOpenAIBaseUrl(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return DEFAULT_OPENAI_BASE_URL
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error('模型服务地址无效')
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) throw new Error('模型服务地址无效')
  return url.toString().replace(/\/+$/, '')
}
