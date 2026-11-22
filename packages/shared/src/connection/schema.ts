import { z } from 'zod'
import { IDENTITY_PATTERN } from '../vfs/sftp-uri'

/** sftp-server 路径：绝对路径，只允许这些字符（会出现在远端命令行中，必须严格） */
export const SFTP_SERVER_PATH_PATTERN = /^\/[A-Za-z0-9._/+-]{1,254}$/

const identity = z.string().regex(IDENTITY_PATTERN)
const secret = z
  .string()
  .max(1024)
  .refine((s) => !/[\r\n]/.test(s), { message: 'must not contain line breaks' })

/** 保存连接的输入；secret / sudoSecret 省略 = 不变 */
export const ConnectionSaveInput = z.strictObject({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(100),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: identity,
  auth: z.enum(['password', 'key']),
  keyPath: z.string().min(1).max(32767).nullable(),
  secret: secret.optional(),
  /** null = 用登录密码 */
  sudoSecret: secret.nullable().optional(),
  identities: z
    .array(identity)
    .max(20)
    .refine((a) => new Set(a).size === a.length, { message: 'duplicate identities' }),
  sftpServerPath: z.string().regex(SFTP_SERVER_PATH_PATTERN).nullable()
})
export type ConnectionSaveInput = z.infer<typeof ConnectionSaveInput>

/**
 * 「信任新的密钥」的输入（I4）：用户在确认框中看到的密钥。主进程与服务器最新出示的密钥比较，
 * 不一致即拒绝（CONN_HOST_KEY_CHANGED），不保存用户没有看到的密钥
 */
export const ConnectionTrustHostKeyInput = z.strictObject({
  id: z.string().min(1),
  key: z.strictObject({
    algorithm: z.string().max(200),
    fingerprint: z.string().min(1).max(200)
  })
})
export type ConnectionTrustHostKeyInput = z.infer<typeof ConnectionTrustHostKeyInput>
