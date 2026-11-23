/**
 * 筛选用的文本匹配（命令面板与工作区选择器共用，D5）：
 * NFKC（半角片假名 → 全角、全角英数 → 半角）+ 小写 + 平假名 → 片假名。
 * 名称前缀 > 名称包含 > 说明包含。
 */

/** 平假名（ぁ–ゖ）转片假名：码位相差 0x60 */
function hiraganaToKatakana(s: string): string {
  return s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
}

export function normalizeForMatch(s: string): string {
  return hiraganaToKatakana(s.normalize('NFKC').toLowerCase())
}

/**
 * 匹配得分：名称前缀 3、名称包含 2、说明包含 1，不匹配返回 null。
 * 查询按首尾空白修剪；空查询匹配一切（按名称前缀得 3）
 */
export function matchScore(
  query: string,
  name: string,
  description?: string | null
): number | null {
  const q = normalizeForMatch(query).trim()
  const n = normalizeForMatch(name)
  if (n.startsWith(q)) return 3
  if (n.includes(q)) return 2
  if (description != null && normalizeForMatch(description).includes(q)) return 1
  return null
}
