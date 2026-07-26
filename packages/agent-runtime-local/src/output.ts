export interface LimitedText {
  text: string
  truncated: boolean
  originalChars: number
}

export function limitText(value: string, maxChars: number): LimitedText {
  const limit = Math.max(0, Math.floor(maxChars))
  if (value.length <= limit) return { text: value, truncated: false, originalChars: value.length }
  if (limit === 0) return { text: '', truncated: true, originalChars: value.length }
  const suffix = `\n… output truncated (${value.length - limit} chars omitted)`
  if (suffix.length >= limit) return { text: value.slice(0, limit), truncated: true, originalChars: value.length }
  return {
    text: `${value.slice(0, limit - suffix.length)}${suffix}`,
    truncated: true,
    originalChars: value.length,
  }
}
