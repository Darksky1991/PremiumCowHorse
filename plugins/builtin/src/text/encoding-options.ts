import type { DocEncoding } from '@pch/plugin-sdk'

/** 编码下拉的选项（「自动」之后的 9 个）与显示名（不随界面语言变化） */
export const ENCODING_OPTIONS: ReadonlyArray<{ label: DocEncoding; name: string }> = [
  { label: 'utf-8', name: 'UTF-8' },
  { label: 'utf-16le', name: 'UTF-16 LE' },
  { label: 'utf-16be', name: 'UTF-16 BE' },
  { label: 'shift_jis', name: 'Shift_JIS' },
  { label: 'euc-jp', name: 'EUC-JP' },
  { label: 'iso-2022-jp', name: 'ISO-2022-JP' },
  { label: 'gb18030', name: 'GB18030 (GBK)' },
  { label: 'big5', name: 'Big5' },
  { label: 'windows-1252', name: 'Windows-1252' }
]

export function encodingName(label: DocEncoding): string {
  return ENCODING_OPTIONS.find((o) => o.label === label)?.name ?? label
}

/** 下拉中「自动」的值 */
export const AUTO = 'auto'
