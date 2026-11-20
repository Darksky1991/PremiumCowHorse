/**
 * 行索引变化时块缓存要做的事（use-visible-lines.ts 使用；纯函数）。
 * 此前索引已完成时，原来的最后一行可能没有换行、被追加的内容延长：索引有任何变化就从它起丢弃。
 * 只看行数与 complete 不够——追加的内容里没有换行时两者前后相同（中间状态被 React 批处理掉时），
 * 只有 indexedTo 变了，末行会一直停在旧内容
 */

/** 行索引的状态（DocumentInfo.index） */
export interface IndexState {
  lines: number
  complete: boolean
  indexedTo: number
}

export interface IndexChange {
  /** 从这一行起丢弃已缓存的行；不需要时为 null */
  dropFrom: number | null
  /** 行数或完成状态改变：失败的块可以再试（只有 indexedTo 变化时不重试，避免随进度反复请求） */
  retry: boolean
}

export function indexChange(prev: IndexState, next: IndexState): IndexChange {
  const retry = prev.lines !== next.lines || prev.complete !== next.complete
  const changed = retry || prev.indexedTo !== next.indexedTo
  return {
    dropFrom: changed && prev.complete && prev.lines > 0 ? prev.lines - 1 : null,
    retry
  }
}
