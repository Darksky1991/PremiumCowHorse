// 严格解码校验：用该编码 fatal 解码不出错（容忍样本末尾被截断的半个字符）
import type { EncodingLabel } from './types'

export function decodesStrictly(label: EncodingLabel, bytes: Uint8Array): boolean {
  try {
    // stream: true —— 末尾不完整的多字节序列留在解码器里等待后续数据，不算错误
    new TextDecoder(label, { fatal: true, ignoreBOM: true }).decode(bytes, { stream: true })
    return true
  } catch {
    return false
  }
}

export function hasHighByte(bytes: Uint8Array): boolean {
  return bytes.some((b) => b >= 0x80)
}
