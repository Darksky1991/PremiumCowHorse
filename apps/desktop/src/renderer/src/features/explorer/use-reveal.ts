import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { WorkspaceEntry } from '@pch/shared'
import { confirmDirectory } from '@renderer/data/vfs'
import { useNavigationStore } from '@renderer/stores/navigation-store'
import { useExplorerStore } from './explorer-store'
import { revealNodeIds, revealPath, revealProgress, settleReveal } from './reveal'
import type { TreeNode } from './tree-model'

/** 每一层（一个目录的列表）最多等待的时间；超时则停在已到达的最深一层 */
export const REVEAL_LAYER_TIMEOUT_MS = 10_000

interface ActiveReveal {
  chain: string[]
  target: string
  /** 已到达的 chain 下标（每前进一层重新计时） */
  depth: number
  deadline: number
}

/**
 * 处理 navigation-store 的「在树中定位」请求（搜索结果的 Enter / 单击 / 右键菜单）：
 * URI → 所属条目（最长前缀）→ 一次展开所有祖先（树按层列出目录，已缓存的多层一次求出）→
 * 目标出现后选中并滚动到该行（reveal(index)）。列表已就绪却没有下一段、或某一层
 * 超过 REVEAL_LAYER_TIMEOUT_MS 仍未就绪时，停在已到达的最深一层并提示；前者还让扫描进程顺带确认
 * 出错的那一层目录（设计 8.3，只读；有差异时经 vfs.changed 反映到树与之后的搜索）。
 */
export function useRevealRequests({
  workspaceId,
  entries,
  nodes,
  reveal
}: {
  workspaceId: string
  entries: WorkspaceEntry[]
  nodes: TreeNode[]
  /** 选中并滚动到该行、聚焦树 */
  reveal: (index: number) => void
}): void {
  const { t } = useTranslation()
  const pending = useNavigationStore((s) => s.pending)
  const expand = useExplorerStore((s) => s.expand)
  const active = useRef<ActiveReveal | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef({ nodes, reveal, t })

  useEffect(() => {
    latest.current = { nodes, reveal, t }
  })

  /** 按当前节点判断进展；timedOut 为计时器到期时的调用 */
  const evaluate = useRef((timedOut: boolean): void => {
    const current = active.current
    if (current === null) return
    const { nodes, reveal, t } = latest.current
    const progress = revealProgress(nodes, current.chain, current.target)
    if (progress.state !== 'waiting') {
      active.current = null
      clearTimeout(timer.current)
      settleReveal(nodes, progress, {
        select: reveal,
        confirm: (uri) => void confirmDirectory(uri),
        warn: () => toast.warning(t('explorer:revealNotFound'))
      })
      return
    }

    const now = Date.now()
    if (progress.depth > current.depth) {
      current.depth = progress.depth
      current.deadline = now + REVEAL_LAYER_TIMEOUT_MS
    } else if (timedOut && now >= current.deadline) {
      active.current = null
      clearTimeout(timer.current)
      if (progress.index >= 0) reveal(progress.index)
      toast.warning(t('explorer:revealTimeout'))
      return
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => evaluate.current(true), current.deadline - now)
  })

  // 新请求：只处理本工作区的（其他工作区的请求已过期，丢弃）
  useEffect(() => {
    if (pending === null) return
    const request = useNavigationStore.getState().consume()
    if (request === null || request.workspaceId !== workspaceId) return
    const path = revealPath(entries, request.uri)
    if (path === null) {
      active.current = null
      clearTimeout(timer.current)
      toast.warning(t('explorer:revealNotInWorkspace'))
      return
    }
    const { chain, target } = revealNodeIds(entries, path)
    active.current = { chain, target, depth: -1, deadline: Date.now() + REVEAL_LAYER_TIMEOUT_MS }
    expand(workspaceId, chain)
    // 目标已经可见时展开不会引起重新渲染，这里先判断一次
    evaluate.current(false)
  }, [pending, entries, workspaceId, expand, t])

  // 节点变化（某一层的列表到达）时继续
  useEffect(() => {
    evaluate.current(false)
  }, [nodes])

  useEffect(() => () => clearTimeout(timer.current), [])
}
