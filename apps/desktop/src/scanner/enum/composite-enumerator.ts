import { isSftpUri } from '@pch/shared'
import type { Enumerator } from './types'

/**
 * 按 scheme 分派的枚举器：sftp: → remote（经主进程读取），其余 → local（koffi / node:fs）。
 * native 取 local 的值（只描述本地枚举方式）。
 */
export function createCompositeEnumerator(local: Enumerator, remote: Enumerator): Enumerator {
  const pick = (uri: string): Enumerator => (isSftpUri(uri) ? remote : local)
  return {
    native: local.native,
    statDir: (uri, signal, opts) => pick(uri).statDir(uri, signal, opts),
    list: (uri, opts) => pick(uri).list(uri, opts),
    location: (uri) => pick(uri).location(uri),
    shareKey: (uri) => pick(uri).shareKey(uri),
    hostKey: (uri) => pick(uri).hostKey(uri)
  }
}
