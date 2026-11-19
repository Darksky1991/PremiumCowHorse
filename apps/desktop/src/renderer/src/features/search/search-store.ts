import { create } from 'zustand'
import type { SearchKindFilter } from '@pch/shared'

export interface SearchInputState {
  text: string
  kind: SearchKindFilter
}

export const EMPTY_SEARCH: SearchInputState = { text: '', kind: 'all' }

interface SearchState {
  /** 工作区 id → 搜索框内容与类型筛选（切换侧栏视图后保留；只在内存中） */
  byWorkspace: Record<string, SearchInputState>
  setText: (workspaceId: string, text: string) => void
  setKind: (workspaceId: string, kind: SearchKindFilter) => void
}

export const useSearchStore = create<SearchState>((set) => ({
  byWorkspace: {},
  setText: (workspaceId, text) =>
    set((s) => ({
      byWorkspace: {
        ...s.byWorkspace,
        [workspaceId]: { ...(s.byWorkspace[workspaceId] ?? EMPTY_SEARCH), text }
      }
    })),
  setKind: (workspaceId, kind) =>
    set((s) => ({
      byWorkspace: {
        ...s.byWorkspace,
        [workspaceId]: { ...(s.byWorkspace[workspaceId] ?? EMPTY_SEARCH), kind }
      }
    }))
}))
