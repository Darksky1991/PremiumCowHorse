import { app, BrowserWindow, clipboard, dialog, shell, webContents } from 'electron'
import { AppError } from '@pch/shared'
import type { AppPaths } from '../../infra/paths'
import type { Logger } from '../../infra/logger'
import type { HandlersOf } from '../../ipc/router'
import { fileUriToLocalPath } from '../../vfs/local-path'
import type { VfsService } from '../../vfs/vfs.service'

/** 注入的系统操作（测试时替换；默认为 electron 的 shell.openPath，返回错误文字，空串为成功） */
export interface SystemShell {
  openPath: (path: string) => Promise<string>
}

export function systemHandlers(
  logger: Logger,
  vfs: VfsService,
  paths: Pick<AppPaths, 'userData' | 'logs'>,
  systemShell: SystemShell = shell
): HandlersOf<
  | 'app.getInfo'
  | 'log.write'
  | 'system.revealInOs'
  | 'system.openPath'
  | 'system.openAppFolder'
  | 'system.copyText'
  | 'system.selectPaths'
> {
  return {
    'app.getInfo': async () => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      userDataDir: paths.userData,
      logsDir: paths.logs
    }),
    'log.write': async ({ level, message, stack }) => {
      logger[level](`[renderer] ${message}${stack ? `\n${stack}` : ''}`)
    },
    'system.revealInOs': async ({ uri }) => {
      shell.showItemInFolder(fileUriToLocalPath(uri))
    },
    'system.openPath': async ({ uri }) => {
      const localPath = fileUriToLocalPath(uri)
      // 先经 VfsService 确认存在（带超时、错误码映射）：shell.openPath 失败时只返回描述文字
      await vfs.stat(uri)
      const error = await shell.openPath(localPath)
      if (error) throw new AppError({ code: 'UNKNOWN', detail: `shell.openPath: ${error}` })
    },
    'system.openAppFolder': async ({ which }) => {
      const error = await systemShell.openPath(which === 'logs' ? paths.logs : paths.userData)
      if (error) throw new AppError({ code: 'UNKNOWN', detail: `shell.openPath: ${error}` })
    },
    'system.copyText': async ({ text }) => {
      clipboard.writeText(text)
    },
    'system.selectPaths': async ({ kind, multiple }, { senderId }) => {
      const properties: Array<'openDirectory' | 'openFile' | 'multiSelections'> = [
        kind === 'folder' ? 'openDirectory' : 'openFile'
      ]
      if (multiple) properties.push('multiSelections')
      // 对话框父窗口取调用方所在窗口；拿不到时退化为无父窗口的对话框
      const sender = webContents.fromId(senderId)
      const parent = sender ? BrowserWindow.fromWebContents(sender) : null
      const result = parent
        ? await dialog.showOpenDialog(parent, { properties })
        : await dialog.showOpenDialog({ properties })
      return result.canceled ? [] : result.filePaths
    }
  }
}
