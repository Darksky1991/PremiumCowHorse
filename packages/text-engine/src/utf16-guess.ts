// 无 BOM 的 UTF-16 判断（设计 3.4 第 2 条 / 第 4 节）。两条路径：
// 1. NUL 分布：ASCII 字符的高位字节是 0x00，LE 时集中在奇数位、BE 时集中在偶数位；再要求按 UTF-16 读出的码点几乎都是可显示文字。
// 2. 纯中日文（没有 ASCII，也就没有 NUL）：按字节编码都解释不通（UTF-8 不合法；Shift_JIS / EUC-JP / GB18030 / Big5
//    不合法或常用字区打分不为正），且按某一字节序读出的码点集中在 CJK / 假名区。
//    先排除字节编码是因为 ASCII 与 Shift_JIS 片假名按 UTF-16LE 读也常落在 CJK 区（'ex' = U+7865）；
//    只看「合法」不够：UTF-16LE 的片假名（D5 30 A1 30 …）恰好是合法的 GB18030 四字节序列。
//    windows-1252 总能解码，因此另看「像不像西欧文本」：打分为正，且字母 / 空格 / 常用标点占字节的大多数
//    （西欧短文本按 UTF-16 读时小写字母两两组成 U+6100–7AFF 的汉字，曾被误判）。
import { scoreLegacy, type LegacyLabel } from './legacy-score'
import { decodesStrictly } from './strict-decode'

type Utf16Label = 'utf-16le' | 'utf-16be'

/** ASCII 高位字节为 0 的单元至少占这个比例 */
const MIN_NUL_UNITS = 0.1
/** 另一侧的 NUL 最多是这一侧的这个比例（CJK 中 U+4E00「一」等低位为 0 的字符会在另一侧产生少量 NUL） */
const MAX_STRAY_NUL = 0.25
/** NUL 路径：可显示文字的单元至少占这个比例 */
const MIN_PLAUSIBLE = 0.95
/** 纯中日文路径：CJK / 假名区的单元至少占这个比例 */
const MIN_CJK = 0.9
/** 纯中日文路径：至少这么多个 UTF-16 单元 */
const MIN_PURE_UNITS = 8
/**
 * 「像西欧文本」：ASCII 文本字符占字节的比例下限。实测（样本集原文的子串）纯中日文 UTF-16 的中位数约 0.37、
 * 8 字的 99.9 百分位约 0.75（多为 U+61xx–7Axx 的汉字与 U+20xx 的标点）；英文行最低约 0.69、中位数约 0.93。
 * 与 windows-1252 打分为正同时要求：只看打分会漏判短的纯中日文 UTF-16（8 字的检出率实测从 61% 降到 42%），
 * 只看比例则两者的分布有重叠。
 */
const MIN_WESTERN_TEXT = 0.6
/** ASCII 文本字符：空格、字母、数字 1–9（不含 0：假名 U+30xx 的一个字节就是 0x30）、常用标点 */
const WESTERN_TEXT_BYTES = new Set(
  [...' ,.:;\'"()/=-_!?#@%&*+123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'].map(
    (c) => c.charCodeAt(0)
  )
)

const CJK_BYTE_ENCODINGS: LegacyLabel[] = ['shift_jis', 'euc-jp', 'gb18030', 'big5']

export function guessUtf16(head: Uint8Array): Utf16Label | null {
  const bytes = head.subarray(0, head.length & ~1)
  const units = bytes.length / 2
  if (units < 1) return null
  let evenNul = 0
  let oddNul = 0
  for (let i = 0; i < bytes.length; i += 2) {
    if (bytes[i] === 0) evenNul++
    if (bytes[i + 1] === 0) oddNul++
  }
  if (oddNul >= units * MIN_NUL_UNITS && evenNul <= oddNul * MAX_STRAY_NUL) {
    return measure(bytes, 'utf-16le').plausible >= MIN_PLAUSIBLE ? 'utf-16le' : null
  }
  if (evenNul >= units * MIN_NUL_UNITS && oddNul <= evenNul * MAX_STRAY_NUL) {
    return measure(bytes, 'utf-16be').plausible >= MIN_PLAUSIBLE ? 'utf-16be' : null
  }
  // 纯中日文路径：NUL 很少（只有换行 U+000A 等）。太短的样本不判断（3 个字符随机落在 CJK 区的概率不低）
  if (units < MIN_PURE_UNITS) return null
  if (byteEncodingExplains(head)) return null
  const le = measure(bytes, 'utf-16le').cjk >= MIN_CJK
  const be = measure(bytes, 'utf-16be').cjk >= MIN_CJK
  if (le === be) return null
  return le ? 'utf-16le' : 'utf-16be'
}

function byteEncodingExplains(bytes: Uint8Array): boolean {
  return (
    decodesStrictly('utf-8', bytes) ||
    CJK_BYTE_ENCODINGS.some(
      (label) => decodesStrictly(label, bytes) && scoreLegacy(label, bytes) > 0
    ) ||
    looksWestern(bytes)
  )
}

/** windows-1252 打分为正，且 ASCII 文本字符占字节的大多数 */
function looksWestern(bytes: Uint8Array): boolean {
  if (scoreLegacy('windows-1252', bytes) <= 0) return false
  let text = 0
  for (const b of bytes) if (WESTERN_TEXT_BYTES.has(b)) text++
  return text >= bytes.length * MIN_WESTERN_TEXT
}

/** 按某一字节序读出的单元中：可显示文字的比例、CJK / 假名（含 CJK 标点）占非换行单元的比例；有孤立代理时都为 0 */
function measure(bytes: Uint8Array, label: Utf16Label): { plausible: number; cjk: number } {
  const le = label === 'utf-16le'
  const unitAt = (i: number): number => {
    const [a, b] = [bytes[i] ?? 0, bytes[i + 1] ?? 0]
    return le ? a | (b << 8) : (a << 8) | b
  }
  let plausible = 0
  let cjk = 0
  let count = 0
  let newlines = 0
  for (let i = 0; i < bytes.length; i += 2) {
    const u = unitAt(i)
    if (u >= 0xd800 && u <= 0xdbff) {
      if (i + 2 >= bytes.length) break // 样本末尾截断的高位代理
      const next = unitAt(i + 2)
      if (next < 0xdc00 || next > 0xdfff) return { plausible: 0, cjk: 0 }
      i += 2 // 代理对（CJK 扩展 B、表情）算作一个字符
      count++
      plausible++
      cjk++
      continue
    }
    if (u >= 0xdc00 && u <= 0xdfff) return { plausible: 0, cjk: 0 }
    count++
    if (u === 0x0a || u === 0x0d) newlines++
    if (isCjk(u)) {
      plausible++
      cjk++
    } else if (isPlausible(u)) {
      plausible++
    }
  }
  if (count === 0) return { plausible: 0, cjk: 0 }
  return { plausible: plausible / count, cjk: count > newlines ? cjk / (count - newlines) : 0 }
}

/** 假名、CJK 统一汉字（含扩展 A）、CJK 标点、全角形式，以及中日文中常见的符号区 */
function isCjk(u: number): boolean {
  return (
    (u >= 0x3000 && u <= 0x30ff) || // CJK 标点、平假名、片假名
    (u >= 0x31f0 && u <= 0x31ff) ||
    (u >= 0x3200 && u <= 0x33ff) || // 带圈 / 带括号字符、CJK 兼容（㈱ ㎏）
    (u >= 0x3400 && u <= 0x4dbf) ||
    (u >= 0x4e00 && u <= 0x9fff) ||
    (u >= 0xff00 && u <= 0xffef) || // 全角 ASCII、半角片假名
    (u >= 0x2010 && u <= 0x203b) || // ‐ – — ‘ ’ “ ” … ※
    (u >= 0x2460 && u <= 0x24ff) || // ①
    (u >= 0x25a0 && u <= 0x25ff) // ■ □ ○ ●
  )
}

/** NUL 路径的「可显示文字」：ASCII 可见字符与空白、拉丁 / 希腊 / 西里尔字母、通用符号、CJK、韩文 */
function isPlausible(u: number): boolean {
  return (
    u === 0x09 ||
    u === 0x0a ||
    u === 0x0d ||
    (u >= 0x20 && u <= 0x7e) ||
    (u >= 0xa0 && u <= 0x24f) ||
    (u >= 0x370 && u <= 0x4ff) ||
    (u >= 0x2000 && u <= 0x2bff) ||
    (u >= 0xac00 && u <= 0xd7a3) ||
    isCjk(u)
  )
}
