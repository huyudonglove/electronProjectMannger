export function firstContentSummary(content: string) {
  const text = stripFencedCode(content)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#+\s+/.test(line) && !/^[A-Za-z0-9_-]+::\s*/.test(line) && !/^>/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 120)
}

export function stripFencedCode(content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  let inFence = false
  return lines
    .filter((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence
        return false
      }
      return !inFence
    })
    .join('\n')
}

export function parseFields(block: string) {
  const fields: Record<string, string> = {}
  const lines = stripFencedCode(block).split('\n')
  const headingIndex = lines.findIndex((line) => /^#{1,2}\s+/.test(line))
  let started = false
  for (const line of lines.slice(headingIndex >= 0 ? headingIndex + 1 : 0)) {
    if (!line.trim() && !started) continue
    const match = line.match(/^([A-Za-z0-9_-]+)::\s*(.+)$/)
    if (!match) {
      if (started) break
      continue
    }
    started = true
    fields[match[1]] = match[2].trim()
  }
  return fields
}

export function readSection(content: string, titles: string[]) {
  const escaped = titles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const match = content.match(new RegExp(`###\\s+(?:${escaped})\\s+([\\s\\S]*?)(?=\\n### |$)`))
  return (match?.[1] || '').trim()
}

export function readListSection(content: string, titles: string[]) {
  return listSectionItems(readSection(content, titles))
}

export function listSectionItems(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s+/, ''))
    .filter((line) => line && !/^(?:无|暂无|没有|none|n\/a)[。.!！]?$/i.test(line))
}

export function splitMarkdownBlocks(content: string) {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const offsets: number[] = []
  let offset = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^##\s+/.test(line) && isRecordHeading(lines, index)) offsets.push(offset)
    offset += line.length + 1
  }

  if (!offsets.length) return [normalized]

  const blocks = [normalized.slice(0, offsets[0]).trimEnd()]
  offsets.forEach((start, index) => {
    const end = offsets[index + 1] ?? normalized.length
    blocks.push(normalized.slice(start, end).trim())
  })
  return blocks.filter((block, index) => index === 0 || Boolean(block))
}

export function isRecordHeading(lines: string[], headingIndex: number) {
  const fields: Record<string, string> = {}
  let started = false

  for (let index = headingIndex + 1; index < Math.min(lines.length, headingIndex + 32); index += 1) {
    const line = lines[index]
    if (!line.trim() && !started) continue
    if (/^#{1,3}\s+/.test(line)) break
    const match = line.match(/^([A-Za-z0-9_-]+)::\s*(.+)$/)
    if (!match) {
      if (started) break
      continue
    }
    started = true
    fields[match[1]] = match[2].trim()
  }

  return Boolean(fields.short_id || fields.log_short_id || (fields.id && fields.type))
}
