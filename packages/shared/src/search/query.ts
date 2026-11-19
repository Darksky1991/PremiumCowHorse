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

/**
 * 正则的字面转义。glob 以 u 标志编译：? 匹配一个码点（代理对字符如 𠮷 算一个字符，与 SQLite 的
 * GLOB 按字符匹配一致）。u 模式只允许转义语法字符，这里转义的全部是语法字符（* ? 另行处理）。
 */
const escapeRegExp = (ch: string): string => ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')

function globToRegExp(pattern: string): RegExp {
  let src = ''
  for (const ch of pattern) {
    if (ch === '*') src += '.*'
    else if (ch === '?') src += '.'
    else src += escapeRegExp(ch)
  }
  return new RegExp(`^${src}$`, 'isu')
}

/** 名称是否匹配全部词（AND）。没有词时不匹配（空查询没有结果） */
export function matchesName(name: string, terms: SearchTerm[]): boolean {
  if (terms.length === 0) return false
  const lower = name.toLowerCase()
  return terms.every((t) =>
    t.kind === 'contains' ? lower.includes(t.value.toLowerCase()) : globToRegExp(t.value).test(name)
  )
}

/** 名称中的一段 [start, end)（UTF-16 下标），供界面高亮 */
export interface MatchRange {
  start: number
  end: number
}

/** glob 的字面部分各成一个捕获组（通配符不高亮）；匹配的名称集合与 globToRegExp 相同 */
function globToGroupedRegExp(pattern: string): RegExp {
  let src = ''
  let literal = ''
  const flush = (): void => {
    if (literal !== '') src += `(${literal})`
    literal = ''
  }
  for (const ch of pattern) {
    if (ch === '*' || ch === '?') {
      flush()
      src += ch === '*' ? '.*' : '.'
    } else {
      literal += escapeRegExp(ch)
    }
  }
  flush()
  return new RegExp(`^${src}$`, 'isdu')
}

/**
 * 名称中与搜索词匹配的片段（已排序、重叠与相邻的合并）。规则与 matchesName 相同：
 * 名称不匹配全部词时返回空数组；包含词标出所有出现位置，通配词标出字面部分。
 * toLowerCase 改变长度的名称（如 'İ'）无法把下标对应回原名称，此时不标包含词。
 */
export function matchRanges(name: string, terms: SearchTerm[]): MatchRange[] {
  if (!matchesName(name, terms)) return []
  const ranges: MatchRange[] = []
  const lower = name.toLowerCase()
  const sameLength = lower.length === name.length
  for (const t of terms) {
    if (t.kind === 'contains') {
      if (!sameLength) continue
      const needle = t.value.toLowerCase()
      for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, i + 1)) {
        ranges.push({ start: i, end: i + needle.length })
      }
    } else {
      const indices = globToGroupedRegExp(t.value).exec(name)?.indices ?? []
      for (let g = 1; g < indices.length; g++) {
        const pair = indices[g]
        if (pair) ranges.push({ start: pair[0], end: pair[1] })
      }
    }
  }
  ranges.sort((a, b) => a.start - b.start)
  const merged: MatchRange[] = []
  for (const r of ranges) {
    const last = merged.at(-1)
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else merged.push({ ...r })
  }
  return merged
}
