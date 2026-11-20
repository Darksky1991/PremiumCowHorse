import type { JSX } from 'react'
import { LINE_HEIGHT } from './layout'

export interface GutterProps {
  /** 第一行的行号（从 0 起） */
  top: number
  /** 显示的行数 */
  count: number
  /** 文档的行数（决定宽度：按位数） */
  total: number
}

/** 行号栏：从 top + 1 起，宽度按总行数的位数；不参与文本选择 */
export function Gutter({ top, count, total }: GutterProps): JSX.Element {
  const digits = String(Math.max(total, 1)).length
  return (
    <div
      aria-hidden
      className="shrink-0 overflow-hidden border-r bg-muted/40 pr-2 pl-3 text-right font-mono text-[13px] text-muted-foreground tabular-nums select-none"
      style={{ width: `calc(${digits}ch + 1.25rem)` }}
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={top + i}
          data-gutter={top + i + 1}
          style={{ height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px` }}
        >
          {top + i + 1}
        </div>
      ))}
    </div>
  )
}
