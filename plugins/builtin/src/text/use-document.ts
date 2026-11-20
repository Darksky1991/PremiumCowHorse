import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocChange, DocEncoding, DocumentInfo, PreviewHost } from '@pch/plugin-sdk'

export interface DocumentState {
  info: DocumentInfo | null
  /** 打开失败时的文案（host.i18n.describeError） */
  error: string | null
  /** 最近一次检查时文件不存在（保留已缓存的内容） */
  missing: boolean
  /** 索引出错时的错误码（刷新时宿主重试；之后的进度清除它） */
  indexError: string | null
  /**
   * 行号的含义改变（reset、切换编码、读取全部）的次数：变化时丢弃已缓存的行。
   * 宿主同时让此前发出的 readLines 以 DocStaleError 拒绝
   */
  epoch: number
  /**
   * reset 已到、变化之后的 info 还没到（宿主先不带 info 通知 reset）：info 的行数与编码还是旧的，
   * 不读取行（显示占位行），避免新旧内容混排
   */
  awaitingInfo: boolean
}

export interface DocumentHandle extends DocumentState {
  /** 手动指定编码（null = 自动判断） */
  setEncoding(label: DocEncoding | null): void
  /** 部分模式 → 全量；成功时在新 info 生效的同一次更新中调用 onDone（调用方据此换算位置） */
  buildIndex(onDone?: () => void): void
}

export interface OpenOptions {
  encoding?: DocEncoding
  at: 'start' | 'end'
}

const INITIAL: DocumentState = {
  info: null,
  error: null,
  missing: false,
  indexError: null,
  epoch: 0,
  awaitingInfo: false
}

/**
 * 文档的打开 / 关闭 / 订阅（设计 3.5、3.6）：挂载时 host.doc.open（选项只取第一次的），卸载时 close。
 * 进度更新 info.index；变化（DocChange）带来新的 info：reset 时 epoch 递增，missing 时显示「文件已不存在」；
 * 不带 info 的 reset（宿主立即转达）先递增 epoch 并等待 info（awaitingInfo）。
 * 消息按到达顺序处理（后到的覆盖先到的）：进度与刷新的应答都是主进程在发出时的状态。
 * 切换编码与读取全部的结果也替换 info 并递增 epoch；失败时以 toast 提示
 */
export function useDocument(host: PreviewHost, uri: string, options: OpenOptions): DocumentHandle {
  const [state, setState] = useState<DocumentState>(INITIAL)
  const [initial] = useState(options)
  // 宿主对象随设置等重建（doc 会话是同一个）：回调里取最新的
  const hostRef = useRef(host)
  useEffect(() => {
    hostRef.current = host
  }, [host])
  const docIdRef = useRef<string | null>(null)
  const doc = host.doc

  useEffect(() => {
    let alive = true
    let docId: string | null = null
    let offs: Array<() => void> = []
    // 宿主按位置重建标签内容（uri 在组件存续期间不变）：不必在这里重置状态
    doc
      .open(uri, {
        at: initial.at,
        ...(initial.encoding !== undefined ? { encoding: initial.encoding } : {})
      })
      .then(
        (info) => {
          if (!alive) {
            doc.close(info.docId)
            return
          }
          docId = info.docId
          docIdRef.current = docId
          offs = [
            doc.onProgress(info.docId, (p) =>
              setState((s) =>
                s.info === null
                  ? s
                  : {
                      ...s,
                      info: {
                        ...s.info,
                        index: { lines: p.lines, complete: p.complete, indexedTo: p.indexedTo }
                      },
                      indexError: p.error ?? null
                    }
              )
            ),
            doc.onChanged(info.docId, (c) => setState((s) => applyChange(s, c)))
          ]
          setState({ ...INITIAL, info })
        },
        (e: unknown) => {
          if (alive) setState({ ...INITIAL, error: hostRef.current.i18n.describeError(e) })
        }
      )
    return () => {
      alive = false
      offs.forEach((off) => off())
      if (docId !== null) doc.close(docId)
      docIdRef.current = null
    }
  }, [doc, uri, initial])

  /** 改变行号含义的操作：结果替换 info、epoch 递增（onDone 与之同批更新） */
  const relayout = useCallback(
    (op: (docId: string) => Promise<DocumentInfo>, onDone?: () => void): void => {
      const docId = docIdRef.current
      if (docId === null) return
      op(docId).then(
        (info) => {
          if (docIdRef.current !== docId) return
          onDone?.()
          setState((s) => ({
            ...s,
            info,
            indexError: null,
            epoch: s.epoch + 1,
            awaitingInfo: false
          }))
        },
        (e: unknown) => {
          const h = hostRef.current
          if (docIdRef.current === docId) h.ui.toast(h.i18n.describeError(e), 'error')
        }
      )
    },
    []
  )
  const setEncoding = useCallback(
    (label: DocEncoding | null) => relayout((id) => doc.setEncoding(id, label)),
    [doc, relayout]
  )
  const buildIndex = useCallback(
    (onDone?: () => void) => relayout((id) => doc.buildIndex(id), onDone),
    [doc, relayout]
  )

  return { ...state, setEncoding, buildIndex }
}

/**
 * DocChange → 状态：info 取变化之后的；reset 递增 epoch；文件又出现（reset / appended）时清除 missing。
 * 不带 info（reset 先到）：保留旧 info、等待新的（awaitingInfo）
 */
export function applyChange(s: DocumentState, c: DocChange): DocumentState {
  if (s.info === null || s.info.docId !== c.docId) return s
  return {
    ...s,
    info: c.info ?? s.info,
    missing: c.missing === true && !c.reset,
    epoch: c.reset ? s.epoch + 1 : s.epoch,
    awaitingInfo: c.info === undefined
  }
}
