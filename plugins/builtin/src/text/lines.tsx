import type { JSX, Ref } from 'react'
import type { CachedLine } from './block-cache'
import { LINE_HEIGHT } from './layout'

export interface LinesProps {
  id: string
  /** 第一行的行号（从 0 起） */
  top: number
  /** 还没读到的行为 null（占位行） */
  lines: ReadonlyArray<CachedLine | null>
  /** 截断行末尾的提示文字 */
  truncatedMark: string
  ref?: Ref<HTMLDivElement>
}

/**
 * 可见行：每行固定高度、不换行（横向滚动由本元素负责，纵向由视图分页）；
 * 占位行显示为淡色的「…」。可见范围内可用浏览器原生的选择与复制
 */
export function Lines({ id, top, lines, truncatedMark, ref }: LinesProps): JSX.Element {
  return (
    <div
      ref={ref}
      id={id}
      className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden font-mono text-[13px] select-text"
    >
      <div className="w-max min-w-full px-3">
        {lines.map((line, i) => (
          <div
            key={top + i}
            data-line={top + i + 1}
            className="whitespace-pre"
            style={{ height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px` }}
          >
            {line === null ? (
              <span aria-hidden className="text-muted-foreground/60" data-placeholder>
                …
              </span>
            ) : (
              <>
                {line.text}
                {line.truncated ? (
                  <span className="text-muted-foreground italic select-none" data-truncated>
                    {truncatedMark}
                  </span>
                ) : null}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
