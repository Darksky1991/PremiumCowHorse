// 测试辅助：读取 fixtures/manifest.json 与样本（只在测试里使用，不从 index.ts 导出；这里允许使用 Node 的 fs）
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EncodingLabel } from './types'

export interface FixtureEntry {
  file: string
  /** 真实编码 */
  label: EncodingLabel
  /** 解码结果与原文完全一致的所有标签 */
  acceptable: EncodingLabel[]
  lang: 'ja' | 'zh-CN' | 'zh-TW' | 'en' | 'mixed'
  shape: string
  /** 人也无法从字节判断：只要求 confidence 为 'guess'，不要求命中 */
  ambiguous?: boolean
}

export interface Fixture {
  entry: FixtureEntry
  /** 样本的原始字节 */
  bytes: Uint8Array
  /** 原文（来自 fixtures/expected，UTF-8） */
  text: string
}

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

export function loadFixtures(): Fixture[] {
  const manifest = JSON.parse(
    readFileSync(join(FIXTURES_DIR, 'manifest.json'), 'utf8')
  ) as FixtureEntry[]
  return manifest.map((entry) => ({
    entry,
    bytes: new Uint8Array(readFileSync(join(FIXTURES_DIR, 'samples', entry.file))),
    text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(
      readFileSync(join(FIXTURES_DIR, 'expected', entry.file))
    )
  }))
}
