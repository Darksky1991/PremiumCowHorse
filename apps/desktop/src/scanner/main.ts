import { rmSync } from 'node:fs'
import { AppError, MainToScanner, type AppErrorPayload, type ScannerToMain } from '@pch/shared'
import { toAppError } from '../main/vfs/errors'
import { Cache } from './cache/cache'
import { createEnumerator } from './enum/create-enumerator'
import type { Enumerator } from './enum/types'
import { search } from './search/search'
import { Scheduler } from './schedule/scheduler'

/**
 * 扫描进程入口（utilityProcess，serviceName 'pch-scanner'）。
 * 进程只负责收发消息（process.parentPort）；消息处理拆为 createScannerHost，便于直接测试。
 */

type Level = 'info' | 'warn' | 'error'

export interface ScannerHostDeps {
  post: (m: ScannerToMain) => void
  /** shutdown 处理完后调用（进程入口里是 process.exit） */
  exit: (code: number) => void
  /** libuv 线程池大小（fork 时由主进程经 UV_THREADPOOL_SIZE 设置），传给调度器 */
  threadPoolSize?: number
  /** 测试用：替换枚举器 */
  createEnumerator?: (log: (msg: string) => void) => Enumerator
}

export interface ScannerHost {
  /** 处理一条来自主进程的消息（先用 zod 校验，无效则记日志并忽略） */
  handleMessage(raw: unknown): void
}

interface Ready {
  cache: Cache
  scheduler: Scheduler
}

type HostState =
  { kind: 'idle' } | { kind: 'ready'; r: Ready } | { kind: 'unavailable'; reason: string }

const unavailable = (detail: string): AppErrorPayload =>
  new AppError({ code: 'INDEX_UNAVAILABLE', detail }).toPayload()

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * 打开缓存库；失败（例如 file is not a database）时删除 index.db 及 -wal、-shm 后重建一次。
 * 缓存可随时重建（设计 4.3），删除的只是应用自己的缓存文件。重建仍失败则抛出。
 */
export function openCacheWithRecovery(
  file: string,
  log: (level: Level, msg: string) => void
): Cache {
  try {
    return Cache.open(file)
  } catch (e) {
    log('warn', `cannot open the index (${message(e)}); deleting and rebuilding ${file}`)
  }
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try {
      rmSync(f, { force: true })
    } catch (e) {
      log('warn', `cannot delete ${f}: ${message(e)}`)
    }
  }
  return Cache.open(file)
}

export function createScannerHost(deps: ScannerHostDeps): ScannerHost {
  const log = (level: Level, msg: string): void => deps.post({ type: 'log', level, message: msg })
  let state: HostState = { kind: 'idle' }
  let stopped = false

  const reply = (id: number, run: (r: Ready) => unknown): void => {
    if (state.kind !== 'ready') {
      const reason = state.kind === 'idle' ? 'scanner is not initialized' : state.reason
      deps.post({ type: 'result', id, ok: false, error: unavailable(reason) })
      return
    }
    const r = state.r
    Promise.resolve()
      .then(() => run(r))
      .then(
        (value) => deps.post({ type: 'result', id, ok: true, value }),
        (e: unknown) =>
          deps.post({ type: 'result', id, ok: false, error: toAppError(e).toPayload() })
      )
  }

  const init = (cacheFile: string): void => {
    if (state.kind !== 'idle') {
      log('warn', 'duplicate init ignored')
      return
    }
    let cache: Cache
    try {
      cache = openCacheWithRecovery(cacheFile, log)
    } catch (e) {
      const reason = `cannot open the index ${cacheFile}: ${message(e)}`
      log('error', `${reason}; all requests will fail with INDEX_UNAVAILABLE`)
      state = { kind: 'unavailable', reason }
      return
    }
    const enumerator = (deps.createEnumerator ?? createEnumerator)((msg) => log('warn', msg))
    const scheduler = new Scheduler({
      enumerator,
      cache,
      events: {
        changed: (uri) => deps.post({ type: 'changed', uri }),
        reachability: (share, s, since) =>
          deps.post({ type: 'reachability', share, state: s, since })
      },
      threadPoolSize: deps.threadPoolSize,
      log
    })
    state = { kind: 'ready', r: { cache, scheduler } }
    log('info', `index ${cacheFile}, native enumeration: ${enumerator.native}`)
    deps.post({ type: 'ready' })
  }

  /** 不回应的消息：未就绪时忽略（主进程在重启后会重发配置与关注点） */
  const withReady = (fn: (r: Ready) => void): void => {
    if (state.kind === 'ready') fn(state.r)
  }

  const shutdown = (): void => {
    if (stopped) return
    stopped = true
    if (state.kind === 'ready') {
      state.r.scheduler.dispose()
      state.r.cache.close()
    }
    state = { kind: 'unavailable', reason: 'scanner is shutting down' }
    deps.exit(0)
  }

  const dispatch = (m: MainToScanner): void => {
    switch (m.type) {
      case 'init':
        return init(m.cacheFile)
      case 'configure':
        return withReady(({ scheduler }) =>
          scheduler.configure(
            m.config.roots,
            m.config.indexTargets,
            m.config.settings,
            m.config.allRootUris
          )
        )
      case 'list':
        return reply(m.id, ({ scheduler }) => scheduler.listNow(m.uri))
      case 'interest':
        return withReady(({ scheduler }) =>
          scheduler.setInterest(m.ownerId, {
            focus: m.focus,
            visible: m.visible,
            offscreen: m.offscreen
          })
        )
      case 'windowFocus':
        return withReady(({ scheduler }) => scheduler.setWindowFocus(m.ownerId, m.focused))
      case 'releaseOwner':
        return withReady(({ scheduler }) => scheduler.releaseOwner(m.ownerId))
      case 'refresh':
        return withReady(({ scheduler }) => scheduler.refresh(m.uris))
      case 'cacheInfo':
        return reply(m.id, ({ cache }) => ({ bytes: cache.sizeBytes() }))
      case 'clearCache':
        return reply(m.id, ({ cache }) => {
          cache.clear()
          return undefined
        })
      case 'search':
        return reply(m.id, ({ cache }) =>
          search(cache, {
            scopes: m.scopes,
            terms: m.terms,
            kind: m.kind,
            showHidden: m.showHidden,
            limit: m.limit
          })
        )
      case 'cancel':
        // 搜索是同步 SQL，无法中途打断；取消由主进程客户端丢弃旧结果实现
        return
      case 'shutdown':
        return shutdown()
    }
  }

  return {
    handleMessage(raw) {
      const parsed = MainToScanner.safeParse(raw)
      if (!parsed.success) {
        log('warn', `invalid message ignored: ${parsed.error.message.slice(0, 500)}`)
        return
      }
      try {
        dispatch(parsed.data)
      } catch (e) {
        log('error', `failed to handle ${parsed.data.type}: ${message(e)}`)
      }
    }
  }
}

// 只在 utilityProcess 中运行（测试中 parentPort 不存在）
const port = (process as { parentPort?: Electron.ParentPort }).parentPort
if (port) {
  const host = createScannerHost({
    post: (m) => port.postMessage(m),
    exit: (code) => process.exit(code),
    threadPoolSize: Number(process.env['UV_THREADPOOL_SIZE']) || undefined
  })
  port.on('message', (e) => host.handleMessage(e.data))
}
