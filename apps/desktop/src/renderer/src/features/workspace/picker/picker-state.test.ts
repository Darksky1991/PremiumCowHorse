import { describe, expect, it } from 'vitest'
import {
  FRONT_GUARD_MS,
  act,
  initPickerState,
  keyToAction,
  pickerReducer,
  wheelStep,
  type PickerItem,
  type PickerKey,
  type PickerState
} from './use-picker-state'

const items: PickerItem[] = [
  { id: 'a', name: '物流WMS 障害対応 #4128', description: null },
  { id: 'b', name: '夜間ばっち監視', description: null },
  { id: 'c', name: 'バッチ移行 2026', description: '旧基盤からの移行' },
  { id: 'd', name: '共通', description: 'バッチ以外の雑務' },
  { id: 'e', name: '経理システム', description: null }
]

/** 打开时（t=1000）当前工作区为 a */
const opened = (): PickerState => initPickerState(items, 'a', 1000)

describe('initPickerState', () => {
  it('puts the current workspace in front with an empty query', () => {
    const s = initPickerState(items, 'c', 0)
    expect(s.order).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(s.front).toBe(2)
    expect(s.query).toBe('')
    expect(s.mode).toBe('browse')
    expect(s.confirmDelete).toBeNull()
    expect(initPickerState(items, 'missing', 0).front).toBe(0)
  })
})

describe('pickerReducer', () => {
  it('clicking a side card only turns it to the front', () => {
    const { state, effect } = pickerReducer(opened(), act.clickCard(1, 5000))
    expect(state.front).toBe(1)
    expect(state.frontSince).toBe(5000)
    expect(effect).toBeUndefined()
  })

  it('ignores a click on the front card within the guard period after it arrived', () => {
    const turned = pickerReducer(opened(), act.rotate(1, 5000)).state
    expect(pickerReducer(turned, act.clickCard(1, 5000 + 200)).effect).toBeUndefined()
    expect(pickerReducer(turned, act.clickCard(1, 5000 + 260)).effect).toEqual({
      kind: 'select',
      id: 'b'
    })
    expect(FRONT_GUARD_MS).toBe(250)
  })

  it('does not switch from the front card in edit mode', () => {
    const editing: PickerState = { ...opened(), mode: 'edit' }
    expect(pickerReducer(editing, act.clickCard(0, 99_999)).effect).toBeUndefined()
    expect(pickerReducer(editing, act.enter()).effect).toBeUndefined()
  })

  it('filters by name and description, keeps the order and turns the best match to the front', () => {
    const { state } = pickerReducer(opened(), act.setQuery('バッチ', 2000))
    // 名称前缀 c(3) > 名称包含 b(2，平假名视同片假名) > 说明包含 d(1)
    expect(state.order).toEqual(['b', 'c', 'd'])
    expect(state.order[state.front]).toBe('c')
    expect(state.frontSince).toBe(2000)
    expect(pickerReducer(state, act.enter()).effect).toEqual({ kind: 'select', id: 'c' })
  })

  it('leaves the ring empty when nothing matches; Enter does nothing', () => {
    const { state } = pickerReducer(opened(), act.setQuery('xyz', 2000))
    expect(state.order).toEqual([])
    expect(pickerReducer(state, act.enter()).effect).toBeUndefined()
    expect(pickerReducer(state, act.rotate(1, 2100)).state.front).toBe(0)
  })

  it('selects the new front right after rotating (the animation does not matter)', () => {
    const rotated = pickerReducer(opened(), act.rotate(1, 3000)).state
    const { effect } = pickerReducer(rotated, act.enter())
    expect(effect).toEqual({ kind: 'select', id: rotated.order[rotated.front] })
    expect(effect).toEqual({ kind: 'select', id: 'b' })
  })

  it('wraps around at both ends', () => {
    const last = pickerReducer(opened(), act.focusIndex(4, 0)).state
    expect(pickerReducer(last, act.rotate(1, 1)).state.front).toBe(0)
    expect(pickerReducer(opened(), act.rotate(-1, 1)).state.front).toBe(4)
  })

  it('clamps instead of wrapping for list steps, and jumps to the first / last', () => {
    expect(pickerReducer(opened(), act.step(-1, 1)).state.front).toBe(0)
    const last = pickerReducer(opened(), act.jump('last', 1)).state
    expect(last.front).toBe(4)
    expect(pickerReducer(last, act.step(1, 2)).state.front).toBe(4)
    expect(pickerReducer(last, act.jump('first', 2)).state.front).toBe(0)
  })

  it('does not rotate a single card', () => {
    const one = initPickerState([items[0]!], 'a', 0)
    const { state } = pickerReducer(one, act.rotate(1, 500))
    expect(state.front).toBe(0)
    expect(state.frontSince).toBe(0)
  })

  it('escape clears the query first, then closes', () => {
    const filtered = pickerReducer(opened(), act.setQuery('バッチ', 2000)).state
    const cleared = pickerReducer(filtered, act.escape(2100))
    expect(cleared.effect).toBeUndefined()
    expect(cleared.state.query).toBe('')
    expect(cleared.state.order).toEqual(['a', 'b', 'c', 'd', 'e'])
    // 清空后正面仍是刚才看着的那张（位置感）
    expect(cleared.state.order[cleared.state.front]).toBe('c')
    expect(pickerReducer(cleared.state, act.escape(2200)).effect).toEqual({ kind: 'close' })
  })

  it('ignores any click on the ring within the guard period, side cards included (double click)', () => {
    // 第一次点击把 +1 卡转到正面；150ms 后第二次点击落在滑入光标下的原 +2 卡（现 +1）上：不再转动
    const first = pickerReducer(opened(), act.clickCard(1, 5000)).state
    expect(first.order[first.front]).toBe('b')
    const second = pickerReducer(first, act.clickCard(2, 5150))
    expect(second.state.order[second.state.front]).toBe('b')
    expect(second.effect).toBeUndefined()
    // 打开后的保护期内也一样
    expect(pickerReducer(opened(), act.clickCard(1, 1100)).state.front).toBe(0)
    // 过了保护期照常转动
    expect(pickerReducer(first, act.clickCard(2, 5260)).state.front).toBe(2)
  })

  it('Esc from "no results" restores the card that was in front before filtering and restarts the guard', () => {
    const atC = pickerReducer(opened(), act.focusIndex(2, 2000)).state
    const none = pickerReducer(atC, act.setQuery('xyz', 3000)).state
    expect(none.order).toEqual([])
    expect(none.frontSince).toBe(3000)
    const cleared = pickerReducer(none, act.escape(4000)).state
    expect(cleared.order[cleared.front]).toBe('c')
    expect(cleared.frontSince).toBe(4000)
    expect(cleared.lastFrontId).toBe('c')
  })

  it('deleting the query from "no results" (Backspace) also restores the previous front card', () => {
    const atC = pickerReducer(opened(), act.focusIndex(2, 2000)).state
    const none = pickerReducer(atC, act.setQuery('x', 3000)).state
    const back = pickerReducer(none, act.setQuery('', 3500)).state
    expect(back.order[back.front]).toBe('c')
    expect(back.frontSince).toBe(3500)
  })

  it('restarts the guard only when the front card actually changes', () => {
    // 再输入一个字，最佳匹配仍是同一张：保护期不重新计
    const s1 = pickerReducer(opened(), act.setQuery('バ', 2000)).state
    const s2 = pickerReducer(s1, act.setQuery('バッ', 2100)).state
    expect(s2.order[s2.front]).toBe(s1.order[s1.front])
    expect(s2.frontSince).toBe(2000)
    // 列表变化后正面换了（正面那张被删除）：重新计
    const atC = pickerReducer(opened(), act.focusIndex(2, 2000)).state
    const synced = pickerReducer(
      atC,
      act.sync(
        items.filter((w) => w.id !== 'c'),
        9000
      )
    ).state
    expect(synced.frontSince).toBe(9000)
  })

  it('direct pick (Alt+n) follows sortOrder and works while filtering', () => {
    const filtered = pickerReducer(opened(), act.setQuery('バッチ', 2000)).state
    expect(pickerReducer(filtered, act.directPick(5)).effect).toEqual({ kind: 'select', id: 'e' })
    const picked = pickerReducer(opened(), act.directPick(2))
    expect(picked.effect).toEqual({ kind: 'select', id: 'b' })
    expect(picked.state.front).toBe(1)
    expect(pickerReducer(opened(), act.directPick(6)).effect).toBeUndefined()
    expect(pickerReducer({ ...opened(), mode: 'edit' }, act.directPick(2)).effect).toBeUndefined()
  })

  it('a list row click switches at once (there is no rotation in the list)', () => {
    const { state, effect } = pickerReducer(opened(), act.clickRow(3, 1001))
    expect(state.front).toBe(3)
    expect(effect).toEqual({ kind: 'select', id: 'd' })
  })

  it('keeps the front card when the workspace list changes underneath', () => {
    const atC = pickerReducer(opened(), act.focusIndex(2, 0)).state
    const renamed = items.map((w) => (w.id === 'a' ? { ...w, name: '改名' } : w))
    const synced = pickerReducer(
      atC,
      act.sync([{ id: 'z', name: 'new', description: null }, ...renamed], 10)
    )
    expect(synced.state.order[synced.state.front]).toBe('c')
    const removed = pickerReducer(
      atC,
      act.sync(
        items.filter((w) => w.id !== 'c'),
        10
      )
    )
    expect(removed.state.front).toBe(2)
    expect(removed.state.order).toHaveLength(4)
  })
})

describe('keyToAction', () => {
  const key = (k: string, extra: Partial<PickerKey> = {}): PickerKey => ({
    key: k,
    code: '',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 0,
    ...extra
  })

  it('maps the ring keys', () => {
    expect(keyToAction(key('ArrowRight'), 7)).toEqual(act.rotate(1, 7))
    expect(keyToAction(key('ArrowLeft'), 7)).toEqual(act.rotate(-1, 7))
    expect(keyToAction(key('Enter'), 7)).toEqual(act.enter())
    expect(keyToAction(key('Escape'), 7)).toEqual(act.escape(7))
    expect(keyToAction(key('ArrowDown'), 7)).toBeNull()
  })

  it('maps the list keys', () => {
    const list = { view: 'list' as const, query: '' }
    expect(keyToAction(key('ArrowDown'), 7, list)).toEqual(act.step(1, 7))
    expect(keyToAction(key('ArrowUp'), 7, list)).toEqual(act.step(-1, 7))
    expect(keyToAction(key('ArrowRight'), 7, list)).toBeNull()
  })

  it('Home / End jump only while the filter box is empty', () => {
    expect(keyToAction(key('Home'), 7, { view: 'ring', query: '' })).toEqual(act.jump('first', 7))
    expect(keyToAction(key('End'), 7, { view: 'list', query: '' })).toEqual(act.jump('last', 7))
    expect(keyToAction(key('Home'), 7, { view: 'ring', query: 'ab' })).toBeNull()
  })

  it('Alt+1–9 picks directly; a plain digit goes into the filter box', () => {
    expect(keyToAction(key('2', { altKey: true, code: 'Digit2' }), 7)).toEqual(act.directPick(2))
    expect(keyToAction(key('9', { altKey: true, code: 'Numpad9' }), 7)).toEqual(act.directPick(9))
    expect(keyToAction(key('2'), 7)).toBeNull()
    expect(keyToAction(key('0', { altKey: true, code: 'Digit0' }), 7)).toBeNull()
    expect(keyToAction(key('2', { altKey: true, ctrlKey: true, code: 'Digit2' }), 7)).toBeNull()
  })

  it('ignores Alt+arrows (reordering is for the edit mode) and other modifiers', () => {
    expect(keyToAction(key('ArrowRight', { altKey: true }), 7)).toBeNull()
    expect(keyToAction(key('Enter', { ctrlKey: true }), 7)).toBeNull()
  })

  it('returns null for every key during IME composition', () => {
    expect(keyToAction(key('Enter', { isComposing: true }), 7)).toBeNull()
    expect(keyToAction(key('ArrowRight', { isComposing: true }), 7)).toBeNull()
    expect(keyToAction(key('Escape', { isComposing: true }), 7)).toBeNull()
    expect(keyToAction(key('Process', { keyCode: 229 }), 7)).toBeNull()
    expect(keyToAction(key('Enter', { keyCode: 229 }), 7)).toBeNull()
  })
})

describe('wheelStep', () => {
  it('turns one step per 50px accumulated, at most once per 70ms', () => {
    let s = { acc: 0, last: -Infinity, at: -Infinity }
    let r = wheelStep(s, 30, 0)
    expect(r.delta).toBe(0)
    s = r.state
    r = wheelStep(s, 30, 10)
    expect(r.delta).toBe(1)
    s = r.state
    r = wheelStep(s, 100, 40)
    expect(r.delta).toBe(0)
    r = wheelStep(r.state, 100, 120)
    expect(r.delta).toBe(1)
    expect(wheelStep({ acc: 0, last: -Infinity, at: -Infinity }, -120, 0).delta).toBe(-1)
  })
})
