import type { TabHistory, TabLocation, TabState, TabsAction, TabsState } from './types'

/** 每个标签的后退栈 / 前进栈各自的上限（超出时丢弃最旧的） */
export const TAB_HISTORY_LIMIT = 50

const NO_HISTORY: TabHistory = { back: [], forward: [] }

/**
 * 标签布局的纯函数 reducer（单窗口子集，doc 11 节）。没有变化时返回同一个状态对象。
 * newId 生成新标签的 id（由调用方注入，便于测试）。
 *
 * - `tab/open`（在新标签打开）：同 URI 已打开 → 只激活；否则插在激活标签右侧
 *   （没有激活标签时放在末尾）。新标签的历史为空。没有「预览标签」（设计 2.8）。
 * - `tab/close`：关闭激活标签时激活右侧相邻标签，没有则左侧，都没有则为 null（历史随标签消失）。
 * - `tab/navigate`（在当前标签打开）：同一标签内改位置并清除 viewState（允许与其他标签的 URI 重复）；
 *   离开的位置压入后退栈、前进栈清空。导航到当前 URI 不入栈（只更新类型与标题）。
 * - `tab/back` / `tab/forward`：浏览器式，当前位置压入另一侧的栈；同样清除 viewState。
 */
export function layoutReducer(
  state: TabsState,
  action: TabsAction,
  newId: () => string
): TabsState {
  switch (action.type) {
    case 'tab/open': {
      const existing = state.tabs.find((t) => t.uri === action.uri)
      if (existing) {
        if (state.activeId === existing.id) return state
        return { ...state, activeId: existing.id }
      }
      const tab: TabState = { id: newId(), ...locationOf(action), history: NO_HISTORY }
      const activeIndex = state.tabs.findIndex((t) => t.id === state.activeId)
      const at = activeIndex < 0 ? state.tabs.length : activeIndex + 1
      return { tabs: [...state.tabs.slice(0, at), tab, ...state.tabs.slice(at)], activeId: tab.id }
    }
    case 'tab/close': {
      const index = state.tabs.findIndex((t) => t.id === action.id)
      if (index < 0) return state
      const tabs = state.tabs.filter((t) => t.id !== action.id)
      if (state.activeId !== action.id) return { tabs, activeId: state.activeId }
      // 右侧相邻标签移到了 index 位置；没有则取左侧
      const next = tabs[index] ?? tabs[index - 1] ?? null
      return { tabs, activeId: next?.id ?? null }
    }
    case 'tab/activate':
      if (state.activeId === action.id || !state.tabs.some((t) => t.id === action.id)) return state
      return { ...state, activeId: action.id }
    case 'tab/navigate': {
      const tab = state.tabs.find((t) => t.id === action.id)
      if (!tab) return state
      if (tab.uri === action.uri) {
        // 同一位置：不入栈、不清除 viewState；只更新类型与标题
        if (tab.kind === action.kind && tab.title === action.title) return state
        return {
          ...state,
          tabs: replace(state.tabs, tab.id, { kind: action.kind, title: action.title })
        }
      }
      const history: TabHistory = { back: push(tab.history.back, locationOf(tab)), forward: [] }
      return moveTo(state, tab, locationOf(action), history)
    }
    case 'tab/back':
    case 'tab/forward': {
      const tab = state.tabs.find((t) => t.id === action.id)
      if (!tab) return state
      const isBack = action.type === 'tab/back'
      const from = isBack ? tab.history.back : tab.history.forward
      const to = isBack ? tab.history.forward : tab.history.back
      const target = from.at(-1)
      if (target === undefined) return state
      const rest = from.slice(0, -1)
      const pushed = push(to, locationOf(tab))
      const history: TabHistory = isBack
        ? { back: rest, forward: pushed }
        : { back: pushed, forward: rest }
      return moveTo(state, tab, target, history)
    }
    case 'tab/viewState':
      if (!state.tabs.some((t) => t.id === action.id)) return state
      return { ...state, tabs: replace(state.tabs, action.id, { viewState: action.viewState }) }
  }
}

/** 标签换到另一个位置：清除 viewState（不同位置的视图状态不通用） */
function moveTo(
  state: TabsState,
  tab: TabState,
  location: TabLocation,
  history: TabHistory
): TabsState {
  const next: TabState = { id: tab.id, ...location, history }
  return { ...state, tabs: state.tabs.map((t) => (t.id === tab.id ? next : t)) }
}

/** 只取位置的三个字段（动作 / 标签对象中的其他字段不进历史） */
function locationOf(l: TabLocation): TabLocation {
  return { uri: l.uri, kind: l.kind, title: l.title }
}

/** 压栈；超过上限时丢弃最旧的（栈底） */
function push(stack: readonly TabLocation[], location: TabLocation): TabLocation[] {
  const next = [...stack, location]
  return next.length > TAB_HISTORY_LIMIT ? next.slice(next.length - TAB_HISTORY_LIMIT) : next
}

function replace(tabs: TabState[], id: string, patch: Partial<TabState>): TabState[] {
  return tabs.map((t) => (t.id === id ? { ...t, ...patch } : t))
}
