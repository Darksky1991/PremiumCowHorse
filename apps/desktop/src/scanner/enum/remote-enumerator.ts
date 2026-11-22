import {
  AppError,
  RemoteListValue,
  RemoteStatValue,
  type AppErrorPayload,
  type ScannerToMain
} from '@pch/shared'
import { toAppError } from '../../main/vfs/errors'
import { createLocator } from '../../main/vfs/location'
import type { Enumerator } from './types'

/**
 * 远程目录（sftp:）的读取请求通道：扫描进程不持有 SSH 连接，经 remoteOp 请主进程用 SftpProvider 读取
 * （设计 devDoc/2026-11-22-37 第 4.1、5.6 节）。请求 id 由这里分配，与主进程分配的请求 id 是两个独立的
 * 编号空间（方向相反），pending 表也各自独立。
 */
export interface RemoteRpc {
  call(
    op: 'stat' | 'list',
    uri: string,
    opts: { signal: AbortSignal; userAction: boolean }
  ): Promise<unknown>
  /** 主进程的 remoteResult（未知或已结束的 id 忽略） */
  settle(m: { id: number; ok: boolean; value?: unknown; error?: AppErrorPayload }): void
  /** 扫描进程关闭：全部以 FS_CANCELLED 拒绝 */
  dispose(): void
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: AppError) => void
}

/** signal 的中止原因（看门狗为 FS_TIMEOUT）；不是 AppError 时按取消处理 */
function abortReason(signal: AbortSignal): AppError {
  const r: unknown = signal.reason
  return r instanceof AppError ? r : new AppError({ code: 'FS_CANCELLED' })
}

export function createRemoteRpc(post: (m: ScannerToMain) => void): RemoteRpc {
  let nextId = 1
  const pending = new Map<number, Pending>()

  return {
    call(op, uri, { signal, userAction }) {
      if (signal.aborted) return Promise.reject(abortReason(signal))
      const id = nextId++
      return new Promise<unknown>((resolve, reject) => {
        // 中止时立即拒绝（不等主进程回应）：调度器的并发名额随之释放；主进程收到 remoteCancel 后中止读取
        const onAbort = (): void => {
          if (!pending.delete(id)) return
          reject(abortReason(signal))
          try {
            post({ type: 'remoteCancel', id })
          } catch {
            // 发送失败（进程正在退出）：主进程在扫描进程退出时会中止全部远程请求
          }
        }
        const done = (): void => signal.removeEventListener('abort', onAbort)
        pending.set(id, {
          resolve: (v) => (done(), resolve(v)),
          reject: (e) => (done(), reject(e))
        })
        signal.addEventListener('abort', onAbort, { once: true })
        try {
          post({ type: 'remoteOp', id, op, uri, userAction })
        } catch (e) {
          pending.get(id)?.reject(toAppError(e))
          pending.delete(id)
        }
      })
    },
    settle(m) {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.ok) p.resolve(m.value)
      else
        p.reject(new AppError(m.error ?? { code: 'UNKNOWN', detail: 'remoteResult without error' }))
    },
    dispose() {
      const all = [...pending.values()]
      pending.clear()
      for (const p of all) p.reject(new AppError({ code: 'FS_CANCELLED' }))
    }
  }
}

/** 主进程回来的值不合结构：按扫描进程内部的问题处理（不是远程目录的状态） */
function invalid(op: string, uri: string, message: string): AppError {
  return new AppError({
    code: 'INDEX_UNAVAILABLE',
    detail: `invalid remote ${op} result for ${uri}: ${message.slice(0, 300)}`
  })
}

/**
 * 远程目录的枚举器：statDir → remoteOp stat，list → remoteOp list（一次返回完整列表，onBatch 调一次）。
 * userAction 未给出时按后台读取（false：断线时不自动重连重试）。
 * location / shareKey / hostKey 与主进程共用 main/vfs/location.ts（sftp: 不需要 GetDriveTypeW）。
 */
export function createRemoteEnumerator(rpc: RemoteRpc): Enumerator {
  const locator = createLocator(null)
  return {
    native: false,
    async statDir(uri, signal, opts) {
      const v = await rpc.call('stat', uri, { signal, userAction: opts?.userAction ?? false })
      const r = RemoteStatValue.safeParse(v)
      if (!r.success) throw invalid('stat', uri, r.error.message)
      return r.data
    },
    async list(uri, { signal, onBatch, userAction }) {
      const v = await rpc.call('list', uri, { signal, userAction: userAction ?? false })
      const r = RemoteListValue.safeParse(v)
      if (!r.success) throw invalid('list', uri, r.error.message)
      onBatch()
      return r.data
    },
    location: (uri) => locator.location(uri),
    shareKey: (uri) => locator.shareKey(uri),
    hostKey: (uri) => locator.hostKey(uri)
  }
}
