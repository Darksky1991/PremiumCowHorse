import path from 'node:path'
import { app } from 'electron'

export interface AppPaths {
  userData: string
  database: string
  logs: string
  cache: string
  /** 渲染端构建产物（生产模式下由 app:// 协议提供，位于 asar 内） */
  renderer: string
  preload: string
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
    logs: path.join(userData, 'logs'),
    cache: path.join(userData, 'cache'),
    renderer: path.join(outMain, '../renderer'),
    preload: path.join(outMain, '../preload/index.js')
  }
}
