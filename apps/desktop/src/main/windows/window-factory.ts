import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, nativeTheme } from 'electron'
import {
  encodeBootstrapArg,
  IPC_EVENT,
  type BootstrapData,
  type EventEnvelope,
  type Language,
  type Settings,
  type ThemeName
} from '@pch/shared'

/**
 * 与各主题的 --background 一致（oklch 换算为 sRGB 十六进制）：窗口出现前的底色，防止白屏闪烁。
 * 新增主题时同步 packages/ui/src/styles/globals.css
 */
const BACKGROUND: Record<ThemeName, { light: string; dark: string }> = {
  default: { light: '#ffffff', dark: '#0a0a0a' },
  aitetsu: { light: '#f8fafd', dark: '#0a111a' },
  washi: { light: '#f9f6f1', dark: '#1a1713' },
  matsuba: { light: '#f6f9f7', dark: '#0d1613' }
}

export interface CreateWindowOptions {
  url: string
  preload: string
  /** 窗口 / 任务栏图标（paths.appIcon） */
  icon: string
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
    themeName: opts.settings['appearance.theme'],
    accent: opts.settings['appearance.accent'],
    density: opts.settings['appearance.density'],
    // 测试用的崩溃插件：打包后的应用绝不启用（与 PCH_USER_DATA_DIR 相同，只在未打包时读取环境变量）
    ...(!app.isPackaged && process.env.PCH_E2E_CRASH_PLUGIN === '1' ? { e2eCrashPlugin: true } : {})
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
    icon: opts.icon,
    backgroundColor: BACKGROUND[opts.settings['appearance.theme']][theme],
    // 隐藏系统标题栏：Windows / Linux 不显示原生窗口按钮（由渲染端自绘），保留可调整大小的边框；
    // macOS 保留系统惯例的红绿灯
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 11 } } : {}),
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

  // 最大化状态变化只通知本窗口（自绘按钮切换「最大化 / 还原」图标）
  const sendState = (): void => {
    const envelope: EventEnvelope = {
      event: 'window.stateChanged',
      payload: { maximized: win.isMaximized() }
    }
    win.webContents.send(IPC_EVENT, envelope)
  }
  win.on('maximize', sendState)
  win.on('unmaximize', sendState)

  void win.loadURL(opts.url)
  return win
}

/** 主题变化时同步窗口底色（窗口尺寸变化时露出的区域） */
export function syncWindowChrome(win: BrowserWindow, themeName: ThemeName): void {
  win.setBackgroundColor(BACKGROUND[themeName][currentTheme()])
}
