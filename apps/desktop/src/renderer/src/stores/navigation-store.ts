import { create } from 'zustand'

/** 「在资源树中定位」的请求；seq 区分对同一 URI 的再次请求 */
export interface RevealRequest {
  workspaceId: string
  uri: string
  seq: number
}

interface NavigationState {
  /** 尚未被资源树处理的请求（只保留最新一个） */
  pending: RevealRequest | null
  requestReveal: (workspaceId: string, uri: string) => void
  /** 取出并清空待处理的请求 */
  consume: () => RevealRequest | null
}

let seq = 0

/**
 * 跨 feature 的定位请求（feature 之间不互相 import）：搜索视图发出，资源树挂载后处理。
 * 切换侧栏视图由发出方负责（资源树在其他视图显示期间不挂载）。
 */
export const useNavigationStore = create<NavigationState>((set, get) => ({
  pending: null,
  requestReveal: (workspaceId, uri) => set({ pending: { workspaceId, uri, seq: ++seq } }),
  consume: () => {
    const { pending } = get()
    if (pending !== null) set({ pending: null })
    return pending
  }
}))
