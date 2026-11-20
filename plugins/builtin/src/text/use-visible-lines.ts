import { useEffect, useMemo, useRef, useState } from 'react'
import { DocStaleError, type DocumentInfo, type PreviewHost } from '@pch/plugin-sdk'
import { BlockCache, type CachedLine } from './block-cache'
import { decodeLines } from './decode-lines'

/** 同时在途的 readLines 上限（快速拖动时不堆积请求） */
const MAX_IN_FLIGHT = 4
/** 一次 readLines 的行数上限（IPC 契约） */
const MAX_READ_LINES = 2000

export interface VisibleLines {
  /** 第 top 行起的行；还没读到的为 null（显示占位行） */
  lines: Array<CachedLine | null>
  /** 读取失败时的文案（DocStaleError 不算） */
  error: string | null
}

/**
 * 按可见范围读取并解码行（设计 3.5）：块缓存（block-cache.ts）中缺的行按块请求（每块同时只有一个请求），
 * 应答到达时块已离开视口附近则丢弃；info.docId 或 epoch 改变时换一个新的缓存（旧请求的应答随之作废）。
 * 行数变化而此前索引已完成时，原来的最后一行可能被追加延长：从它起丢弃。
 * 失败的块在行数或 epoch 改变之前不再请求（不形成请求循环）
 */
export function useVisibleLines(
  host: PreviewHost,
  info: DocumentInfo | null,
  epoch: number,
  top: number,
  count: number
): VisibleLines {
  const docId = info?.docId ?? null
  const total = info?.index.lines ?? 0
  const complete = info?.index.complete ?? false
  const label = info?.encoding.label ?? 'utf-8'
  const bomLength = info?.encoding.bomLength ?? 0
  const doc = host.doc
  const describeError = host.i18n.describeError

  // eslint-disable-next-line react-hooks/exhaustive-deps -- epoch 只用于换新缓存
  const cache = useMemo(() => new BlockCache(), [docId, epoch])
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(new WeakMap<BlockCache, Set<number>>())
  const failed = useRef(new WeakMap<BlockCache, Set<number>>())
  const viewport = useRef({ top, count })
  useEffect(() => {
    viewport.current = { top, count }
  }, [top, count])

  // 行数变化：此前已完成时原来的最后一行可能变长；失败的块可以再试
  const previous = useRef({ cache, total, complete })
  useEffect(() => {
    const prev = previous.current
    previous.current = { cache, total, complete }
    if (prev.cache !== cache) return
    if (prev.total === total && prev.complete === complete) return
    if (prev.complete && prev.total > 0) cache.dropFrom(prev.total - 1)
    failed.current.delete(cache)
    setVersion((v) => v + 1)
  }, [cache, total, complete])

  useEffect(() => {
    if (docId === null) return
    const pending = inFlight.current.get(cache) ?? new Set<number>()
    inFlight.current.set(cache, pending)
    const broken = failed.current.get(cache) ?? new Set<number>()
    failed.current.set(cache, broken)
    for (const request of cache.missing(top, top + count, total)) {
      if (pending.size >= MAX_IN_FLIGHT) break
      if (pending.has(request.block) || broken.has(request.block)) continue
      pending.add(request.block)
      const stamp = cache.stamp()
      doc
        .readLines(docId, request.start, Math.min(request.count, MAX_READ_LINES))
        .then(
          (block) => {
            if (block.starts.length === 0) broken.add(request.block)
            else if (isNear(cache, request.block, viewport.current)) {
              cache.put(block.start, decodeLines(block, { label, bomLength }), stamp)
            }
            setError(null)
          },
          (e: unknown) => {
            if (e instanceof DocStaleError) return
            broken.add(request.block)
            setError(describeError(e))
          }
        )
        .finally(() => {
          pending.delete(request.block)
          setVersion((v) => v + 1)
        })
    }
  }, [doc, describeError, docId, cache, label, bomLength, top, count, total, version])

  const end = Math.min(top + count, total)
  const lines: Array<CachedLine | null> = []
  for (let n = top; n < end; n++) lines.push(cache.get(n) ?? null)
  return { lines, error }
}

/** 块仍在视口附近（前后各一块以内）：离开的块的应答不解码、不缓存 */
function isNear(cache: BlockCache, block: number, view: { top: number; count: number }): boolean {
  const first = cache.blockOf(view.top)
  const last = cache.blockOf(view.top + Math.max(0, view.count - 1))
  return block >= first - 1 && block <= last + 1
}
