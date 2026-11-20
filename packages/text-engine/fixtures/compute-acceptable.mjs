// 由 gen.py 调用：对 manifest 中每个样本，用 Node 的 TextDecoder 按 9 个标签逐一解码，
// 与 expected/ 中的原文（UTF-8）完全一致的标签写入 acceptable（按 ENCODING_LABELS 的顺序）。
// 不经手填，也不参考任何编码判断实现。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LABELS = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'shift_jis',
  'euc-jp',
  'iso-2022-jp',
  'gb18030',
  'big5',
  'windows-1252'
]
const dir = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(dir, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

if (process.argv.includes('--validity')) {
  // 辅助自检：每个样本能被哪些标签「合法解码」（fatal 模式不报错），用于核对 ambiguous 标注
  const valid = {}
  for (const entry of manifest) {
    const bytes = readFileSync(join(dir, 'samples', entry.file))
    valid[entry.file] = LABELS.filter((label) => {
      try {
        new TextDecoder(label, { fatal: true }).decode(bytes)
        return true
      } catch {
        return false
      }
    })
  }
  process.stdout.write(JSON.stringify(valid))
  process.exit(0)
}

for (const entry of manifest) {
  const bytes = readFileSync(join(dir, 'samples', entry.file))
  const expected = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
    readFileSync(join(dir, 'expected', entry.file))
  )
  entry.acceptable = LABELS.filter((label) => {
    try {
      return new TextDecoder(label).decode(bytes) === expected
    } catch {
      return false
    }
  })
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
