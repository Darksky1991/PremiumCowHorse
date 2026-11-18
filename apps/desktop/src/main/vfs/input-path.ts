import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppError, normalizeRootUri } from '@pch/shared'

/**
 * 把用户输入的本地路径转为 file URI。
 * 去掉首尾空白与一对首尾双引号（资源管理器「复制为路径」带引号）；
 * 结果经 normalizeRootUri 规范化（不带结尾 `/`，驱动器根除外）。
 * 只接受 Windows 绝对路径，盘符相对路径（`C:foo`）与无法转换的输入（如单独的 `\\server`）
 * 一律以 FS_INVALID_URI 拒绝。
 */
export function toFileUri(inputPath: string): string {
  let p = inputPath.trim()
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1).trim()
  if (!path.win32.isAbsolute(p) || /^[a-zA-Z]:(?![\\/])/.test(p)) {
    throw new AppError({ code: 'FS_INVALID_URI', detail: inputPath })
  }
  try {
    return normalizeRootUri(pathToFileURL(p, { windows: true }).href)
  } catch {
    throw new AppError({ code: 'FS_INVALID_URI', detail: inputPath })
  }
}
