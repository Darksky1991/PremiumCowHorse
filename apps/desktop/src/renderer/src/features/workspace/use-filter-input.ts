import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent
} from 'react'

/** 筛选框：text 为输入框中的文字，query 为用于筛选的词（输入法组字中不更新） */
export interface FilterInput {
  text: string
  query: string
}

export type FilterInputEvent =
  | { type: 'change'; value: string; composing: boolean }
  | { type: 'compositionEnd'; value: string }
  | { type: 'clear' }

/**
 * 输入法组字中只更新输入框的文字，筛选在 compositionend 后执行（日语输入中途不跳动，设计稿 1.5 第 7 条）
 */
export function filterInputReducer(state: FilterInput, event: FilterInputEvent): FilterInput {
  switch (event.type) {
    case 'change':
      return { text: event.value, query: event.composing ? state.query : event.value }
    case 'compositionEnd':
      return { text: event.value, query: event.value }
    case 'clear':
      return { text: '', query: '' }
  }
}

/**
 * 筛选框的 hook（圆环选择器与菜单式共用）：返回当前文字 / 筛选词、输入框的事件处理与清空。
 * onQuery：筛选词变化时同步调用（圆环把它交给 pickerReducer）
 */
export function useFilterInput(onQuery?: (query: string) => void): {
  text: string
  query: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  onCompositionEnd: (e: CompositionEvent<HTMLInputElement>) => void
  /** 清空；notify 为 false 时不调用 onQuery（调用方已自行处理，例如圆环的 Esc） */
  clear: (notify?: boolean) => void
} {
  const [state, setState] = useState<FilterInput>({ text: '', query: '' })
  const latest = useRef(state)
  const onQueryRef = useRef(onQuery)
  useLayoutEffect(() => {
    onQueryRef.current = onQuery
  })
  const apply = useCallback((event: FilterInputEvent, notify = true): void => {
    const prev = latest.current
    const next = filterInputReducer(prev, event)
    latest.current = next
    setState(next)
    if (notify && next.query !== prev.query) onQueryRef.current?.(next.query)
  }, [])
  return {
    text: state.text,
    query: state.query,
    onChange: (e) =>
      apply({
        type: 'change',
        value: e.target.value,
        composing: (e.nativeEvent as InputEvent).isComposing
      }),
    onCompositionEnd: (e) => apply({ type: 'compositionEnd', value: e.currentTarget.value }),
    clear: useCallback((notify = true) => apply({ type: 'clear' }, notify), [apply])
  }
}
