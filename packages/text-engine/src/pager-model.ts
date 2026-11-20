// 分页视图的视口数学（设计 3.5 节）：行高固定，视口从第 top 行起显示 visible 行；
// 自绘滚动条按比例缩放，拇指不小于 minThumbPx（百万行以上也能拖动）。纯函数，不依赖 DOM。

/** top：视口第一行（从 0 起）；visible：视口能完整显示的行数；total：文档的行数 */
export interface Pager {
  top: number
  visible: number
  total: number
}

/** 拇指的最小高度（px） */
export const MIN_THUMB_PX = 20

/** 最后一行贴在视口底部时的 top；全部显示得下时为 0。visible 至少按 1 行算 */
export function maxTop(p: Pager): number {
  return Math.max(0, p.total - Math.max(1, p.visible))
}

/** 限制在 [0, maxTop] 内的整数 top */
export function clampTop(p: Pager): number {
  return Math.min(Math.max(0, Math.round(p.top)), maxTop(p))
}

/** 移动 delta 行（负数向上），结果限制在范围内 */
export function scrollLines(p: Pager, delta: number): Pager {
  return { ...p, top: clampTop({ ...p, top: clampTop(p) + delta }) }
}

/**
 * 拇指在轨道中的位置与大小（px）：大小与 visible / total 成比例（不小于 minThumbPx、不超过轨道），
 * 位置把 [0, maxTop] 线性映射到 [0, 轨道 - 拇指]。全部显示得下时拇指占满轨道
 */
export function thumb(
  p: Pager,
  trackPx: number,
  minThumbPx = MIN_THUMB_PX
): { offsetPx: number; sizePx: number } {
  const track = Math.max(0, trackPx)
  const last = maxTop(p)
  if (last === 0) return { offsetPx: 0, sizePx: track }
  const sizePx = thumbSize(p, track, minThumbPx)
  const room = track - sizePx
  return { offsetPx: room <= 0 ? 0 : (room * clampTop(p)) / last, sizePx }
}

/** thumb 的逆映射：拇指位于 offsetPx 时的 top（四舍五入到整数行，限制在范围内） */
export function topFromThumb(
  p: Pager,
  trackPx: number,
  offsetPx: number,
  minThumbPx = MIN_THUMB_PX
): number {
  const last = maxTop(p)
  const track = Math.max(0, trackPx)
  const room = track - thumbSize(p, track, minThumbPx)
  if (last === 0 || room <= 0) return 0
  const ratio = Math.min(Math.max(offsetPx / room, 0), 1)
  return Math.round(ratio * last)
}

function thumbSize(p: Pager, track: number, minThumbPx: number): number {
  const visible = Math.max(1, p.visible)
  const proportional = p.total > 0 ? (track * visible) / p.total : track
  return Math.min(track, Math.max(minThumbPx, proportional))
}
