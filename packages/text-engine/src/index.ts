// @pch/text-engine：文本预览的纯逻辑（Node / 浏览器通用，无 I/O）。设计见 devDoc/2026-11-20-18-text-preview-design.md
export { ENCODING_LABELS } from './types'
export type { EncodingLabel, LineBlock, NewlineUnit, ReadAt } from './types'
export { unitOf } from './newline'
export { LineIndex } from './line-index'
export type { LineIndexOptions } from './line-index'
export { readLines } from './line-reader'
export type { ReadLimits } from './line-reader'
