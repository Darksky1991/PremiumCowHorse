// 编码判断（设计 3.4 / 第 4 节）：BOM → 无 BOM UTF-16 → 严格 UTF-8 → ISO-2022-JP → 旧编码常用字区打分。
// 样本取文件开头 / 中间 / 末尾各 64KB（sampleRanges）——只看开头会把「前面全是英文、后面才有日文」的日志误判为 UTF-8。
import { detectBom } from './bom'
import { LEGACY_LABELS, scoreLegacy, type LegacyLabel } from './legacy-score'
import { decodesStrictly, hasHighByte } from './strict-decode'
import type { EncodingLabel } from './types'
import { guessUtf16 } from './utf16-guess'

export const SAMPLE_BYTES = 64 * 1024

/** 打分最高者低于这个分数（约 8 个常用字的证据）→ guess */
const MIN_EVIDENCE = 8
/** 前两名差距小于这个分数 → guess */
const MIN_MARGIN = 4

export interface EncodingGuess {
  label: EncodingLabel
  confidence: 'certain' | 'likely' | 'guess'
  /** 开头 BOM 的字节数（解码时跳过） */
  bomLength: number
}

export interface EncodingPrefs {
  /** 界面语言：打分平局时决定先后（ja → 日文编码在前；zh-CN → GB18030 在前；en → windows-1252 在前） */
  preferred?: 'ja' | 'zh-CN' | 'en'
}

/** 取样范围：文件不大于 3 个样本时整份一个样本，否则开头 / 中间 / 末尾各 SAMPLE_BYTES */
export function sampleRanges(
  size: number,
  sampleBytes = SAMPLE_BYTES
): { offset: number; length: number }[] {
  if (size <= 0) return []
  if (size <= 3 * sampleBytes) return [{ offset: 0, length: size }]
  return [
    { offset: 0, length: sampleBytes },
    { offset: Math.floor((size - sampleBytes) / 2), length: sampleBytes },
    { offset: size - sampleBytes, length: sampleBytes }
  ]
}

/**
 * 判断编码。samples[0] 必须从文件开头开始（BOM 与 UTF-16 只看它）；其余样本可从任意位置开始，
 * 这里先跳到其中第一个 LF 之后（旧编码与 UTF-8 的多字节字符中不会出现 0x0A），样本末尾可在字符中间截断。
 */
export function detectEncoding(samples: Uint8Array[], prefs: EncodingPrefs = {}): EncodingGuess {
  const head = samples[0] ?? new Uint8Array(0)
  const bom = detectBom(head)
  if (bom) return { label: bom.label, confidence: 'certain', bomLength: bom.length }
  const utf16 = guessUtf16(head)
  if (utf16) return { label: utf16, confidence: 'likely', bomLength: 0 }

  const parts = [head, ...samples.slice(1).map(fromNextLine)].filter((p) => p.length > 0)
  if (!parts.some(hasHighByte)) {
    // 全部是 7 位字节：ISO-2022-JP（有转义序列）或 ASCII（归 UTF-8）
    const jis = parts.some(hasIso2022JpEscape) && allDecode('iso-2022-jp', parts)
    return { label: jis ? 'iso-2022-jp' : 'utf-8', confidence: 'likely', bomLength: 0 }
  }
  if (allDecode('utf-8', parts)) return { label: 'utf-8', confidence: 'likely', bomLength: 0 }
  return scoreCandidates(parts, prefs.preferred)
}

function scoreCandidates(
  parts: Uint8Array[],
  preferred: EncodingPrefs['preferred']
): EncodingGuess {
  const order = preferenceOrder(preferred)
  const ranked = LEGACY_LABELS.filter((label) => allDecode(label, parts))
    .map((label) => ({
      label,
      score: parts.reduce((sum, p) => sum + scoreLegacy(label, p), 0)
    }))
    .sort((a, b) => b.score - a.score || order.indexOf(a.label) - order.indexOf(b.label))
  const [best, second] = ranked
  // 都无把握：按 UTF-8 宽松解码（U+FFFD），界面提示「编码可能不正确」
  if (!best || best.score <= 0) return { label: 'utf-8', confidence: 'guess', bomLength: 0 }
  const close = second !== undefined && best.score - second.score < MIN_MARGIN
  return {
    label: best.label,
    confidence: best.score < MIN_EVIDENCE || close ? 'guess' : 'likely',
    bomLength: 0
  }
}

function preferenceOrder(preferred: EncodingPrefs['preferred']): LegacyLabel[] {
  const ja: LegacyLabel[] = ['shift_jis', 'euc-jp']
  const zh: LegacyLabel[] = ['gb18030', 'big5']
  if (preferred === 'zh-CN') return [...zh, ...ja, 'windows-1252']
  if (preferred === 'en') return ['windows-1252', ...ja, ...zh]
  return [...ja, ...zh, 'windows-1252']
}

const allDecode = (label: EncodingLabel, parts: Uint8Array[]): boolean =>
  parts.every((p) => decodesStrictly(label, p))

/** 从第一个 LF 之后开始；没有 LF 时整段丢弃（无法确定字符边界） */
function fromNextLine(sample: Uint8Array): Uint8Array {
  const lf = sample.indexOf(0x0a)
  return lf < 0 ? sample.subarray(sample.length) : sample.subarray(lf + 1)
}

/** ESC $ @ / ESC $ B（JIS X 0208）、ESC ( J（JIS X 0201 罗马字）、ESC ( I（半角片假名） */
function hasIso2022JpEscape(bytes: Uint8Array): boolean {
  for (
    let i = bytes.indexOf(0x1b);
    i >= 0 && i + 2 < bytes.length;
    i = bytes.indexOf(0x1b, i + 1)
  ) {
    const [a, b] = [bytes[i + 1], bytes[i + 2]]
    if ((a === 0x24 && (b === 0x40 || b === 0x42)) || (a === 0x28 && (b === 0x4a || b === 0x49))) {
      return true
    }
  }
  return false
}
