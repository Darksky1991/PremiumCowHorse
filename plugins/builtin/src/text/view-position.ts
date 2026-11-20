import { clampTop, maxTop } from '@pch/text-engine'

/**
 * 视口位置与「跟随末尾」（设计 3.5）：跟随时视口始终在末尾（行数增加也保持）；
 * 用户向上移动即关闭；日志类移动到末尾时自动开启。纯函数。
 */
export interface Position {
  /** 不跟随时的视口第一行（跟随时不使用） */
  top: number
  follow: boolean
}

export interface Frame {
  visible: number
  total: number
  logLike: boolean
}

/** 移动：相对行数、跳到某行（滚动条）、开头、末尾 */
export type Move = { by: number } | { to: number } | 'start' | 'end'

/** 实际显示的第一行 */
export function effectiveTop(pos: Position, frame: Frame): number {
  const pager = { top: pos.top, visible: frame.visible, total: frame.total }
  return pos.follow ? maxTop(pager) : clampTop(pager)
}

export function move(pos: Position, frame: Frame, m: Move): Position {
  if (typeof m === 'object' && 'by' in m && m.by === 0) return pos
  const pager = { top: 0, visible: frame.visible, total: frame.total }
  const last = maxTop(pager)
  if (m === 'start') return { top: 0, follow: false }
  if (m === 'end') return { top: last, follow: frame.logLike || pos.follow }
  const current = effectiveTop(pos, frame)
  const top = clampTop({ ...pager, top: 'by' in m ? current + m.by : m.to })
  if (top < current) return { top, follow: false }
  const atEnd = top === last
  return { top, follow: atEnd && (pos.follow || frame.logLike) }
}

/** 打开 / 关闭跟随：打开时到末尾，关闭时停在当前显示的位置 */
export function setFollow(pos: Position, frame: Frame, follow: boolean): Position {
  return { top: effectiveTop(follow ? { ...pos, follow } : pos, frame), follow }
}

/**
 * 部分模式 →「读取全部」后的位置：部分模式的 top 是窗口内的行号，全量索引中的绝对行号 = 窗口起点所在行 + top。
 * 开头窗口起点在第 0 行，不变；末尾窗口起点所在的行要等全量索引扫到那里才知道（且接口不提供偏移 → 行号），
 * 无法精确换算：跳到末尾（跟随；末尾窗口只用于日志类）。跟随中照旧
 */
export function afterReadAll(pos: Position, window: { start: number }): Position {
  if (pos.follow || window.start === 0) return pos
  return { top: pos.top, follow: true }
}
