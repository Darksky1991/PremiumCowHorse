import { useEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import { maxTop, thumb, topFromThumb, type Pager } from '@pch/text-engine'

export interface ScrollbarProps {
  pager: Pager
  /** 被滚动的元素（aria-controls） */
  controls: string
  label: string
  /** 拖动拇指：跳到该行 */
  onTop(top: number): void
  /** 点击轨道（拇指以外）：向上 / 向下翻一页 */
  onPage(direction: -1 | 1): void
}

/**
 * 自绘的纵向滚动条（设计 3.5）：拇指按 pager-model 缩放（百万行以上也不小于最小高度）；
 * 拖动拇指按位置换算行号，点击轨道翻页。全部显示得下时不显示拇指
 */
export function Scrollbar({ pager, controls, label, onTop, onPage }: ScrollbarProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const [trackPx, setTrackPx] = useState(0)
  const drag = useRef<{ pointerId: number; startY: number; startOffset: number } | null>(null)

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setTrackPx(entry.contentRect.height)
    })
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  const last = maxTop(pager)
  const { offsetPx, sizePx } = thumb(pager, trackPx)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || last === 0) return
    e.preventDefault()
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    if (y >= offsetPx && y <= offsetPx + sizePx) {
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { pointerId: e.pointerId, startY: e.clientY, startOffset: offsetPx }
    } else {
      onPage(y < offsetPx ? -1 : 1)
    }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    onTop(topFromThumb(pager, trackPx, d.startOffset + e.clientY - d.startY))
  }
  const endDrag = (e: PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null
  }

  return (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-label={label}
      aria-controls={controls}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={Math.min(pager.top, last)}
      className="relative w-3 shrink-0 touch-none border-l bg-muted/30 select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {last > 0 ? (
        <div
          data-thumb
          className="absolute inset-x-0.5 rounded-full bg-muted-foreground/40 hover:bg-muted-foreground/60"
          style={{ top: offsetPx, height: sizePx }}
        />
      ) : null}
    </div>
  )
}
