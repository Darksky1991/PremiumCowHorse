// 唯一借用 ssh2 内部模块 lib/protocol/SFTP.js 的文件（类型见 ssh2-internal.d.ts）。
// 做法同先行试验 scripts/wsl-sftp/reference/sudo-sftp-spike.mjs 的 sftpOverStream（4 个发行版实测）。
import { SFTP, type SftpChannelInfo } from 'ssh2/lib/protocol/SFTP.js'
import { AppError } from '@pch/shared'
import type { SftpSession } from '../../vfs/providers/sftp.provider'
import { wrapSftp } from './sftp-session'
import type { ExecChannel, SshSession } from './ssh-session'

/** 握手（INIT → VERSION）的等待上限 */
const READY_TIMEOUT_MS = 8000

function sudoFailed(detail: string): AppError {
  return new AppError({ code: 'CONN_SUDO_FAILED', detail })
}

/**
 * 在任意命令通道（如 `sudo su - app1` 之后 exec 的 sftp-server）上跑 SFTP 客户端协议。
 * firstData：调用方在交接之前已从 stdout 读到的、标记之后的字节。
 * 8 秒内没有 ready（或通道先关闭 / 协议错误）→ CONN_SUDO_FAILED，并关闭通道。
 */
export function sftpOverChannel(
  session: SshSession,
  channel: ExecChannel,
  firstData: Buffer
): Promise<SftpSession> {
  // SFTP 构造时读取 _remoteIdentRaw 判断是否 OpenSSH（决定最大读写长度，SFTP.js 第 141–162 行）
  const proto = (session.client as unknown as { _protocol?: { _remoteIdentRaw?: string } })
    ._protocol
  const chanInfo: SftpChannelInfo = {
    type: 'session',
    // 流量控制由真实的 SSH 通道负责：这里的窗口取足够大的值，不再按 SFTP 层计数
    incoming: { id: 0, window: 2 ** 31, packetSize: 32768, state: 'open' },
    outgoing: { id: 0, window: Number.MAX_SAFE_INTEGER, packetSize: 32768, state: 'open' }
  }
  const sftp = new SFTP(
    {
      _protocol: {
        _remoteIdentRaw: proto?._remoteIdentRaw,
        channelData: (_id, data) => channel.write(data),
        channelClose: () => channel.close()
      }
    },
    chanInfo,
    {}
  )

  return new Promise<SftpSession>((resolve, reject) => {
    let settled = false
    const fail = (detail: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(sudoFailed(detail))
      channel.close()
    }
    const timer = setTimeout(() => fail('sftp init timeout'), READY_TIMEOUT_MS)

    // 先包装：wrapSftp 挂上 end / close / error 的监听（error 无监听者会让进程崩溃）
    const wrapped = wrapSftp(sftp)
    sftp.once('ready', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(wrapped)
    })
    sftp.on('error', (e: Error) => fail(`sftp: ${e.message}`))

    const ended = (): void => {
      // 通道结束：之后的写入不再发出（tryWritePayload 检查 outgoing.state），未完成的请求失败
      chanInfo.outgoing.state = 'closed'
      sftp.push(null)
      fail('channel closed before sftp ready')
    }
    channel.stream.on('data', (d: Buffer) => sftp.push(d))
    channel.stream.on('end', ended)
    channel.onClose(ended)

    sftp._init()
    if (firstData.length) sftp.push(firstData)
  })
}
