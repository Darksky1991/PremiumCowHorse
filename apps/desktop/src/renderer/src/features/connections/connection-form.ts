import {
  IDENTITY_PATTERN,
  SFTP_SERVER_PATH_PATTERN,
  type ConnectionDto,
  type ConnectionSaveInput
} from '@pch/shared'

/** 编辑对话框的输入（全部为字符串 / 选项；提交时经 buildSaveInput 转为 ConnectionSaveInput） */
export interface ConnectionForm {
  name: string
  host: string
  port: string
  username: string
  auth: 'password' | 'key'
  keyPath: string
  /** 密码（auth = password）或私钥口令（auth = key）；编辑时初始为空 */
  secret: string
  /** 私钥认证且已保存口令时：勾选 = 删除已保存的口令（口令输入留空时生效） */
  clearSecret: boolean
  identities: string[]
  sudoMode: 'login' | 'separate'
  sudoSecret: string
  sftpMode: 'auto' | 'custom'
  sftpServerPath: string
}

export type ConnectionFormErrorKey =
  | 'nameRequired'
  | 'hostRequired'
  | 'portInvalid'
  | 'usernameRequired'
  | 'usernameInvalid'
  | 'passwordRequired'
  | 'keyPathRequired'
  | 'sudoPasswordRequired'
  | 'sftpServerPathInvalid'

export type ConnectionFormErrors = Partial<Record<keyof ConnectionForm, ConnectionFormErrorKey>>

export type IdentityErrorKey = 'identityInvalid' | 'identityDuplicate' | 'identityTooMany'

/** 与 ConnectionSaveInput 一致：最多 20 个切换身份 */
export const MAX_IDENTITIES = 20
export const DEFAULT_PORT = 22

export function initialForm(c?: ConnectionDto): ConnectionForm {
  return {
    name: c?.name ?? '',
    host: c?.host ?? '',
    port: String(c?.port ?? DEFAULT_PORT),
    username: c?.username ?? '',
    auth: c?.auth ?? 'password',
    keyPath: c?.keyPath ?? '',
    secret: '',
    clearSecret: false,
    identities: c?.identities ?? [],
    sudoMode: c?.hasSudoSecret ? 'separate' : 'login',
    sudoSecret: '',
    sftpMode: c?.sftpServerPath ? 'custom' : 'auto',
    sftpServerPath: c?.sftpServerPath ?? ''
  }
}

/**
 * 留空的密码 / 口令是否表示「不变」：编辑已保存了机密的连接、且认证方式没变时。
 * 认证方式变了时旧机密的含义不同（密码 ↔ 口令），不能沿用
 */
export function secretKept(form: Pick<ConnectionForm, 'auth'>, original?: ConnectionDto): boolean {
  return original !== undefined && original.hasSecret && original.auth === form.auth
}

/** 留空的 sudo 密码是否表示「不变」 */
export function sudoSecretKept(original?: ConnectionDto): boolean {
  return original?.hasSudoSecret === true
}

/** 要添加的切换身份的即时校验；空白不算错误 */
export function identityError(
  draft: string,
  identities: readonly string[]
): IdentityErrorKey | null {
  const name = draft.trim()
  if (name === '') return null
  if (!IDENTITY_PATTERN.test(name)) return 'identityInvalid'
  if (identities.includes(name)) return 'identityDuplicate'
  if (identities.length >= MAX_IDENTITIES) return 'identityTooMany'
  return null
}

function parsePort(text: string): number | null {
  if (!/^\d{1,5}$/.test(text.trim())) return null
  const n = Number(text.trim())
  return n >= 1 && n <= 65535 ? n : null
}

/**
 * 表单 → 保存输入。机密：留空且 secretKept → 省略 secret（不变）；私钥口令留空 → 清除；
 * 新的密码认证必须输入密码。sudo：「同登录密码」→ null；「另外设置」留空且已有 → 省略
 */
export function buildSaveInput(
  form: ConnectionForm,
  original?: ConnectionDto
): { ok: true; input: ConnectionSaveInput } | { ok: false; errors: ConnectionFormErrors } {
  const errors: ConnectionFormErrors = {}
  const name = form.name.trim()
  const host = form.host.trim()
  const username = form.username.trim()
  const port = parsePort(form.port)
  if (name === '') errors.name = 'nameRequired'
  if (host === '') errors.host = 'hostRequired'
  if (port === null) errors.port = 'portInvalid'
  if (username === '') errors.username = 'usernameRequired'
  else if (!IDENTITY_PATTERN.test(username)) errors.username = 'usernameInvalid'

  let secret: string | undefined
  if (form.secret !== '') secret = form.secret
  else if (secretKept(form, original)) {
    // 只有私钥认证的口令可以清除：主进程把空串视为「清除」（K5）
    secret = form.auth === 'key' && form.clearSecret ? '' : undefined
  } else if (form.auth === 'password') errors.secret = 'passwordRequired'
  else secret = original === undefined ? undefined : ''

  const keyPath = form.keyPath.trim()
  if (form.auth === 'key' && keyPath === '') errors.keyPath = 'keyPathRequired'

  let sudoSecret: string | null | undefined
  if (form.sudoMode === 'login') sudoSecret = null
  else if (form.sudoSecret !== '') sudoSecret = form.sudoSecret
  else if (sudoSecretKept(original)) sudoSecret = undefined
  else errors.sudoSecret = 'sudoPasswordRequired'

  const sftpServerPath = form.sftpMode === 'custom' ? form.sftpServerPath.trim() : null
  if (sftpServerPath !== null && !SFTP_SERVER_PATH_PATTERN.test(sftpServerPath)) {
    errors.sftpServerPath = 'sftpServerPathInvalid'
  }

  if (Object.keys(errors).length > 0 || port === null) return { ok: false, errors }
  const input: ConnectionSaveInput = {
    ...(original ? { id: original.id } : {}),
    name,
    host,
    port,
    username,
    auth: form.auth,
    keyPath: form.auth === 'key' ? keyPath : null,
    ...(secret === undefined ? {} : { secret }),
    ...(sudoSecret === undefined ? {} : { sudoSecret }),
    identities: form.identities,
    sftpServerPath
  }
  return { ok: true, input }
}

/** 显示用的「主机:端口」（IPv6 地址加方括号） */
export function hostPort(host: string, port: number): string {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`
}
