import { FsEnumerator } from './fs-enumerator'
import type { Enumerator } from './types'
import { createWin32Enumerator } from './win32-enumerator'

/** Windows 上优先用 koffi；加载失败（非 Windows、原生模块缺失）时回退到 node:fs 并记一条日志 */
export function createEnumerator(log: (msg: string) => void): Enumerator {
  try {
    return createWin32Enumerator(log)
  } catch (e) {
    log(
      `[enumerator] native enumeration unavailable, falling back to node:fs (hidden = name starts with "."; directory access times are not protected): ${e instanceof Error ? e.message : String(e)}`
    )
    return new FsEnumerator()
  }
}
