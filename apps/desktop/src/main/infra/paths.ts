import path from 'node:path'
import { app } from 'electron'

export interface AppPaths {
  userData: string
  database: string
  /** 扫描进程的目录缓存库（可随时删除重建） */
  indexDb: string
  logs: string
  /** 渲染端构建产物（生产模式下由 app:// 协议提供，位于 asar 内） */
  renderer: string
  /** Markdown 查看脚本的构建产物（vite.markdown.config.ts；pch-asset 协议的根，位于 asar 内） */
  webAssets: string
  preload: string
  /** 窗口 / 任务栏图标（apps/desktop/resources/icon.png，由 pnpm icons 生成；打包后随 asar 解包） */
  appIcon: string
}

/**
 * 必须在 app ready 之前调用：开发环境使用独立的 userData，避免污染正式数据。
 */
export function configureUserData(): void {
  if (app.isPackaged) return
  // E2E 测试指定一次性目录，互不干扰
  const override = process.env.PCH_USER_DATA_DIR
  app.setPath('userData', override ? path.resolve(override) : `${app.getPath('userData')}-dev`)
}

export function createPaths(): AppPaths {
  const userData = app.getPath('userData')
  // out/main/index.js 所在目录
  const outMain = __dirname
  return {
    userData,
    database: path.join(userData, 'data', 'pch.db'),
    indexDb: path.join(userData, 'cache', 'index.db'),
    logs: path.join(userData, 'logs'),
    renderer: path.join(outMain, '../renderer'),
    webAssets: path.join(outMain, '../web-assets/markdown'),
    preload: path.join(outMain, '../preload/index.js'),
    // 开发：out/main → apps/desktop/resources；打包：resources/** 在 asarUnpack 中，位于 app.asar.unpacked
    // （BrowserWindow 的 icon 由原生代码读取，不能经过 asar 内的虚拟路径）
    appIcon: app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'icon.png')
      : path.join(outMain, '../../resources/icon.png')
  }
}
