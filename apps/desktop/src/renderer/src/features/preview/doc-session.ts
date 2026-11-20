import {
  DocStaleError,
  type DocChange,
  type DocProgress,
  type PreviewDocApi
} from '@pch/plugin-sdk'
import { AppError, type DocChangedEvent, type DocProgressEvent } from '@pch/shared'
import type { Invoke } from '@renderer/data/vfs'
import { isUncUri } from '@renderer/lib/file-uri'

/** doc.* 事件的订阅（data/doc.ts；测试注入假实现）；返回取消订阅函数 */
export interface DocEvents {
  onProgress(listener: (event: DocProgressEvent) => void): () => void
  onChanged(listener: (event: DocChangedEvent) => void): () => void
}

export interface DocSessionDeps {
  invoke: Invoke
  events: DocEvents
  /** 本标签的刷新请求（地址栏的刷新按钮 / F5）；返回取消订阅函数 */
  onRefresh(listener: () => void): () => void
}

/** 宿主的 PreviewHost.doc：一个标签内容（PluginView）一个 */
export interface DocSession extends PreviewDocApi {
  /** 自动刷新的条件：本标签是激活标签且窗口聚焦 */
  setActive(active: boolean): void
  /** 自动刷新的间隔（cache.interval.focus.local / .network，毫秒） */
  setIntervals(intervals: { localMs: number; networkMs: number }): void
  /** 标签内容卸载：关闭仍打开的文档（含之后才完成的 open）、停止刷新。之后仍可使用（StrictMode） */
  dispose(): void
}

type ChangeFlags = Omit<DocChangedEvent, 'docId'>

interface OpenDoc {
  docId: string
  uri: string
  /** reset / setEncoding / buildIndex 时递增：发出时的代号与当前不同的 readLines 结果过期 */
  generation: number
  /** 收到、尚未连同 info 通知插件的变化 */
  pending: ChangeFlags
  refreshing: boolean
  timer: ReturnType<typeof setTimeout> | null
}

const isEmpty = (flags: ChangeFlags): boolean => !flags.appended && !flags.reset && !flags.missing

/**
 * 预览宿主的文本文档 API（设计 3.5、3.6 节）。
 * - 自动刷新由宿主负责：激活且聚焦时，每个打开的文档按位置（UNC = 网络）每隔设置的秒数 doc.refresh 一次
 *   （上一次返回后才计时，不重叠）；文件不存在（missing）后也照常检查，日志轮转（改名后新建同名文件）时
 *   不按 F5 也会以 reset 回到新文件；地址栏刷新 / F5 立即刷新全部文档。
 * - 变化通知：主进程的 doc.changed 先记下，等刷新的应答（DocumentInfo）到达后连同 info 一起交给插件；
 *   主进程自行发现的变化（建索引中重新判断编码等）没有进行中的刷新时，宿主刷新一次取得 info。
 * - 过期丢弃：reset 事件到达、setEncoding / buildIndex 完成时文档的代号递增，
 *   之前发出的 readLines 的结果以 DocStaleError 拒绝（行号的含义已经变了）。
 * IPC 事件、标签刷新请求的订阅在第一个文档打开时建立，最后一个文档关闭时取消。
 */
export function createDocSession(deps: DocSessionDeps): DocSession {
  const { invoke } = deps
  const docs = new Map<string, OpenDoc>()
  const progressListeners = new Map<string, Set<(p: DocProgress) => void>>()
  const changeListeners = new Map<string, Set<(c: DocChange) => void>>()
  let active = false
  let intervals = { localMs: 5000, networkMs: 10_000 }
  /** dispose 时递增：之前发出、之后才完成的 open 关闭 */
  let epoch = 0
  let unsubscribe: (() => void) | null = null

  const listen = <T>(map: Map<string, Set<T>>, docId: string, cb: T): (() => void) => {
    const set = map.get(docId) ?? new Set<T>()
    map.set(docId, set)
    set.add(cb)
    return () => {
      set.delete(cb)
      if (set.size === 0 && map.get(docId) === set) map.delete(docId)
    }
  }

  const clearTimer = (doc: OpenDoc): void => {
    if (doc.timer !== null) clearTimeout(doc.timer)
    doc.timer = null
  }

  const schedule = (doc: OpenDoc): void => {
    if (!active || doc.refreshing || doc.timer !== null) return
    if (docs.get(doc.docId) !== doc) return
    const ms = isUncUri(doc.uri) ? intervals.networkMs : intervals.localMs
    doc.timer = setTimeout(() => {
      doc.timer = null
      refresh(doc)
    }, ms)
  }

  /** doc.refresh；应答到达时把记下的变化连同 info 交给插件。进行中时不重复发出 */
  const refresh = (doc: OpenDoc): void => {
    if (doc.refreshing) return
    clearTimer(doc)
    doc.refreshing = true
    invoke('doc.refresh', { docId: doc.docId })
      .then((info) => {
        if (docs.get(doc.docId) !== doc) return
        const flags = doc.pending
        doc.pending = {}
        if (isEmpty(flags)) return
        const change: DocChange = { docId: doc.docId, ...flags, info }
        for (const cb of [...(changeListeners.get(doc.docId) ?? [])]) cb(change)
      })
      .catch((e: unknown) => {
        // 文档已不在主进程（因每窗口上限被关闭、页面重新加载）：不再刷新；插件之后的调用得到 DOC_NOT_FOUND
        if (e instanceof AppError && e.code === 'DOC_NOT_FOUND') untrack(doc.docId)
      })
      .finally(() => {
        doc.refreshing = false
        // 刷新期间又收到变化（应答先于事件到达）：再取一次 info
        if (docs.get(doc.docId) === doc && !isEmpty(doc.pending)) refresh(doc)
        else schedule(doc)
      })
  }

  const onChanged = ({ docId, ...flags }: DocChangedEvent): void => {
    const doc = docs.get(docId)
    if (!doc) return
    if (flags.reset) {
      doc.generation++
      // 文件又出现了：之前记下的 missing 不再成立
      delete doc.pending.missing
    }
    doc.pending = { ...doc.pending, ...flags }
    refresh(doc)
  }

  const onProgress = (event: DocProgressEvent): void => {
    if (!docs.has(event.docId)) return
    for (const cb of [...(progressListeners.get(event.docId) ?? [])]) cb(event)
  }

  const subscribe = (): void => {
    if (unsubscribe) return
    const offs = [
      deps.events.onChanged(onChanged),
      deps.events.onProgress(onProgress),
      deps.onRefresh(() => docs.forEach(refresh))
    ]
    unsubscribe = () => offs.forEach((off) => off())
  }

  const untrack = (docId: string): void => {
    const doc = docs.get(docId)
    if (doc) clearTimer(doc)
    docs.delete(docId)
    progressListeners.delete(docId)
    changeListeners.delete(docId)
    if (docs.size === 0) {
      unsubscribe?.()
      unsubscribe = null
    }
  }

  const close = (docId: string): void => {
    untrack(docId)
    invoke('doc.close', { docId }).catch(() => undefined)
  }

  /** 改变行号含义的操作完成：之前发出的 readLines 结果过期 */
  const invalidate = (docId: string): void => {
    const doc = docs.get(docId)
    if (doc) doc.generation++
  }

  return {
    open: async (uri, opts) => {
      const started = epoch
      const info = await invoke('doc.open', {
        uri,
        ...(opts?.encoding !== undefined ? { encoding: opts.encoding } : {}),
        ...(opts?.at !== undefined ? { at: opts.at } : {})
      })
      if (started !== epoch) {
        invoke('doc.close', { docId: info.docId }).catch(() => undefined)
        throw new AppError({ code: 'DOC_NOT_FOUND', detail: info.docId })
      }
      const doc: OpenDoc = {
        docId: info.docId,
        uri,
        generation: 0,
        pending: {},
        refreshing: false,
        timer: null
      }
      docs.set(doc.docId, doc)
      subscribe()
      schedule(doc)
      return info
    },
    readLines: async (docId, start, count) => {
      const doc = docs.get(docId)
      const generation = doc?.generation
      const block = await invoke('doc.readLines', { docId, start, count })
      if (doc && (docs.get(docId) !== doc || doc.generation !== generation)) {
        throw new DocStaleError(docId)
      }
      return block
    },
    setEncoding: async (docId, encoding) => {
      const info = await invoke('doc.setEncoding', { docId, encoding })
      invalidate(docId)
      return info
    },
    buildIndex: async (docId) => {
      const info = await invoke('doc.buildIndex', { docId })
      invalidate(docId)
      return info
    },
    close,
    onProgress: (docId, cb) => listen(progressListeners, docId, cb),
    onChanged: (docId, cb) => listen(changeListeners, docId, cb),
    setActive: (next) => {
      if (next === active) return
      active = next
      docs.forEach(active ? schedule : clearTimer)
    },
    setIntervals: (next) => {
      intervals = next
    },
    dispose: () => {
      epoch++
      for (const docId of [...docs.keys()]) close(docId)
    }
  }
}
