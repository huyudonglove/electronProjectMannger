export function isMeaningfulThoughtAnswer(answer: string) {
  const normalized = String(answer || '')
    .trim()
    .toLowerCase()
    .replace(/[。.!！?？\s]+$/g, '')
  return Boolean(normalized) && ![
    '无',
    '暂无',
    '暂无回答',
    '待回答',
    '待处理',
    '待补充',
    'none',
    'n/a',
  ].includes(normalized)
}
