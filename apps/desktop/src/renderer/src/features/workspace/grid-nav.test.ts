import { describe, expect, it } from 'vitest'
import { gridNeighbor, type ItemRect } from './grid-nav'

/** 3 列网格：第 1 行 0..2，第 2 行 3..4（每格宽 100、高 50，间距 10） */
const rects: ItemRect[] = [
  { left: 0, top: 0, width: 100 },
  { left: 110, top: 0, width: 100 },
  { left: 220, top: 0, width: 100 },
  { left: 0, top: 60, width: 100 },
  { left: 110, top: 60, width: 100 }
]

describe('gridNeighbor', () => {
  it('moves left / right by one in reading order and stops at the ends', () => {
    expect(gridNeighbor(rects, 1, 'ArrowRight')).toBe(2)
    expect(gridNeighbor(rects, 2, 'ArrowRight')).toBe(3)
    expect(gridNeighbor(rects, 4, 'ArrowRight')).toBe(4)
    expect(gridNeighbor(rects, 3, 'ArrowLeft')).toBe(2)
    expect(gridNeighbor(rects, 0, 'ArrowLeft')).toBe(0)
  })

  it('moves up / down to the nearest item by horizontal centre in the adjacent row', () => {
    expect(gridNeighbor(rects, 1, 'ArrowDown')).toBe(4)
    expect(gridNeighbor(rects, 4, 'ArrowUp')).toBe(1)
    // 下一行在这一列没有项：取水平中心最近的
    expect(gridNeighbor(rects, 2, 'ArrowDown')).toBe(4)
    // 最后一行 / 第一行：不动
    expect(gridNeighbor(rects, 3, 'ArrowDown')).toBe(3)
    expect(gridNeighbor(rects, 0, 'ArrowUp')).toBe(0)
  })

  it('jumps to the first / last item with Home / End', () => {
    expect(gridNeighbor(rects, 3, 'Home')).toBe(0)
    expect(gridNeighbor(rects, 1, 'End')).toBe(4)
  })

  it('starts from the first item when nothing is focused and ignores other keys', () => {
    expect(gridNeighbor(rects, -1, 'ArrowRight')).toBe(0)
    expect(gridNeighbor(rects, -1, 'ArrowDown')).toBe(0)
    expect(gridNeighbor(rects, 1, 'a')).toBeNull()
    expect(gridNeighbor([], -1, 'ArrowDown')).toBeNull()
  })
})
