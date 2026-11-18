import type { SearchTerm } from './types'

/**
 * 解析搜索框文本：空白分隔，空词丢弃；含 * 或 ? 的词为 glob，其余为 contains。
 * 扫描进程（SQL）与主进程（固定的单个文件条目）共用本解析与 matchesName，匹配规则只有这一份。
 */
export function parseQuery(text: string): { terms: SearchTerm[] } {
  const terms: SearchTerm[] = []
  for (const w of text.split(/\s+/)) {
    if (w === '') continue
    terms.push({ kind: /[*?]/.test(w) ? 'glob' : 'contains', value: w })
  }
  return { terms }
}

function globToRegExp(pattern: string): RegExp {
  let src = ''
  for (const ch of pattern) {
    if (ch === '*') src += '.*'
    else if (ch === '?') src += '.'
    else src += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${src}$`, 'is')
}

/** 名称是否匹配全部词（AND）。没有词时不匹配（空查询没有结果） */
export function matchesName(name: string, terms: SearchTerm[]): boolean {
  if (terms.length === 0) return false
  const lower = name.toLowerCase()
  return terms.every((t) =>
    t.kind === 'contains' ? lower.includes(t.value.toLowerCase()) : globToRegExp(t.value).test(name)
  )
}
