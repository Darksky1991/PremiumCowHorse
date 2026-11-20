import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { FileXIcon } from 'lucide-react'
import type { PreviewProps } from '@pch/plugin-sdk'
import { Spinner } from '@pch/ui/components/spinner'
import { Gutter } from './gutter'
import { LINE_HEIGHT } from './layout'
import { Lines } from './lines'
import { hasExtension, isLogLike } from './log-like'
import { Scrollbar } from './scrollbar'
import { StatusBar } from './status-bar'
import { Toolbar } from './toolbar'
import { useDocument } from './use-document'
import { useVisibleLines } from './use-visible-lines'
import {
  afterReadAll,
  effectiveTop,
  move,
  setFollow,
  type Frame,
  type Move,
  type Position
} from './view-position'
import type { TextViewState } from './view-state'

/** 视口停止移动后多久把位置存入 viewState（避免每次滚动都写 store） */
const SAVE_DELAY = 150
/** ←→ 一次横向滚动的距离（px） */
const HORIZONTAL_STEP = 40

/**
 * 文本 / 日志查看器（设计 3.5）：自绘分页（固定行高，只渲染可见行，滚动条自绘），
 * 不用浏览器原生滚动高度（百万行以上也不受元素高度上限影响）。
 * 日志类（log-like.ts）打开在末尾并跟随；滚轮 / 拖动 / PageUp / PageDown / Ctrl+Home / Ctrl+End / ↑↓ 移动；
 * 刷新（地址栏 / F5、自动检查）由宿主负责，这里只处理 onChanged 带来的变化（use-document.ts）
 */
export default function TextView({
  resource,
  host,
  viewState,
  onViewStateChange
}: PreviewProps<TextViewState>): JSX.Element {
  const { t } = host.i18n
  const linesId = useId()
  const regionRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)
  const logLike = isLogLike(
    resource.name,
    resource.textLike === true && !hasExtension(resource.name)
  )
  const doc = useDocument(host, resource.uri, {
    at: logLike ? 'end' : 'start',
    ...(viewState?.encoding !== undefined ? { encoding: viewState.encoding } : {})
  })
  const info = doc.info

  const [pos, setPos] = useState<Position>(() =>
    viewState ? { top: viewState.top, follow: viewState.follow } : { top: 0, follow: logLike }
  )
  const [height, setHeight] = useState(0)
  const visible = Math.max(1, Math.floor(height / LINE_HEIGHT))
  const total = info?.index.lines ?? 0
  const frame: Frame = { visible, total, logLike }
  const top = effectiveTop(pos, frame)
  const { lines, error: readError } = useVisibleLines(
    host,
    info,
    doc.epoch,
    top,
    visible + 1,
    doc.awaitingInfo
  )

  // 键盘 / 滚轮 / 滚动条的移动按最新的行数与可见行数计算
  const frameRef = useRef(frame)
  useEffect(() => {
    frameRef.current = frame
  })
  const go = useCallback((m: Move) => setPos((p) => move(p, frameRef.current, m)), [])

  // 可见行数 = 文本区（不含横向滚动条）的高度 / 行高
  const hasLines = info !== null
  useEffect(() => {
    const el = linesRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasLines])

  // 滚轮：纵向按行分页（需要 preventDefault，React 的 onWheel 是 passive）；Shift / 横向交给原生的横向滚动
  const wheelRest = useRef(0)
  useEffect(() => {
    const el = regionRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.shiftKey || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 1
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? frameRef.current.visible
            : 1 / LINE_HEIGHT
      const lines = wheelRest.current + e.deltaY * unit
      const whole = Math.trunc(lines)
      wheelRest.current = lines - whole
      if (whole !== 0) go({ by: whole })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [go, hasLines])

  // 位置与手动编码存入 viewState（停止移动后）；卸载时防抖中的状态立即保存（宿主按位置写入：
  // 已导航离开时写入刚离开的历史项，后退时恢复）
  const manualEncoding = info?.encoding.manual ? info.encoding.label : undefined
  const savedTop = pos.follow ? top : pos.top
  const lastSaved = useRef(viewState)
  const pendingSave = useRef<TextViewState | null>(null)
  // 宿主每次渲染传入新的回调：经 ref 取最新的，避免计时器被反复重置
  const saveRef = useRef(onViewStateChange)
  useEffect(() => {
    saveRef.current = onViewStateChange
  }, [onViewStateChange])
  useEffect(() => {
    const next: TextViewState = {
      top: savedTop,
      follow: pos.follow,
      ...(manualEncoding !== undefined ? { encoding: manualEncoding } : {})
    }
    const prev = lastSaved.current
    if (prev?.top === next.top && prev.follow === next.follow && prev.encoding === next.encoding) {
      pendingSave.current = null
      return
    }
    pendingSave.current = next
    const timer = setTimeout(() => {
      pendingSave.current = null
      lastSaved.current = next
      saveRef.current(next)
    }, SAVE_DELAY)
    return () => clearTimeout(timer)
  }, [savedTop, pos.follow, manualEncoding])
  useEffect(
    () => () => {
      const pending = pendingSave.current
      if (pending === null) return
      pendingSave.current = null
      lastSaved.current = pending
      saveRef.current(pending)
    },
    []
  )

  // 在标签内导航后（旧视图连同焦点一起被移除）焦点回到文本区，键盘操作可以继续
  useEffect(() => {
    const active = document.activeElement
    if (active === null || active === document.body) regionRef.current?.focus()
  }, [hasLines])

  const page = Math.max(1, visible - 1)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget || e.altKey || e.metaKey) return
    const ctrl = e.ctrlKey
    let m: Move | null = null
    if (e.key === 'ArrowDown' && !ctrl) m = { by: 1 }
    else if (e.key === 'ArrowUp' && !ctrl) m = { by: -1 }
    else if (e.key === 'PageDown' && !ctrl) m = { by: page }
    else if (e.key === 'PageUp' && !ctrl) m = { by: -page }
    else if (e.key === 'Home' && ctrl) m = 'start'
    else if (e.key === 'End' && ctrl) m = 'end'
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !ctrl) {
      e.preventDefault()
      linesRef.current?.scrollBy({
        left: e.key === 'ArrowLeft' ? -HORIZONTAL_STEP : HORIZONTAL_STEP
      })
      return
    }
    if (m === null) return
    e.preventDefault()
    go(m)
  }

  if (doc.error !== null) {
    return (
      <Centered>
        <p role="alert" className="text-sm text-muted-foreground">
          {doc.error}
        </p>
      </Centered>
    )
  }
  if (info === null) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    )
  }

  const empty = info.index.complete && total === 0
  const shown = lines.filter((l) => l !== null)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar
        host={host}
        follow={pos.follow}
        onStart={() => go('start')}
        onEnd={() => go('end')}
        onFollow={(on) => setPos((p) => setFollow(p, frameRef.current, on))}
      />
      {doc.missing ? (
        <p
          role="status"
          className="flex shrink-0 items-center gap-2 border-b bg-muted/50 px-3 py-1.5 text-sm"
        >
          <FileXIcon aria-hidden className="size-4 text-muted-foreground" />
          {t('missing')}
        </p>
      ) : null}
      <div
        ref={regionRef}
        role="region"
        aria-label={t('viewLabel')}
        tabIndex={0}
        className="flex min-h-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        onKeyDown={onKeyDown}
      >
        {info.mode === 'full' ? <Gutter top={top} count={lines.length} total={total} /> : null}
        <Lines
          ref={linesRef}
          id={linesId}
          top={top}
          lines={lines}
          truncatedMark={t('lineTruncated')}
        />
        <Scrollbar
          pager={{ top, visible, total }}
          controls={linesId}
          label={t('viewLabel')}
          onTop={(to) => go({ to })}
          onPage={(direction) => go({ by: direction * page })}
        />
      </div>
      {empty ? (
        <p className="shrink-0 px-3 py-2 text-sm text-muted-foreground">{t('empty')}</p>
      ) : null}
      <StatusBar
        host={host}
        info={info}
        replaced={shown.some((l) => l.replaced)}
        truncated={shown.some((l) => l.truncated)}
        indexError={doc.indexError}
        readError={readError}
        onEncoding={doc.setEncoding}
        onReadAll={() => {
          // 部分模式的 top 是窗口内的行号：换算为全量索引中的位置（view-position.ts）
          const window = info.window
          doc.buildIndex(() => setPos((p) => afterReadAll(p, window)))
        }}
      />
    </div>
  )
}

function Centered({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex h-full items-center justify-center p-6">{children}</div>
}
