import { fileURLToPath } from 'node:url'
import { AppError } from '@pch/shared'

/**
 * file URI → Windows 本地路径（toFileUri 的反方向）。
 * 非 file: 协议 → FS_UNSUPPORTED_SCHEME；无法解析或转换 → FS_INVALID_URI。
 * 带主机名的 URI 转为 UNC 路径。
 */
export function fileUriToLocalPath(uri: string): string {
  if (!URL.canParse(uri)) throw new AppError({ code: 'FS_INVALID_URI', detail: uri })
  const url = new URL(uri)
  if (url.protocol !== 'file:') {
    throw new AppError({ code: 'FS_UNSUPPORTED_SCHEME', detail: url.protocol })
  }
  try {
    return fileURLToPath(url, { windows: true })
  } catch {
    throw new AppError({ code: 'FS_INVALID_URI', detail: uri })
  }
}
