// 由 electron 运行（见 scripts/build-icons.mjs）：把 SVG 渲染成各尺寸的 PNG。
// 用法：electron render.cjs <svg 路径> <输出目录> <尺寸,尺寸,...>
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const [svgPath, outDir, sizesArg] = process.argv.slice(-3)
const sizes = sizesArg.split(',').map(Number)

// 离屏渲染不需要 GPU；也避免在受限的企业终端上初始化失败
app.disableHardwareAcceleration()

// 关闭最后一个窗口时 electron 默认会退出；这里由脚本自己在全部完成后 app.exit
app.on('window-all-closed', () => {})

async function renderOne(svgUrl, size) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true }
  })
  // 经临时 HTML 文件加载：data URL 嵌套编码后过长，加载会失败
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden"><img src="${svgUrl}" width="${size}" height="${size}" style="display:block"></body></html>`
  const htmlPath = path.join(outDir, `page-${size}.html`)
  fs.writeFileSync(htmlPath, html)
  await win.loadFile(htmlPath)
  // 等图片解码完成
  await win.webContents.executeJavaScript(
    "new Promise(r => { const i = document.images[0]; i.complete ? r() : i.addEventListener('load', r) })"
  )
  await new Promise((r) => setTimeout(r, 150))
  const image = await win.webContents.capturePage()
  // Windows 的离屏窗口有最小高度，capturePage 可能比 size 高（内容在左上）：裁剪而不是拉伸；
  // 比 size 小则无法正确处理，直接报错
  const got = image.getSize()
  if (got.width < size || got.height < size) {
    throw new Error(`capturePage 尺寸 ${got.width}x${got.height} 小于 ${size}`)
  }
  const out =
    got.width === size && got.height === size
      ? image
      : image.crop({ x: 0, y: 0, width: size, height: size })
  fs.writeFileSync(path.join(outDir, `${size}.png`), out.toPNG())
  win.destroy()
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(outDir, { recursive: true })
    const url = require('node:url').pathToFileURL(path.resolve(svgPath)).href
    for (const s of sizes) await renderOne(url, s)
    app.exit(0)
  } catch (e) {
    console.error(e)
    app.exit(1)
  }
})
