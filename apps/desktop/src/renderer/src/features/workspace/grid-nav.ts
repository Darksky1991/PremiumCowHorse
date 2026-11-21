/** 网格项的位置（取自 getBoundingClientRect） */
export interface ItemRect {
  left: number
  top: number
  width: number
}

/** 判定为同一行的纵向容差（px） */
const ROW_TOLERANCE = 2

/**
 * 卡片网格的方向键移动（工作区一览）：返回下一个获得焦点的项的下标；按键无关时返回 null。
 * - ←→：按阅读顺序前后一项（行末 → 下一行行首），两端不动。
 * - ↑↓：相邻行中水平中心最近的一项；没有相邻行时不动。
 * - Home / End：第一项 / 最后一项。
 * - 当前没有焦点项（index < 0）时，任何方向键都落到第一项。
 * 列数随窗口宽度变化，所以按实际位置计算，而不是按固定列数。
 */
export function gridNeighbor(rects: ItemRect[], index: number, key: string): number | null {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return null
  const last = rects.length - 1
  if (last < 0) return null
  if (index < 0 || index > last) return 0
  if (key === 'Home') return 0
  if (key === 'End') return last
  if (key === 'ArrowLeft') return Math.max(index - 1, 0)
  if (key === 'ArrowRight') return Math.min(index + 1, last)

  const current = rects[index]!
  const down = key === 'ArrowDown'
  const rowTops = rects
    .map((r) => r.top)
    .filter((top) => (down ? top > current.top + ROW_TOLERANCE : top < current.top - ROW_TOLERANCE))
  if (rowTops.length === 0) return index
  const rowTop = down ? Math.min(...rowTops) : Math.max(...rowTops)
  const centre = (r: ItemRect): number => r.left + r.width / 2
  let best = index
  let bestDistance = Infinity
  rects.forEach((r, i) => {
    if (Math.abs(r.top - rowTop) > ROW_TOLERANCE) return
    const distance = Math.abs(centre(r) - centre(current))
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  })
  return best
}
