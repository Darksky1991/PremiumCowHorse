// 系统级截屏：用 Playwright 启动已构建的应用，再截取屏幕上窗口区域的真实像素。
// 与 page.screenshot() 不同，能看到系统绘制的部分（窗口边框、系统按钮等）。仅支持 Windows。
//
// 用法（先 pnpm build）：
//   node scripts/os-screenshot.mjs <输出.png> [light|dark] [ja|zh-CN|en]
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const [out, theme = 'light', language] = process.argv.slice(2)
if (!out) {
  console.error('usage: node scripts/os-screenshot.mjs <output.png> [light|dark] [ja|zh-CN|en]')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userData = mkdtempSync(path.join(tmpdir(), 'pch-osshot-'))
const app = await electron.launch({
  args: [path.join(root, 'apps/desktop')],
  env: { ...process.env, PCH_USER_DATA_DIR: userData, ELECTRON_RENDERER_URL: '' }
})
try {
  const page = await app.firstWindow()
  await page.getByRole('heading', { level: 1 }).waitFor()
  const patch = { 'appearance.themeMode': theme, ...(language && { 'general.language': language }) }
  await page.evaluate((p) => window.pch.invoke('settings.set', p), patch)

  // 置顶并换算为物理像素坐标（Windows 显示缩放下 DIP 与屏幕像素不同）
  const rect = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setAlwaysOnTop(true)
    win.focus()
    return screen.dipToScreenRect(win, win.getBounds())
  })
  await page.waitForTimeout(800)

  const file = path.resolve(out).replace(/'/g, "''")
  const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[Dpi]::SetProcessDPIAware() | Out-Null
$bmp = New-Object System.Drawing.Bitmap ${rect.width}, ${rect.height}
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(${rect.x}, ${rect.y}, 0, 0, $bmp.Size)
$bmp.Save('${file}', [System.Drawing.Imaging.ImageFormat]::Png)
`
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps])
  console.log(`saved ${path.resolve(out)}`, rect)
} finally {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
