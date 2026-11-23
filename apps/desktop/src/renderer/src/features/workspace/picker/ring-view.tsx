import {
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
  type ReactNode,
  type WheelEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import { AnimatePresence, duration, ease, motion, spring } from '@pch/ui/lib/motion'
import { CARD_SIZE, ringSlots, slotPose, trackCards, type CardTrack } from './ring-layout'
import { PickerCard } from './picker-card'
import { PICKER_FORM_ATTR, PickerNewCard } from './picker-edit-card'
import {
  NEW_CARD_ID,
  act,
  cardDomId,
  wheelStep,
  type PickerAction,
  type PickerRow,
  type PickerState,
  type WheelState
} from './use-picker-state'

/** 位置指示：不超过这个数时显示圆点，更多时显示「5 / 20」与提示（设计稿 1.1） */
const DOTS_MAX = 12

export interface RingViewProps {
  listId: string
  state: PickerState
  rows: ReadonlyMap<string, PickerRow>
  currentId: string | undefined
  detail: boolean
  /** 正在播放按压反馈的卡片（切换前 140ms） */
  pressing: string | null
  reduced: boolean
  now: number
  dispatch: (action: PickerAction) => void
  /** 编辑模式的正面卡片（表单 + 删除确认）；返回 null 时用普通卡面 */
  renderFront?: (row: PickerRow) => ReactNode
  /** 正在删除的工作区：离开圆环时收缩淡出 */
  deletingId?: string | null
}

/** 表单区域内的鼠标操作交给表单本身（聚焦输入框、点按钮），圆环不处理 */
const inForm = (e: MouseEvent): boolean =>
  (e.target as HTMLElement).closest(`[${PICKER_FORM_ATTR}]`) !== null

/**
 * 3D 圆环（设计稿 1.5 / 1.7，原型 layout()）：只渲染正面 ±2 共 5 张；转动由 motion 的 spring.ring 完成，
 * 选择对象只看状态（order[front]），与动画进行到哪里无关。
 * - 3D 命中测试：卡片可能位于 z<0，会被 z=0 的容器挡住点击 → 容器 pointer-events: none、卡片 auto（1.5 第 8 条）。
 * - 打开时（第一次渲染）卡片从压缩的角度以 spring.emphasized 展开；之后进出圆环的卡片从圈外一格淡入 / 淡出。
 * - 绕环跳转（不足 6 张）换新键，旧卡朝原侧淡出、新卡从另一侧淡入，不横穿正面（trackCards）。
 * - 减少动效时（MotionConfig）位移瞬间完成，只保留透明度。
 */
export function RingView({
  listId,
  state,
  rows,
  currentId,
  detail,
  pressing,
  reduced,
  now,
  dispatch,
  renderFront,
  deletingId = null
}: RingViewProps): JSX.Element {
  const { t } = useTranslation('workspace')
  const editing = state.mode === 'edit'
  // 编辑模式用详细尺寸（表单放得下），卡面内容仍按「詳細」开关
  const size = detail || editing ? CARD_SIZE.detail : CARD_SIZE.compact
  const n = state.order.length
  const shown = ringSlots(n, state.front).map((s) => ({
    id: state.order[s.index]!,
    offset: s.offset
  }))

  // 渲染键（id#代数）：order / front 变化时在渲染中更新（React 的「随 props 调整 state」写法）
  const [tracked, setTracked] = useState(() => ({
    order: state.order,
    front: state.front,
    cards: trackCards(new Map(), shown),
    version: 0
  }))
  let { cards, version } = tracked
  if (tracked.order !== state.order || tracked.front !== state.front) {
    cards = trackCards(tracked.cards, shown)
    version = tracked.version + 1
    setTracked({ order: state.order, front: state.front, cards, version })
  }
  // 点击时按最新状态判断（退场中的卡片保留的是旧 props）
  const latest = useRef(state)
  useLayoutEffect(() => {
    latest.current = state
  })
  const keyOf = (id: string): string =>
    `${id}#${(cards.get(id) as CardTrack | undefined)?.gen ?? 0}`
  const reveal = version === 0

  // 滚轮只转动：累积 50px 转一格（行模式按 40px/行换算）
  const wheel = useRef<WheelState>({ acc: 0, last: -Infinity, at: -Infinity })
  const onWheel = (e: WheelEvent): void => {
    const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    const r = wheelStep(wheel.current, e.deltaMode === 1 ? raw * 40 : raw, performance.now())
    wheel.current = r.state
    if (r.delta !== 0) dispatch(act.rotate(r.delta, performance.now()))
  }

  const move = reduced ? { duration: 0 } : reveal ? spring.emphasized : spring.ring
  // 减少动效：只保留 120ms 的透明度过渡（设计稿 1.9）
  const fade = { duration: reduced ? duration.fast : duration.base, ease: ease.standard }
  const resize = reduced ? { duration: 0 } : { duration: duration.slow, ease: ease.standard }
  const frame = {
    width: size.width,
    height: size.height,
    marginLeft: -size.width / 2,
    marginTop: -size.height / 2
  }

  return (
    <div
      className="relative overflow-hidden"
      style={{ height: size.stage, perspective: '1150px', perspectiveOrigin: '50% 40%' }}
      onWheel={onWheel}
    >
      {/* 地面：唯一的装饰，一层很淡的椭圆让 3D 有落脚点 */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[26px] left-1/2 h-[46px] w-[70%] -translate-x-1/2 bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--foreground)_9%,transparent),transparent)]"
      />
      <div
        id={listId}
        role="listbox"
        aria-orientation="horizontal"
        aria-label={t('listLabel')}
        className="pointer-events-none absolute inset-0 [transform-style:preserve-3d]"
      >
        <AnimatePresence>
          {shown.map(({ id, offset }) => {
            const row = rows.get(id)
            const isNew = id === NEW_CARD_ID
            if (row === undefined && !isNew) return null
            const pose = slotPose(offset, size.width)
            const start = reveal
              ? slotPose(offset, size.width, { reveal: true })
              : { ...slotPose(offset === 0 ? 0 : Math.sign(offset) * 3, size.width), opacity: 0 }
            const leave = {
              ...slotPose(offset === 0 ? 0 : Math.sign(offset) * 3, size.width),
              opacity: 0,
              // 删除的卡片在原位收缩消失（设计稿 1.4）
              scale: id === deletingId ? 0.9 : 1
            }
            const current = id === currentId
            const front = offset === 0
            const custom = front && row !== undefined ? renderFront?.(row) : undefined
            return (
              <motion.div
                key={keyOf(id)}
                id={cardDomId(id)}
                role="option"
                aria-selected={offset === 0}
                aria-hidden={false}
                aria-label={row === undefined ? t('newCardLabel') : row.label}
                data-workspace-card={id}
                data-offset={offset}
                className="pointer-events-auto absolute top-[46%] left-1/2 cursor-default [transform-style:preserve-3d]"
                style={{ zIndex: pose.zIndex }}
                initial={{
                  ...frame,
                  x: start.x,
                  z: start.z,
                  rotateY: start.rotateY,
                  opacity: start.opacity
                }}
                animate={{
                  ...frame,
                  x: pose.x,
                  z: pose.z,
                  rotateY: pose.rotateY,
                  opacity: pose.opacity,
                  scale: pressing === id ? [1, 0.975, 1] : 1
                }}
                exit={{
                  x: leave.x,
                  z: leave.z,
                  rotateY: leave.rotateY,
                  opacity: 0,
                  scale: leave.scale,
                  pointerEvents: 'none'
                }}
                transition={{
                  default: move,
                  opacity: fade,
                  scale: { duration: 0.14, ease: ease.standard },
                  width: resize,
                  height: resize,
                  marginLeft: resize,
                  marginTop: resize
                }}
                // 不从筛选框夺走焦点：键盘操作始终在筛选框（编辑表单除外）
                onMouseDown={(e) => {
                  if (!inForm(e)) e.preventDefault()
                }}
                onClick={(e) => {
                  if (inForm(e)) return
                  // 退场中的卡片不响应（它已不在当前槽位中）
                  const s = latest.current
                  const i = s.order.indexOf(id)
                  if (ringSlots(s.order.length, s.front).some((slot) => slot.index === i)) {
                    dispatch(act.clickCard(i, performance.now()))
                  }
                }}
              >
                {row === undefined ? (
                  <PickerNewCard front={front} />
                ) : custom !== undefined && custom !== null ? (
                  custom
                ) : (
                  <PickerCard
                    workspace={row.workspace}
                    name={row.name}
                    summary={row.summary}
                    number={state.query === '' && !editing ? row.number : null}
                    current={current}
                    front={front}
                    detail={detail}
                    query={state.query}
                    now={now}
                  />
                )}
                {/* 侧面卡片稍暗，正面明确 */}
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-xl bg-popover"
                  initial={false}
                  animate={{ opacity: pose.dim }}
                  transition={fade}
                />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
      {n === 0 ? (
        <div className="absolute inset-0 grid place-content-center gap-2.5 px-6 text-center text-muted-foreground">
          <strong className="text-sm font-semibold text-foreground">
            {t('emptyTitle', { query: state.query })}
          </strong>
          <span>{t('emptyHint')}</span>
        </div>
      ) : (
        <Indicator state={state} currentId={currentId} rows={rows} dispatch={dispatch} />
      )}
    </div>
  )
}

/** 位置指示：≤ 12 个为圆点（可点击转到该位置），更多为「5 / 20」与提示 */
function Indicator({
  state,
  currentId,
  rows,
  dispatch
}: Pick<RingViewProps, 'state' | 'currentId' | 'rows' | 'dispatch'>): JSX.Element {
  const { t } = useTranslation('workspace')
  const n = state.order.length
  return (
    <div
      data-slot="picker-indicator"
      className="absolute inset-x-0 bottom-2.5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground tabular-nums"
    >
      {n <= DOTS_MAX ? (
        state.order.map((id, i) => (
          <button
            key={id}
            type="button"
            tabIndex={-1}
            aria-hidden
            title={id === NEW_CARD_ID ? t('newCard') : rows.get(id)?.name}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => dispatch(act.focusIndex(i, performance.now()))}
            className={cn(
              'size-[7px] rounded-full bg-border transition-[background-color,scale] duration-120',
              i === state.front && 'scale-130 bg-foreground',
              id === currentId && 'shadow-[0_0_0_1.5px_var(--primary)]'
            )}
          />
        ))
      ) : (
        <>
          <span>{t('position', { index: state.front + 1, count: n })}</span>
          {state.query === '' ? <span className="ml-2.5">{t('manyTip')}</span> : null}
        </>
      )}
    </div>
  )
}
