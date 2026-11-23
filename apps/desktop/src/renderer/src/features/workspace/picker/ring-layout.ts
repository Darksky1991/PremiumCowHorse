/**
 * 圆环的几何（设计稿 1.1 / 1.5，原型 workspace-picker.html 的 layout()）：
 * 任何时候只显示正面 ±2 共 5 张，首尾相接；位置按卡片宽度算出 3D 平移与倾斜。
 */

/** 卡片尺寸（设计稿 1.3：简要 204×176、详细 244×304）与圆环舞台的高度 */
export const CARD_SIZE = {
  compact: { width: 204, height: 176, stage: 286 },
  detail: { width: 244, height: 304, stage: 404 }
} as const

export type SlotOffset = -2 | -1 | 0 | 1 | 2

export interface RingSlot {
  /** 卡片在当前（筛选后）顺序中的下标 */
  index: number
  offset: SlotOffset
}

/** 填位的先后：正面、右、左、右 2、左 2（不足 5 张时右侧先满，不重复） */
const FILL: readonly SlotOffset[] = [0, 1, -1, 2, -2]

/** 正面 ±2 的槽位，按 offset 升序；count < 5 时每张只出现一次 */
export function ringSlots(count: number, front: number): RingSlot[] {
  if (count <= 0) return []
  return FILL.slice(0, Math.min(count, FILL.length))
    .map((offset) => ({ index: mod(front + offset, count), offset }))
    .sort((a, b) => a.offset - b.offset)
}

/** 下标 i 相对正面 front 的环形偏移（取较短的方向）；n ≤ 1 时为 i - front */
export function wrapOffset(i: number, front: number, n: number): number {
  let d = i - front
  if (n > 1) {
    d = mod(d, n)
    if (d > n / 2) d -= n
  }
  return d
}

/** 相邻两张之间的角度（度）、卡片自身倾斜的比例、半径与卡宽之比（与原型一致） */
const STEP_DEG = 28
const TILT = 0.6
const RADIUS_PER_WIDTH = 2.15
/** 打开时「展开」的起点：角度压缩到 0.45 倍，侧面卡片透明 */
const REVEAL_STEP = 0.45
/** 侧面卡片的变暗程度（|offset| = 0 / 1 / 2；圈外同 2） */
const DIM = [0, 0.28, 0.62] as const

export interface SlotPose {
  x: number
  z: number
  rotateY: number
  opacity: number
  /** 叠在卡面上的遮罩不透明度（侧面稍暗，正面明确） */
  dim: number
  zIndex: number
}

/**
 * 槽位的 3D 姿态。offset 可以是 ±3（刚转出 / 将转入圆环的卡片：位置在圈外一格、透明）。
 * reveal：选择器刚打开时的起点（角度压缩、只有正面可见），随后以 spring.emphasized 展开
 */
export function slotPose(
  offset: number,
  cardWidth: number,
  opts: { reveal?: boolean } = {}
): SlotPose {
  const ad = Math.abs(offset)
  const clamped = Math.sign(offset) * Math.min(ad, 3)
  const angle = clamped * STEP_DEG * (opts.reveal === true ? REVEAL_STEP : 1)
  const rad = (angle * Math.PI) / 180
  const r = cardWidth * RADIUS_PER_WIDTH
  const shown = ad <= 2
  return {
    x: round(Math.sin(rad) * r),
    z: round((Math.cos(rad) - 1) * r),
    rotateY: round(angle * TILT),
    opacity: opts.reveal === true ? (ad === 0 ? 1 : 0) : shown ? 1 : 0,
    dim: DIM[Math.min(ad, 2)] ?? DIM[2],
    zIndex: 10 - Math.min(ad, 3)
  }
}

/** 卡片的渲染键状态：offset 为 null 表示已离开圆环 */
export interface CardTrack {
  offset: number | null
  gen: number
}

/**
 * 算出每张卡片的渲染键代数（键 = `${id}#${gen}`）：相邻移动（|Δoffset| ≤ 1）保持同一个键，
 * 由 motion 连续转过去；绕环跳转（不足 6 张时最左的卡转到最右）或离开后再进入则换新键——
 * 旧元素朝原来的一侧淡出，新元素从另一侧淡入，不会横穿正面（原型的 nojump 处理）
 */
export function trackCards(
  prev: ReadonlyMap<string, CardTrack>,
  shown: readonly { id: string; offset: number }[]
): Map<string, CardTrack> {
  const next = new Map<string, CardTrack>()
  for (const [id, track] of prev) next.set(id, { offset: null, gen: track.gen })
  for (const { id, offset } of shown) {
    const before = prev.get(id)
    if (before === undefined) next.set(id, { offset, gen: 0 })
    else if (before.offset === null || Math.abs(offset - before.offset) > 1.5) {
      next.set(id, { offset, gen: before.gen + 1 })
    } else next.set(id, { offset, gen: before.gen })
  }
  return next
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/** 保留 1 位小数（与原型一致，也避免 -0 / 浮点尾数造成无意义的样式变化） */
function round(v: number): number {
  const r = Math.round(v * 10) / 10
  return r === 0 ? 0 : r
}
