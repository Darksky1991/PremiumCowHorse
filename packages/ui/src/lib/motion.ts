/**
 * 动效令牌（M5 设计稿 5 节）。所有动效的时长、缓动、弹簧都从这里取；
 * 渲染端不直接依赖 motion，统一从 `@pch/ui/lib/motion` 引入（依赖只在 packages/ui 声明一处）。
 */
export { motion, AnimatePresence, MotionConfig, useReducedMotion } from 'motion/react'
export type { Transition } from 'motion/react'

/** 时长（秒），上限 0.3 */
export const duration = { instant: 0, fast: 0.12, base: 0.2, slow: 0.28 } as const

/** 缓动：屏幕内状态变化 / 进入（减速）/ 退出（加速，时长取进入的 0.6–0.7 倍） */
export const ease = {
  standard: [0.2, 0, 0, 1],
  enter: [0.05, 0.7, 0.1, 1],
  exit: [0.3, 0, 0.8, 0.15]
} as const satisfies Record<string, readonly [number, number, number, number]>

/** 弹簧：ring = 圆环旋转；snappy = 列表重排 / 布局变化；emphasized 仅用于「一个时刻」 */
export const spring = {
  ring: { type: 'spring', visualDuration: 0.26, bounce: 0 },
  snappy: { type: 'spring', visualDuration: 0.18, bounce: 0 },
  emphasized: { type: 'spring', visualDuration: 0.3, bounce: 0.1 }
} as const

/** 「減少動効」设置 → MotionConfig 的 reducedMotion 取值 */
export function reducedMotionMode(setting: 'system' | 'on' | 'off'): 'user' | 'always' | 'never' {
  switch (setting) {
    case 'system':
      return 'user'
    case 'on':
      return 'always'
    case 'off':
      return 'never'
  }
}
