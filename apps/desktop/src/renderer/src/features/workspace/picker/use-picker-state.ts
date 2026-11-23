import { useCallback, useEffect, useRef, useState } from 'react'
import type { Workspace, WorkspaceSummary } from '@pch/shared'
import { isImeKey } from '@renderer/lib/key-context'
import { matchScore } from '@renderer/lib/text-match'

/**
 * 工作区选择器的状态（设计稿 1.4–1.8）。`pickerReducer` 是纯函数：返回新状态与要执行的副作用
 * （切换 / 关闭），组件只负责执行副作用与动画。转动动画不影响选择对象：选择总是作用于
 * 状态中的 `order[front]`，与卡片此刻画在哪里无关。
 */

/** 选择器中的一项（按 sortOrder 排列的全部未归档工作区） */
export interface PickerItem {
  id: string
  /** 显示名（默认工作区为本地化名） */
  name: string
  description: string | null
}

/** 视图用的一行：工作区、显示名、摘要、编号（sortOrder 前 9 个）与 aria-label */
export interface PickerRow {
  workspace: Workspace
  name: string
  summary: WorkspaceSummary | undefined
  number: number | null
  label: string
}

/** aria-activedescendant 指向的元素 id（圆环的卡片 / 列表的行） */
export const cardDomId = (id: string): string => `ws-picker-card-${id}`
export const rowDomId = (id: string): string => `ws-picker-row-${id}`

export interface PickerState {
  /** 全部工作区（sortOrder 顺序）：筛选与 Alt+1–9 直选的来源 */
  items: readonly PickerItem[]
  /** 当前显示的顺序（筛选后，保持原顺序）：工作区 id */
  order: string[]
  /** 正面卡片 / 选中行在 order 中的下标 */
  front: number
  query: string
  /** 正面卡片换成现在这张的时刻（performance.now()）：正面保护期从这里算 */
  frontSince: number
  /** 编辑模式（Task 13）：点击 / Enter 不切换 */
  mode: 'browse' | 'edit'
  /** 正在确认删除的工作区（Task 13：卡片翻到背面） */
  confirmDelete: string | null
}

export type PickerAction =
  | { type: 'rotate'; delta: number; now: number }
  | { type: 'step'; delta: number; now: number }
  | { type: 'jump'; to: 'first' | 'last'; now: number }
  | { type: 'focusIndex'; index: number; now: number }
  | { type: 'setQuery'; query: string; now: number }
  | { type: 'clickCard'; index: number; now: number }
  | { type: 'clickRow'; index: number; now: number }
  | { type: 'enter' }
  | { type: 'directPick'; n: number }
  | { type: 'escape' }
  | { type: 'sync'; items: readonly PickerItem[]; now: number }

export type PickerEffect = { kind: 'select'; id: string } | { kind: 'close' }

export interface PickerResult {
  state: PickerState
  effect?: PickerEffect
}

/** 卡片刚到正面的这段时间内点击无效（防止「卡片滑到光标下」被连带点中，设计稿 1.5 第 2 条） */
export const FRONT_GUARD_MS = 250

/** 动作构造器 */
export const act = {
  /** 环形转动 delta 格（圆环的 ←/→、滚轮） */
  rotate: (delta: number, now: number): PickerAction => ({ type: 'rotate', delta, now }),
  /** 不循环地移动 delta 行（列表的 ↑/↓） */
  step: (delta: number, now: number): PickerAction => ({ type: 'step', delta, now }),
  /** Home / End */
  jump: (to: 'first' | 'last', now: number): PickerAction => ({ type: 'jump', to, now }),
  /** 转到 / 选中第 i 项（位置圆点、列表悬停以外的直接定位） */
  focusIndex: (index: number, now: number): PickerAction => ({ type: 'focusIndex', index, now }),
  setQuery: (query: string, now: number): PickerAction => ({ type: 'setQuery', query, now }),
  /** 点击圆环中的卡片：侧面 → 转到正面；正面且过了保护期 → 切换 */
  clickCard: (index: number, now: number): PickerAction => ({ type: 'clickCard', index, now }),
  /** 点击列表行：直接切换（列表不转动，没有「滑到光标下」的问题） */
  clickRow: (index: number, now: number): PickerAction => ({ type: 'clickRow', index, now }),
  enter: (): PickerAction => ({ type: 'enter' }),
  /** Alt+n：按 sortOrder 的第 n 个（1 起），与筛选无关 */
  directPick: (n: number): PickerAction => ({ type: 'directPick', n }),
  escape: (): PickerAction => ({ type: 'escape' }),
  /** 工作区列表在打开期间变化（主进程事件）：保持正面那张 */
  sync: (items: readonly PickerItem[], now: number): PickerAction => ({ type: 'sync', items, now })
} as const

/** 打开时的状态：当前工作区在正面、筛选框为空 */
export function initPickerState(
  items: readonly PickerItem[],
  currentId: string | undefined,
  now: number
): PickerState {
  const order = items.map((w) => w.id)
  return {
    items,
    order,
    front: Math.max(0, order.indexOf(currentId ?? '')),
    query: '',
    frontSince: now,
    mode: 'browse',
    confirmDelete: null
  }
}

/** 筛选：保持原顺序，返回顺序与最佳匹配（名称前缀 > 名称包含 > 说明包含；同分取靠前者）的下标 */
function filterItems(
  items: readonly PickerItem[],
  query: string
): { order: string[]; best: number } {
  if (query.trim() === '') return { order: items.map((w) => w.id), best: -1 }
  const order: string[] = []
  let best = -1
  let bestScore = -1
  for (const w of items) {
    const score = matchScore(query, w.name, w.description)
    if (score === null) continue
    if (score > bestScore) {
      bestScore = score
      best = order.length
    }
    order.push(w.id)
  }
  return { order, best }
}

const mod = (a: number, n: number): number => ((a % n) + n) % n

/** 把正面换成 index；换了别的卡片才重置保护期 */
function moveTo(state: PickerState, index: number, now: number): PickerState {
  if (state.order.length === 0) return state
  const front = Math.min(Math.max(0, index), state.order.length - 1)
  if (front === state.front) return state
  return { ...state, front, frontSince: now }
}

const select = (state: PickerState, index: number): PickerResult => {
  const id = state.order[index]
  return id === undefined ? { state } : { state, effect: { kind: 'select', id } }
}

export function pickerReducer(state: PickerState, action: PickerAction): PickerResult {
  const n = state.order.length
  switch (action.type) {
    case 'rotate':
      if (n < 2) return { state }
      return { state: moveTo(state, mod(state.front + action.delta, n), action.now) }
    case 'step':
      return { state: moveTo(state, state.front + action.delta, action.now) }
    case 'jump':
      return { state: moveTo(state, action.to === 'first' ? 0 : n - 1, action.now) }
    case 'focusIndex':
      return { state: moveTo(state, action.index, action.now) }
    case 'setQuery': {
      const frontId = state.order[state.front]
      const { order, best } = filterItems(state.items, action.query)
      const keep = frontId === undefined ? -1 : order.indexOf(frontId)
      const front = best >= 0 ? best : Math.max(0, keep)
      return { state: { ...state, query: action.query, order, front, frontSince: action.now } }
    }
    case 'clickCard': {
      if (action.index < 0 || action.index >= n) return { state }
      if (action.index !== state.front) return { state: moveTo(state, action.index, action.now) }
      if (state.mode !== 'browse' || action.now - state.frontSince < FRONT_GUARD_MS) {
        return { state }
      }
      return select(state, state.front)
    }
    case 'clickRow': {
      if (action.index < 0 || action.index >= n) return { state }
      const next = moveTo(state, action.index, action.now)
      return state.mode === 'browse' ? select(next, next.front) : { state: next }
    }
    case 'enter':
      return state.mode === 'browse' ? select(state, state.front) : { state }
    case 'directPick': {
      if (state.mode !== 'browse') return { state }
      const target = state.items[action.n - 1]
      if (target === undefined) return { state }
      const index = state.order.indexOf(target.id)
      const next = index >= 0 ? { ...state, front: index } : state
      return { state: next, effect: { kind: 'select', id: target.id } }
    }
    case 'escape': {
      if (state.query === '') return { state, effect: { kind: 'close' } }
      const frontId = state.order[state.front]
      const order = state.items.map((w) => w.id)
      const keep = frontId === undefined ? -1 : order.indexOf(frontId)
      return { state: { ...state, query: '', order, front: Math.max(0, keep) } }
    }
    case 'sync': {
      const frontId = state.order[state.front]
      const { order } = filterItems(action.items, state.query)
      const keep = frontId === undefined ? -1 : order.indexOf(frontId)
      const front = keep >= 0 ? keep : Math.min(state.front, Math.max(0, order.length - 1))
      const changed = order[front] !== frontId
      return {
        state: {
          ...state,
          items: action.items,
          order,
          front,
          frontSince: changed ? action.now : state.frontSince
        }
      }
    }
  }
}

/** keyToAction 需要的按键字段（KeyboardEvent 的子集，便于测试） */
export interface PickerKey {
  key: string
  code: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  isComposing: boolean
  keyCode: number
}

/**
 * 选择器面板上的按键 → 动作（设计稿 1.6；直选为 Alt+1–9，单按数字进筛选框）。
 * 返回 null 的按键交给默认处理（输入到筛选框、Tab 在面板内循环…）。输入法组字中一律返回 null。
 */
export function keyToAction(
  e: PickerKey,
  now: number,
  ctx: { view?: 'ring' | 'list'; query?: string } = {}
): PickerAction | null {
  if (isImeKey(e)) return null
  const view = ctx.view ?? 'ring'
  const queryEmpty = (ctx.query ?? '') === ''
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1] ?? /^[1-9]$/.exec(e.key)?.[0]
    return digit === undefined ? null : act.directPick(Number(digit))
  }
  if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey) return act.escape()
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null
  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowRight':
      return view === 'ring' ? act.rotate(e.key === 'ArrowLeft' ? -1 : 1, now) : null
    case 'ArrowUp':
    case 'ArrowDown':
      return view === 'list' ? act.step(e.key === 'ArrowUp' ? -1 : 1, now) : null
    case 'Home':
    case 'End':
      return queryEmpty ? act.jump(e.key === 'Home' ? 'first' : 'last', now) : null
    case 'Enter':
      return act.enter()
    default:
      return null
  }
}

/** 滚轮累积的状态：acc 累积量，last 上次转动的时刻，at 上次滚轮事件的时刻 */
export interface WheelState {
  acc: number
  last: number
  at: number
}

/** 累积 50px 转一格、两次之间至少 70ms；停顿超过 180ms 累积清零（设计稿 1.1：滚轮只转动） */
export function wheelStep(
  s: WheelState,
  delta: number,
  now: number
): { delta: number; state: WheelState } {
  const acc = (now - s.at > 180 ? 0 : s.acc) + delta
  if (Math.abs(acc) >= 50 && now - s.last > 70) {
    return { delta: Math.sign(acc), state: { acc: 0, last: now, at: now } }
  }
  return { delta: 0, state: { acc, last: s.last, at: now } }
}

/**
 * 组件用的状态：挂载（每次打开）时初始化；dispatch 同步返回副作用，由调用方执行。
 * items 变化（主进程广播 workspace.changed）时同步，正面保持同一张。
 */
export function usePickerState(
  items: readonly PickerItem[],
  currentId: string | undefined
): [PickerState, (action: PickerAction) => PickerEffect | undefined] {
  const [state, setState] = useState(() => initPickerState(items, currentId, performance.now()))
  const latest = useRef(state)
  const dispatch = useCallback((action: PickerAction): PickerEffect | undefined => {
    const result = pickerReducer(latest.current, action)
    latest.current = result.state
    setState(result.state)
    return result.effect
  }, [])
  useEffect(() => {
    if (latest.current.items !== items) dispatch(act.sync(items, performance.now()))
  }, [items, dispatch])
  return [state, dispatch]
}
