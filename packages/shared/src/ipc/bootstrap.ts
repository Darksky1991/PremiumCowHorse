import type { Language } from '../settings/schema'

/**
 * 主进程通过 additionalArguments 传给 preload 的首屏数据，
 * 渲染端首帧同步读取，避免主题闪烁与语言跳变。
 */
export interface BootstrapData {
  windowId: string
  platform: NodeJS.Platform
  language: Language
  theme: 'light' | 'dark'
  accent: string
  density: 'comfortable' | 'compact'
}

export const BOOTSTRAP_ARG_PREFIX = '--pch-bootstrap='

/**
 * 使用 encodeURIComponent 而不是 base64：preload 运行在 sandbox 中，
 * 不能依赖 Buffer 等 Node API。编码结果不含空格与引号，作为命令行参数是安全的。
 */
export function encodeBootstrapArg(data: BootstrapData): string {
  return BOOTSTRAP_ARG_PREFIX + encodeURIComponent(JSON.stringify(data))
}

export function decodeBootstrapArg(argv: readonly string[]): BootstrapData | null {
  const arg = argv.find((a) => a.startsWith(BOOTSTRAP_ARG_PREFIX))
  if (!arg) return null
  try {
    return JSON.parse(decodeURIComponent(arg.slice(BOOTSTRAP_ARG_PREFIX.length)))
  } catch {
    return null
  }
}
