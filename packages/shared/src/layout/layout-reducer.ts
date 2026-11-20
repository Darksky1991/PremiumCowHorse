import type {
  TabHistory,
  TabHistoryEntry,
  TabLocation,
  TabState,
  TabsAction,
  TabsState
} from './types'

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
 *   离开的位置连同其 viewState 压入后退栈、前进栈清空。导航到当前 URI 不入栈（只更新类型与标题）。
 * - `tab/back` / `tab/forward`：浏览器式，当前位置（连同 viewState）压入另一侧的栈；
 *   恢复目标位置离开时的 viewState（像浏览器后退恢复滚动位置）。
 * - `tab/viewer`：设置 / 清除当前位置的查看器（viewer），并清除 viewState。viewer 随位置进入历史，
 *   导航到新位置时清除，后退 / 前进恢复历史项的 viewer。
 * - `tab/viewState`：写入当前位置；带 `uri` 且标签已离开该位置时（视图在导航之后才卸载、补存防抖中的状态）
 *   写入刚离开的那一项——后退栈顶（导航 / 前进离开）或前进栈顶（后退离开）中 URI 相同者，都不是时不变。
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
      const history: TabHistory = { back: push(tab.history.back, entryOf(tab)), forward: [] }
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
      const pushed = push(to, entryOf(tab))
      const history: TabHistory = isBack
        ? { back: rest, forward: pushed }
        : { back: pushed, forward: rest }
      return moveTo(state, tab, target, history)
    }
    case 'tab/viewState': {
      const tab = state.tabs.find((t) => t.id === action.id)
      if (!tab) return state
      if (action.uri === undefined || action.uri === tab.uri) {
        return { ...state, tabs: replace(state.tabs, tab.id, { viewState: action.viewState }) }
      }
      const history = withLeftViewState(tab.history, action.uri, action.viewState)
      return history ? { ...state, tabs: replace(state.tabs, tab.id, { history }) } : state
    }
    case 'tab/viewer': {
      const tab = state.tabs.find((t) => t.id === action.id)
      if (!tab) return state
      if ((tab.viewer ?? null) === action.viewer) return state
      const next: TabState = {
        id: tab.id,
        ...locationOf(tab),
        ...(action.viewer === null ? {} : { viewer: action.viewer }),
        history: tab.history
      }
      return { ...state, tabs: state.tabs.map((t) => (t.id === tab.id ? next : t)) }
    }
  }
}

/** 刚离开的那一项（后退栈顶，其次前进栈顶）为 uri 时换上 viewState；都不是时为 null */
function withLeftViewState(
  history: TabHistory,
  uri: string,
  viewState: unknown
): TabHistory | null {
  const update = (stack: TabHistoryEntry[]): TabHistoryEntry[] | null => {
    const top = stack.at(-1)
    if (top?.uri !== uri) return null
    return [...stack.slice(0, -1), { ...entryOf(top), viewState }]
  }
  const back = update(history.back)
  if (back) return { ...history, back }
  const forward = update(history.forward)
  return forward ? { ...history, forward } : null
}

/**
 * 标签换到另一个位置：viewState 换成目标的（导航时目标是纯位置 → 清除，不同位置的视图状态不通用；
 * 后退 / 前进时目标是历史项 → 恢复离开时的）
 */
function moveTo(
  state: TabsState,
  tab: TabState,
  target: TabHistoryEntry,
  history: TabHistory
): TabsState {
  const next: TabState = { id: tab.id, ...entryOf(target), history }
  return { ...state, tabs: state.tabs.map((t) => (t.id === tab.id ? next : t)) }
}

/** 只取位置的三个字段（动作 / 标签对象中的其他字段不进历史） */
function locationOf(l: TabLocation): TabLocation {
  return { uri: l.uri, kind: l.kind, title: l.title }
}

/** 历史项：位置、viewState 与 viewer（没有时不含该键） */
function entryOf(l: TabHistoryEntry): TabHistoryEntry {
  return {
    ...locationOf(l),
    ...(l.viewState === undefined ? {} : { viewState: l.viewState }),
    ...(l.viewer === undefined ? {} : { viewer: l.viewer })
  }
}

/** 压栈；超过上限时丢弃最旧的（栈底） */
function push(stack: readonly TabHistoryEntry[], entry: TabHistoryEntry): TabHistoryEntry[] {
  const next = [...stack, entry]
  return next.length > TAB_HISTORY_LIMIT ? next.slice(next.length - TAB_HISTORY_LIMIT) : next
}

function replace(tabs: TabState[], id: string, patch: Partial<TabState>): TabState[] {
  return tabs.map((t) => (t.id === id ? { ...t, ...patch } : t))
}
