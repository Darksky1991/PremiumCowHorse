// 「凭据是否被编辑过」的比较（C1 / R24）：失败的认证尝试结束时，若记录的凭据相关字段已与拨号时不同，
// 失败的是旧的凭据，不写锁定（不覆盖编辑的结果）；只改名称 / 身份列表 / sftp-server 路径不算。
// 机密按密文比较：编辑时提交了密码即写入新的密文（safeStorage 每次加密的结果不同）。
import type { ConnectionRecord } from './connection.repo'

type LoginFields = Pick<
  ConnectionRecord,
  'host' | 'port' | 'username' | 'auth' | 'keyPath' | 'secret'
>

/** 登录认证用到的字段相同 */
export function sameLoginCredentials(a: LoginFields, b: LoginFields): boolean {
  return (
    a.host === b.host &&
    a.port === b.port &&
    a.username === b.username &&
    a.auth === b.auth &&
    a.keyPath === b.keyPath &&
    a.secret === b.secret
  )
}

type SudoFields = Pick<
  ConnectionRecord,
  'host' | 'port' | 'username' | 'auth' | 'secret' | 'sudoSecret'
>

/** 实际用作 sudo 密码的密文：另设的 sudo 密码，否则密码登录的登录密码（与 identityParams 相同） */
const sudoSecretOf = (r: SudoFields): string | null =>
  r.sudoSecret ?? (r.auth === 'password' ? r.secret : null)

/** sudo 认证用到的机密相同，且仍是同一台主机、同一个登录用户（K3：换了主机，旧的 sudo 失败不再适用） */
export function sameSudoCredentials(a: SudoFields, b: SudoFields): boolean {
  return (
    a.host === b.host &&
    a.port === b.port &&
    a.username === b.username &&
    sudoSecretOf(a) === sudoSecretOf(b)
  )
}
