// 生成应用图标：build/logo.svg → apps/desktop/build/icon.ico + apps/desktop/resources/icon.png（256）+ 渲染端 public/favicon.svg
// 用法：pnpm icons（产物提交进仓库；logo 改动后重新运行）
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeIco, pngSize } from './icons/ico.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktop = join(root, 'apps/desktop')
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

// electron 包导出可执行文件路径（从 apps/desktop 解析，因为依赖声明在那里）
const electronExe = createRequire(join(desktop, 'package.json'))('electron')
const tmp = mkdtempSync(join(tmpdir(), 'pch-icons-'))
try {
  // 只要设置了 ELECTRON_RUN_AS_NODE（即使为空串）electron 就按 node 运行，必须删除
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const r = spawnSync(
    electronExe,
    [join(root, 'scripts/icons/render.cjs'), join(desktop, 'build/logo.svg'), tmp, SIZES.join(',')],
    { stdio: 'inherit', env }
  )
  if (r.status !== 0) throw new Error(`render.cjs 失败，退出码 ${r.status}`)
  const pngs = SIZES.map((size) => ({ size, data: readFileSync(join(tmp, `${size}.png`)) }))
  // ICO 目录项写的是 size×size，内嵌 PNG 必须与之完全一致
  for (const { size, data } of pngs) {
    const { width, height } = pngSize(data)
    if (width !== size || height !== size) {
      throw new Error(`${size}.png 的实际尺寸为 ${width}x${height}，应为 ${size}x${size}`)
    }
  }
  // 留存各尺寸 PNG 供目视检查（可选）
  if (process.env.PCH_ICON_SIZES_DIR) {
    mkdirSync(process.env.PCH_ICON_SIZES_DIR, { recursive: true })
    for (const { size, data } of pngs) {
      writeFileSync(join(process.env.PCH_ICON_SIZES_DIR, `${size}.png`), data)
    }
  }
  mkdirSync(join(desktop, 'build'), { recursive: true })
  mkdirSync(join(desktop, 'resources'), { recursive: true })
  writeFileSync(join(desktop, 'build/icon.ico'), encodeIco(pngs))
  writeFileSync(join(desktop, 'resources/icon.png'), pngs[pngs.length - 1].data)
  // 渲染端 favicon 与 logo 同源
  copyFileSync(join(desktop, 'build/logo.svg'), join(desktop, 'src/renderer/public/favicon.svg'))
  console.log('已生成 build/icon.ico、resources/icon.png 与 favicon.svg')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
