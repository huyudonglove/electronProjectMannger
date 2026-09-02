export function renderReadableMarkdown(markdown: string) {
  const lines = String(markdown || '').split(/\r?\n/)
  const html: string[] = []
  let listOpen = false
  let codeOpen = false
  let codeLanguage = ''
  let codeLines: string[] = []
  const closeList = () => {
    if (listOpen) {
      html.push('</ul>')
      listOpen = false
    }
  }
  const closeCode = () => {
    if (!codeOpen) return
    html.push(`<pre${codeLanguage ? ` data-language="${escapeHtml(codeLanguage)}"` : ''}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    codeOpen = false
    codeLanguage = ''
    codeLines = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const fence = rawLine.trim().match(/^```([A-Za-z0-9_-]+)?\s*$/)
    if (fence) {
      if (codeOpen) closeCode()
      else {
        closeList()
        codeOpen = true
        codeLanguage = fence[1] || ''
        codeLines = []
      }
      continue
    }
    if (codeOpen) {
      codeLines.push(rawLine)
      continue
    }
    const line = rawLine.trim()
    if (!line) {
      closeList()
      continue
    }
    if (isMarkdownTableHeader(line, lines[index + 1] || '')) {
      closeList()
      const tableLines = [line, lines[index + 1].trim()]
      index += 2
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        tableLines.push(lines[index].trim())
        index += 1
      }
      index -= 1
      html.push(renderMarkdownTable(tableLines))
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      closeList()
      const level = heading[1].length <= 2 ? 'h4' : 'h5'
      html.push(`<${level}>${escapeHtml(heading[2])}</${level}>`)
      continue
    }
    const field = parseMarkdownMetadataField(line)
    if (field) {
      closeList()
      const fields = [field]
      while (index + 1 < lines.length) {
        const nextField = parseMarkdownMetadataField(lines[index + 1].trim())
        if (!nextField) break
        fields.push(nextField)
        index += 1
      }
      html.push(renderMarkdownMetadataDetails(fields))
      continue
    }
    const item = line.match(/^[-*]\s+(.+)$/)
    if (item) {
      if (!listOpen) {
        html.push('<ul>')
        listOpen = true
      }
      html.push(`<li>${renderInlineMarkdown(item[1])}</li>`)
      continue
    }
    closeList()
    html.push(`<p>${renderInlineMarkdown(line)}</p>`)
  }
  closeList()
  closeCode()
  return html.join('') || '<p class="empty">暂无内容</p>'
}

function parseMarkdownMetadataField(line: string) {
  const match = line.match(/^([A-Za-z0-9_-]+)::\s*(.+)$/)
  return match ? { key: match[1], value: match[2] } : null
}

function renderMarkdownMetadataDetails(fields: Array<{ key: string, value: string }>) {
  const rows = fields
    .map(({ key, value }) => `<p class="log-meta-line"><span>${escapeHtml(key)}</span>${escapeHtml(value)}</p>`)
    .join('')
  return `<details class="markdown-meta-details"><summary><span>记录信息</span><small>${fields.length} 项</small></summary><div class="markdown-meta-content">${rows}</div></details>`
}

function isMarkdownTableHeader(line: string, nextLine: string) {
  return isMarkdownTableRow(line) && isMarkdownTableSeparator(nextLine)
}

function isMarkdownTableRow(line: string) {
  const text = String(line || '').trim()
  return text.includes('|') && splitMarkdownTableRow(text).length > 1
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(String(line || '').trim())
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
}

function splitMarkdownTableRow(line: string) {
  const normalized = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  let escaped = false
  for (const char of normalized) {
    if (escaped) {
      cell += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '|') {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += char
  }
  cells.push(cell.trim())
  return cells
}

function renderMarkdownTable(lines: string[]) {
  const header = splitMarkdownTableRow(lines[0])
  const rows = lines.slice(2).map(splitMarkdownTableRow)
  const cellCount = Math.max(header.length, ...rows.map((row) => row.length))
  const normalizeCells = (cells: string[]) => Array.from({ length: cellCount }, (_, index) => cells[index] || '')
  const head = normalizeCells(header).map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join('')
  const body = rows
    .map((row) => `<tr>${normalizeCells(row).map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`)
    .join('')
  return `<div class="markdown-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

export function renderInlineMarkdown(value: string) {
  return escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

export function escapeHtml(value: unknown) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
