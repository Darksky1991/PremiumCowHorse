// 测试辅助（单元测试与 e2e 共用）：生产代码不得 import 本文件。
import { utils } from 'ssh2'

/** ed25519 公钥的字节数（RFC 8032） */
const ED25519_PUBLIC_LENGTH = 32
/** 连续生成坏密钥的概率为 (1/256)^n；超过上限视为 ssh2 的行为又变了，直接报错而不是无限循环 */
const MAX_ATTEMPTS = 16

/** OpenSSH 一行格式公钥（`ssh-ed25519 <base64> [comment]`）中的公钥字节数 */
function publicKeyLength(publicLine: string): number {
  const blob = Buffer.from(publicLine.split(' ')[1] ?? '', 'base64')
  const nameLen = blob.readUInt32BE(0)
  return blob.readUInt32BE(4 + nameLen)
}

/**
 * 生成 ed25519 密钥对（OpenSSH 格式；给 passphrase 时以 aes256-ctr 加密）。
 *
 * 不直接用 ssh2 的 `utils.generateKeyPairSync('ed25519')`：ssh2 1.17.0 的 lib/keygen.js 第 290–297 行
 * 从 SPKI 的 BIT STRING 取公钥时「去掉所有前导 0x00」，本意只是去掉「未用位数」字节，
 * 但公钥本身以 0x00 开头（概率 1/256）时也被截掉，生成 31 字节的公钥，
 * ssh2 自己的 parseKey 随即以 `Malformed OpenSSH private key` 拒绝（keyParser.js 第 723–725 行）。
 * 这里按根因检查输出（公钥必须是 32 字节），只丢弃这种有缺陷的输出，不是对测试失败的重试。
 */
export function generateEd25519KeyPair(passphrase?: string): { private: string; public: string } {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const pair = passphrase
      ? utils.generateKeyPairSync('ed25519', { passphrase, cipher: 'aes256-ctr', rounds: 16 })
      : utils.generateKeyPairSync('ed25519')
    if (publicKeyLength(pair.public) === ED25519_PUBLIC_LENGTH) return pair
  }
  throw new Error('ssh2 generateKeyPairSync kept producing malformed ed25519 keys')
}
