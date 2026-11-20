import { create } from 'zustand'
import type { TabsState } from '@pch/shared'
import { useTabsStore } from './tabs-store'

/**
 * 定位请求的种类：
 * - locate：用户要求「在资源树中定位」（搜索结果）——聚焦树，找不到时提示；
 * - sync：激活标签的位置变了，树跟随（设计 2.4「预览区 → 树」）——只选中并滚动，不聚焦、不提示，
 *   位置不在树中（工作区总览、条目之外）时选中保持不变。由同步引起的选中不触发打开（不形成循环）
 */
export type RevealMode = 'locate' | 'sync'

/** 「在资源树中定位」的请求；seq 区分对同一 URI 的再次请求 */
export interface RevealRequest {
  workspaceId: string
  uri: string
  mode: RevealMode
  seq: number
}

interface NavigationState {
  /** 尚未被资源树处理的请求（只保留最新一个） */
  pending: RevealRequest | null
  requestReveal: (workspaceId: string, uri: string, mode?: RevealMode) => void
  /** 取出并清空待处理的请求 */
  consume: () => RevealRequest | null
}

let seq = 0

/**
 * 跨 feature 的定位请求（feature 之间不互相 import）：搜索视图与标签（见文件末尾的订阅）发出，
 * 资源树挂载后处理。资源树不挂载期间（侧栏显示其他视图）请求留到挂载时处理，只保留最新一个。
 * 切换侧栏视图由发出方负责（资源树在其他视图显示期间不挂载）。
 */
export const useNavigationStore = create<NavigationState>((set, get) => ({
  pending: null,
  requestReveal: (workspaceId, uri, mode = 'locate') =>
    set({ pending: { workspaceId, uri, mode, seq: ++seq } }),
  consume: () => {
    const { pending } = get()
    if (pending !== null) set({ pending: null })
    return pending
  }
}))

/**
 * 激活标签（标签 id 或其位置）有变化的工作区及其新位置：打开、切换激活标签、标签内导航、后退 / 前进。
 * viewState、刷新、关闭非激活标签、导航到当前位置都不算；没有激活标签（关闭了最后一个）不列出
 */
export function activeLocationChanges(
  prev: Readonly<Record<string, TabsState>>,
  next: Readonly<Record<string, TabsState>>
): Array<{ workspaceId: string; uri: string }> {
  const changes: Array<{ workspaceId: string; uri: string }> = []
  for (const [workspaceId, state] of Object.entries(next)) {
    if (state === prev[workspaceId]) continue
    const now = state.tabs.find((t) => t.id === state.activeId)
    if (now === undefined) continue
    const before = prev[workspaceId]
    const was = before?.tabs.find((t) => t.id === before.activeId)
    if (was !== undefined && was.id === now.id && was.uri === now.uri) continue
    changes.push({ workspaceId, uri: now.uri })
  }
  return changes
}

// 预览区 → 树（设计 2.4）：激活位置一变就发出 sync 请求。放在 store 层订阅（而不是资源树内），
// 资源树不挂载期间的变化也留到挂载时处理；模块随资源树 / 搜索视图加载，订阅与应用同寿命
useTabsStore.subscribe((s, prev) => {
  if (s.byWorkspace === prev.byWorkspace) return
  const { requestReveal } = useNavigationStore.getState()
  for (const { workspaceId, uri } of activeLocationChanges(prev.byWorkspace, s.byWorkspace)) {
    requestReveal(workspaceId, uri, 'sync')
  }
})
