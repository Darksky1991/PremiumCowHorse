import { randomUUID } from 'node:crypto'
import { BrowserWindow, nativeTheme } from 'electron'
import { encodeBootstrapArg, type BootstrapData, type Language, type Settings } from '@pch/shared'

/** 与渲染端标题栏背景（--sidebar）一致，避免原生窗口按钮区域色差 */
const TITLE_BAR = {
  height: 36,
  light: { color: '#fafafa', symbolColor: '#0a0a0a' },
  dark: { color: '#171717', symbolColor: '#fafafa' }
}
/** 与 --background 一致：窗口出现前的底色，防止白屏闪烁 */
const BACKGROUND = { light: '#ffffff', dark: '#0a0a0a' }

export interface CreateWindowOptions {
  url: string
  preload: string
  title: string
  language: Language
  settings: Settings
  bounds?: { width: number; height: number; x?: number; y?: number }
}

export const currentTheme = (): 'light' | 'dark' =>
  nativeTheme.shouldUseDarkColors ? 'dark' : 'light'

/** 统一的 BrowserWindow 创建入口：安全选项集中在此，任何窗口都不得绕过 */
export function createAppWindow(opts: CreateWindowOptions): BrowserWindow {
  const theme = currentTheme()
  const bootstrap: BootstrapData = {
    windowId: randomUUID(),
    platform: process.platform,
    language: opts.language,
    theme,
    accent: opts.settings['appearance.accent'],
    density: opts.settings['appearance.density']
  }

  const win = new BrowserWindow({
    title: opts.title,
    width: opts.bounds?.width ?? 1280,
    height: opts.bounds?.height ?? 800,
    x: opts.bounds?.x,
    y: opts.bounds?.y,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: BACKGROUND[theme],
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 12, y: 11 } }
      : { titleBarOverlay: { ...TITLE_BAR[theme], height: TITLE_BAR.height } }),
    webPreferences: {
      preload: opts.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      additionalArguments: [encodeBootstrapArg(bootstrap)]
    }
  })

  win.once('ready-to-show', () => win.show())

  void win.loadURL(opts.url)
  return win
}

/** 主题变化时同步原生标题栏按钮颜色与窗口底色 */
export function syncWindowChrome(win: BrowserWindow): void {
  const theme = currentTheme()
  win.setBackgroundColor(BACKGROUND[theme])
  if (process.platform !== 'darwin') {
    win.setTitleBarOverlay({ ...TITLE_BAR[theme], height: TITLE_BAR.height })
  }
}
