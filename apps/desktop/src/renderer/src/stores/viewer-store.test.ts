import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewerStore, type TabViewers } from './viewer-store'

const data = (current: string, ext: string | null = 'txt'): TabViewers => ({
  candidates: [
    { id: 'text', name: 'テキスト', current: current === 'text' },
    { id: 'info', name: 'ファイル情報', current: current === 'info' }
  ],
  ext
})

describe('viewer-store', () => {
  beforeEach(() => useViewerStore.setState({ byTab: {} }))

  it('setFor 写入、clear 移除；只影响指定标签', () => {
    const { setFor, clear } = useViewerStore.getState()
    setFor('a', data('text'))
    setFor('b', data('info', null))
    expect(useViewerStore.getState().byTab['a']).toEqual(data('text'))
    clear('a')
    expect(useViewerStore.getState().byTab['a']).toBeUndefined()
    expect(useViewerStore.getState().byTab['b']?.ext).toBeNull()
  })

  it('同内容重复 setFor / 清除不存在的标签不触发订阅者；内容变化时触发', () => {
    const { setFor, clear } = useViewerStore.getState()
    setFor('a', data('text'))
    const listener = vi.fn()
    const unsubscribe = useViewerStore.subscribe(listener)
    setFor('a', data('text'))
    clear('missing')
    expect(listener).not.toHaveBeenCalled()
    setFor('a', data('info'))
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
