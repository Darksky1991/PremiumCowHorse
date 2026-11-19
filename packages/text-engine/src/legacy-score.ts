// 旧编码的「常用字区」打分（设计第 4 节，自写）：按各编码自己的字节结构切分字符，
// 按字符所在区的常用程度加减分。只在样本已能被该编码 fatal 解码时使用（非法序列由调用方排除）。
//
// 分值的含义大致是「每个字符提供的证据」：
// - 全角假名对日文编码是强证据（+3），半角片假名较弱（+0.5，且检查浊点等的位置）；GB2312 的假名区对中文编码是反证（-2）。
// - 各编码的一级（常用）汉字区 +1，二级汉字区 0；标点区 +0.5。
// - 用户自定义区（解码为私用区 U+E000–）与罕见扩展区扣分。
// - windows-1252：孤立在 ASCII 之间的重音字母 / 常用符号 +1；连成串的高位字节 -1（CJK 文本的特征，「字母 + 引号」除外）；
//   未定义的 C1 码 -10。

export type LegacyLabel = 'shift_jis' | 'euc-jp' | 'gb18030' | 'big5' | 'windows-1252'

export const LEGACY_LABELS: readonly LegacyLabel[] = [
  'shift_jis',
  'euc-jp',
  'gb18030',
  'big5',
  'windows-1252'
]

const KANA = 3
/** 半角片假名单字节：比全角假名弱得多——中文双字节（首尾字节都在 A1–DF）按 Shift_JIS 读就是一串半角片假名 */
const HALFWIDTH_KANA = 0.5
/** 浊点 / 半浊点跟在不能加浊点的假名后，或小写假名 / 长音 / ﾝ 出现在串首 */
const MISPLACED_KANA = -2
const COMMON = 1
const PUNCT = 0.5
const KANA_IN_CHINESE = -2
const USER_DEFINED = -5
/** 合法但常用文本中少见的区（GBK 扩展区、GB18030 四字节） */
const RARE = -0.5

export function scoreLegacy(label: LegacyLabel, bytes: Uint8Array): number {
  switch (label) {
    case 'shift_jis':
      return scoreShiftJis(bytes)
    case 'euc-jp':
      return scoreEucJp(bytes)
    case 'gb18030':
      return scoreGb18030(bytes)
    case 'big5':
      return scoreBig5(bytes)
    case 'windows-1252':
      return scoreWindows1252(bytes)
  }
}

const inRange = (x: number, lo: number, hi: number): boolean => x >= lo && x <= hi
/** 第 i 个字节；超出末尾读作 0（样本末尾被截断的字符） */
const at = (b: Uint8Array, i: number): number => b[i] ?? 0

/**
 * 半角片假名（JIS X 0201，0xA1–0xDF）的一个字符。prev 为同一串半角片假名中的前一个字符（串首为 null）。
 * 浊点 ﾞ / 半浊点 ﾟ 只能跟在特定假名后面，长音 ｰ、小写 ｧ–ｯ、ﾝ 不能出现在串首——
 * 把中文双字节当作半角片假名读时这些规则经常被违反。
 */
function scoreHalfwidthKana(c: number, prev: number | null): number {
  const p = prev ?? 0
  const misplaced =
    (c === 0xde && !(p === 0xb3 || inRange(p, 0xb6, 0xc4) || inRange(p, 0xca, 0xce))) ||
    (c === 0xdf && !inRange(p, 0xca, 0xce)) ||
    (prev === null && (inRange(c, 0xa7, 0xb0) || c === 0xdd))
  return misplaced ? MISPLACED_KANA : HALFWIDTH_KANA
}

/** Shift_JIS 双字节字符（首字节 c、尾字节 d） */
function shiftJisDouble(c: number, d: number): number {
  if (c === 0x81) return PUNCT // 、。・ー「」（）等
  if (c === 0x82) return inRange(d, 0x9f, 0xf1) ? KANA : PUNCT // 平假名 / 全角英数字
  if (c === 0x83) return inRange(d, 0x40, 0x96) ? KANA : 0 // 片假名 / 希腊字母
  if (c === 0x87) return PUNCT // NEC 特殊字符 ① ㈱ №
  const code = (c << 8) | d
  if (inRange(code, 0x889f, 0x9872)) return COMMON // JIS 第一水准汉字
  if (inRange(c, 0xf0, 0xf9)) return USER_DEFINED // 外字区
  return 0
}

function scoreShiftJis(b: Uint8Array): number {
  let score = 0
  let prevKana: number | null = null
  // 上一个字符是否为 8E A1–DF：EUC-JP 的半角片假名（8E 前缀）按 Shift_JIS 读是同一区的第一水准汉字，
  // 连续出现是 EUC-JP 的特征（真实文本中同一区的汉字很少连续出现），从第二个起不加分
  let prevEucKana = false
  for (let i = 0; i < b.length;) {
    const c = at(b, i)
    if (inRange(c, 0xa1, 0xdf)) {
      score += scoreHalfwidthKana(c, prevKana)
      prevKana = c
      prevEucKana = false
      i++
      continue
    }
    prevKana = null
    if (!(inRange(c, 0x81, 0x9f) || inRange(c, 0xe0, 0xfc)) || i + 1 >= b.length) {
      prevEucKana = false
      i++
      continue
    }
    const d = at(b, i + 1)
    i += 2
    const eucKana = c === 0x8e && inRange(d, 0xa1, 0xdf)
    if (!(eucKana && prevEucKana)) score += shiftJisDouble(c, d)
    prevEucKana = eucKana
  }
  return score
}

/** EUC-JP 双字节字符（JIS X 0208，首字节 = 区 + 0xA0） */
function eucJpDouble(c: number): number {
  if (c === 0xa4 || c === 0xa5) return KANA // 平假名 / 片假名
  if (c === 0xa1 || c === 0xa3) return PUNCT // 标点 / 全角英数字
  if (inRange(c, 0xb0, 0xcf)) return COMMON // JIS 第一水准汉字
  return 0
}

function scoreEucJp(b: Uint8Array): number {
  let score = 0
  let prevKana: number | null = null
  for (let i = 0; i < b.length;) {
    const c = at(b, i)
    if (c === 0x8e) {
      // 半角片假名：8E + A1–DF
      const kana = at(b, i + 1)
      if (i + 1 < b.length) score += scoreHalfwidthKana(kana, prevKana)
      prevKana = kana
      i += 2
      continue
    }
    prevKana = null
    if (c === 0x8f) {
      i += 3 // JIS X 0212 补助汉字：罕见，不加分
    } else if (inRange(c, 0xa1, 0xfe) && i + 1 < b.length) {
      score += eucJpDouble(c)
      i += 2
    } else {
      i++
    }
  }
  return score
}

/** GBK 双字节字符（首字节 c、尾字节 d） */
function gbkDouble(c: number, d: number): number {
  if (d >= 0xa1) {
    if (c === 0xa1 || c === 0xa3) return PUNCT // 标点 / 全角英数字
    if (c === 0xa4 || c === 0xa5) return KANA_IN_CHINESE // GB2312 的假名区
    if (inRange(c, 0xb0, 0xd7)) return COMMON // GB2312 一级汉字
    if (inRange(c, 0xaa, 0xaf) || inRange(c, 0xf8, 0xfe)) return USER_DEFINED
    return 0
  }
  if (inRange(c, 0xa1, 0xa7)) return USER_DEFINED // A140–A7A0 用户自定义区
  return RARE // GBK 扩展区（尾字节 40–A0）：常用文本中少见（Big5 文本按 GBK 读时大量出现）
}

function scoreGb18030(b: Uint8Array): number {
  let score = 0
  for (let i = 0; i < b.length;) {
    const c = at(b, i)
    if (!inRange(c, 0x81, 0xfe) || i + 1 >= b.length) {
      i++
      continue
    }
    const d = at(b, i + 1)
    if (inRange(d, 0x30, 0x39)) {
      score += RARE // 四字节（GB18030 扩展：生僻字、表情）：合法但少见
      i += 4
    } else {
      score += gbkDouble(c, d)
      i += 2
    }
  }
  return score
}

/** Big5 双字节字符 */
function big5Double(c: number, d: number): number {
  const code = (c << 8) | d
  if (inRange(code, 0xa140, 0xa3bf)) return PUNCT // 标点、符号
  if (inRange(code, 0xa440, 0xc67e)) return COMMON // 常用字
  if (c <= 0xa0 || c >= 0xfa) return -1 // HKSCS：台湾的文本中少见
  return 0
}

function scoreBig5(b: Uint8Array): number {
  let score = 0
  for (let i = 0; i < b.length;) {
    const c = at(b, i)
    if (!inRange(c, 0x81, 0xfe) || i + 1 >= b.length) {
      i++
      continue
    }
    score += big5Double(c, at(b, i + 1))
    i += 2
  }
  return score
}

/** windows-1252 中常见的符号：€ … ‘ ’ “ ” • – — 不换行空格 £ § © ® ° ± · ½ */
const COMMON_1252_SYMBOLS = new Set([
  0x80, 0x85, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0xa0, 0xa3, 0xa7, 0xa9, 0xae, 0xb0, 0xb1,
  0xb7, 0xbd
])
/** windows-1252 中未定义的码（TextDecoder 解码为 C1 控制字符） */
const UNDEFINED_1252 = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d])
/** 能紧挨重音字母的标点：… ‘ ’ “ ” – — 不换行空格 °（如 café’s） */
const PUNCT_NEXT_TO_LETTER = new Set([0x85, 0x91, 0x92, 0x93, 0x94, 0x96, 0x97, 0xa0, 0xb0])

const is1252Letter = (c: number): boolean => c >= 0xc0 && c !== 0xd7 && c !== 0xf7

/** 两个相连的高位字节是否像西欧文本（重音字母紧挨引号 / 破折号等） */
const is1252Pair = (a: number, b: number): boolean =>
  (is1252Letter(a) && PUNCT_NEXT_TO_LETTER.has(b)) ||
  (PUNCT_NEXT_TO_LETTER.has(a) && is1252Letter(b))

function scoreWindows1252(b: Uint8Array): number {
  let score = 0
  for (let i = 0; i < b.length;) {
    if (at(b, i) < 0x80) {
      i++
      continue
    }
    // 一串连续的高位字节：西欧文本里通常只有 1 个，偶尔是「字母 + 引号」这样的 2 个；更长的是 CJK 文本的特征
    let end = i
    while (end < b.length && at(b, end) >= 0x80) end++
    const run = b.subarray(i, end)
    const plausible = run.length === 1 || (run.length === 2 && is1252Pair(at(run, 0), at(run, 1)))
    for (const c of run) {
      if (UNDEFINED_1252.has(c)) score -= 10
      else if (!plausible) score -= 1
      else if (is1252Letter(c) || COMMON_1252_SYMBOLS.has(c)) score += 1
    }
    i = end
  }
  return score
}
