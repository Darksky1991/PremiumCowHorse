// ssh2 1.17.0 内部模块 lib/protocol/SFTP.js 的最小类型（只给 sftp-bridge.ts 用）。
// 依据：node_modules/ssh2/lib/protocol/SFTP.js 第 134–186 行（constructor）、189 行（push）、
// 283–295 行（end / destroy / _init）、866 行（readdir）、4045 行（module.exports）。
declare module 'ssh2/lib/protocol/SFTP.js' {
  import type { EventEmitter } from 'node:events'
  import type { FileEntryWithStats, Stats } from 'ssh2'

  export interface SftpChannelInfo {
    type: 'session'
    incoming: { id: number; window: number; packetSize: number; state: string }
    outgoing: { id: number; window: number; packetSize: number; state: string }
  }
  /** 构造时只读取 client._protocol（_remoteIdentRaw、channelData、channelClose） */
  export interface SftpFakeClient {
    _protocol: {
      _remoteIdentRaw: string | undefined
      channelData(id: number, data: Buffer): void
      channelClose(id: number): void
    }
  }

  export class SFTP extends EventEmitter {
    constructor(client: SftpFakeClient, chanInfo: SftpChannelInfo, cfg: { debug?: unknown })
    /** 收到的通道数据；null = 对端结束（未完成的请求以 'No response from server' 失败） */
    push(data: Buffer | null): void
    _init(): void
    end(): void
    destroy(): void
    stat(path: string, cb: (err: Error | undefined, stats: Stats) => void): void
    lstat(path: string, cb: (err: Error | undefined, stats: Stats) => void): void
    readdir(path: string, cb: (err: Error | undefined, list: FileEntryWithStats[]) => void): void
    realpath(path: string, cb: (err: Error | undefined, absPath: string) => void): void
  }
}
