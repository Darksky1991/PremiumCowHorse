import { create } from 'zustand'

/**
 * 与 @pch/plugin-sdk 的 ViewerCandidate 同形（stores/ 按分层规则不依赖其他层，这里按结构声明；
 * 写入方传入 SDK 的对象时由类型检查保证兼容）
 */
export interface ViewerOption {
  /** 插件 id */
  id: string
  /** 显示名（已按当前语言翻译） */
  name: string
  /** 是否为当前显示的查看器 */
  current: boolean
}

export interface TabViewers {
  candidates: ViewerOption[]
  /** preview.associations 用的键：文件名最后一段扩展名（小写，无点）；没有扩展名为 null */
  ext: string | null
}

interface ViewerState {
  /** 标签 id → 该标签当前资源的候选查看器（预览容器写入，地址栏的查看器下拉读取） */
  byTab: Record<string, TabViewers>
  setFor: (tabId: string, data: TabViewers) => void
  clear: (tabId: string) => void
}

function same(a: TabViewers, b: TabViewers): boolean {
  return (
    a.ext === b.ext &&
    a.candidates.length === b.candidates.length &&
    a.candidates.every((c, i) => {
      const o = b.candidates[i]!
      return c.id === o.id && c.name === o.name && c.current === o.current
    })
  )
}

/**
 * 标签内容与地址栏之间的桥（feature 之间不互相 import）：预览容器在选定插件后写入候选，
 * 卸载时清除；地址栏的查看器下拉读取。内容相同的重复写入不更新（避免渲染循环）。
 */
export const useViewerStore = create<ViewerState>((set, get) => ({
  byTab: {},
  setFor: (tabId, data) => {
    const current = get().byTab[tabId]
    if (current !== undefined && same(current, data)) return
    set({ byTab: { ...get().byTab, [tabId]: data } })
  },
  clear: (tabId) => {
    const byTab = get().byTab
    if (!Object.hasOwn(byTab, tabId)) return
    const next = { ...byTab }
    delete next[tabId]
    set({ byTab: next })
  }
}))
