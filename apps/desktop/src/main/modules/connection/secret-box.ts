import { safeStorage } from 'electron'

/** 机密的加解密。存储格式为 base64，数据库里不出现明文 */
export interface SecretBox {
  available(): boolean
  encrypt(plain: string): string // base64
  decrypt(stored: string): string
}

/** 基于 Electron safeStorage（Windows 下为 DPAPI，绑定当前用户） */
export function electronSecretBox(): SecretBox {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (stored) => safeStorage.decryptString(Buffer.from(stored, 'base64'))
  }
}
