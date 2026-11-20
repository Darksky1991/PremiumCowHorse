import { isUnderUri, prefixOf, type WorkspaceEntry } from '@pch/shared'
import type { RevealMode } from '@renderer/stores/navigation-store'
import type { TreeNode } from './tree-model'

/** URI 在树中的位置：所属条目 + 相对条目根的路径段（已解码，与目录列表中的名称一致） */
export interface RevealPath {
  entryId: string
  segments: string[]
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * URI → 所属条目。固定的单个文件条目按 URI 完全一致优先；其余取 URI 前缀最长的 folder 条目
 * （isUnderUri：前缀落在路径段边界上，大小写敏感，与扫描进程的范围判断一致）。不在任何条目之下时为 null。
 */
export function revealPath(entries: readonly WorkspaceEntry[], uri: string): RevealPath | null {
  const file = entries.find((e) => e.kind === 'file' && e.uri === uri)
  if (file) return { entryId: file.id, segments: [] }

  let best: WorkspaceEntry | null = null
  for (const e of entries) {
    if (e.kind !== 'folder' || e.uri === null || !isUnderUri(uri, e.uri)) continue
    if (best === null || (best.uri ?? '').length < e.uri.length) best = e
  }
  if (best === null || best.uri === null) return null
  if (uri === best.uri) return { entryId: best.id, segments: [] }
  const rest = uri.slice(prefixOf(best.uri).length)
  return {
    entryId: best.id,
    segments: rest
      .split('/')
      .filter((s) => s !== '')
      .map(decodeSegment)
  }
}

/**
 * 定位需要展开的节点（祖先分组 → 条目 → 中间目录，自上而下）与目标节点的 id。
 * id 的规则与 tree-model 一致：条目 `entry:<id>`，真实子项 `fs:<entryId>:<相对路径>`。
 */
export function revealNodeIds(
  entries: readonly WorkspaceEntry[],
  path: RevealPath
): { chain: string[]; target: string } {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const groups: string[] = []
  const seen = new Set<string>()
  let parentId = byId.get(path.entryId)?.parentId ?? null
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId)
    groups.unshift(`entry:${parentId}`)
    parentId = byId.get(parentId)?.parentId ?? null
  }

  const entryNode = `entry:${path.entryId}`
  if (path.segments.length === 0) return { chain: groups, target: entryNode }
  const dirs: string[] = []
  for (let i = 1; i < path.segments.length; i++) {
    dirs.push(`fs:${path.entryId}:${path.segments.slice(0, i).join('/')}`)
  }
  return {
    chain: [...groups, entryNode, ...dirs],
    target: `fs:${path.entryId}:${path.segments.join('/')}`
  }
}

/**
 * 定位的进展。done：目标已出现；waiting：最深的已出现祖先还在展开 / 加载；
 * failed：该层的列表已就绪（或出错）却没有下一段——缓存过期、目录被删除等。
 * index 为应选中的节点（done 为目标，其余为最深的已出现祖先；连条目都不在树中时为 -1），
 * depth 为已到达的 chain 下标（done 为 chain.length，什么都没有时为 -1）。
 */
export function revealProgress(
  nodes: readonly TreeNode[],
  chain: readonly string[],
  target: string
): { state: 'done' | 'waiting' | 'failed'; index: number; depth: number } {
  const indexOf = (id: string): number => nodes.findIndex((n) => n.id === id)
  const targetIndex = indexOf(target)
  if (targetIndex !== -1) return { state: 'done', index: targetIndex, depth: chain.length }

  let depth = -1
  let index = -1
  for (let i = 0; i < chain.length; i++) {
    const found = indexOf(chain[i] as string)
    if (found === -1) break
    depth = i
    index = found
  }
  const parent = nodes[index]
  if (parent === undefined) return { state: 'failed', index: -1, depth: -1 }
  if (!parent.expandable) return { state: 'failed', index, depth }
  if (!parent.expanded) return { state: 'waiting', index, depth }
  const status = nodes.find((n) => n.id === `${parent.id}#status`)
  return { state: status?.status === 'loading' ? 'waiting' : 'failed', index, depth }
}

/**
 * 定位失败（revealProgress 为 failed）时应顺带确认的目录（设计 8.3）：index 为失败时最深的已出现
 * 祖先。它是目录（列表没有下一段或出错）时确认它自身；中间段已变成文件时确认它所在的目录。
 * 分组节点、没有节点时为 null。只读确认，结果经 vfs.changed 反映到树与之后的搜索。
 */
export function revealRecheckUri(nodes: readonly TreeNode[], index: number): string | null {
  const node = nodes[index]
  if (node === undefined) return null
  if (node.expandable) return node.uri
  return nodes.find((n) => n.id === node.parentId)?.uri ?? null
}

/** 定位结束时的副作用（由 hook 注入：选中并滚动、让扫描进程确认目录、提示） */
export interface RevealEffects {
  /** 选中并滚动到该行、聚焦树 */
  select: (index: number) => void
  /** 顺带确认出错的那一层目录（只读，vfs.refresh） */
  confirm: (uri: string) => void
  /** 提示「在资源树中找不到」 */
  warn: () => void
}

/**
 * 按进展结束定位：done 选中目标；failed 时 locate 选中最深的已出现祖先、确认出错的那一层目录
 * （revealRecheckUri，设计 8.3）并提示，sync 什么都不做（位置不在树中时树保持原选中，设计 2.4）；
 * waiting 不做任何事。返回是否已结束。
 */
export function settleReveal(
  nodes: readonly TreeNode[],
  progress: { state: 'done' | 'waiting' | 'failed'; index: number },
  effects: RevealEffects,
  mode: RevealMode
): boolean {
  if (progress.state === 'waiting') return false
  if (progress.state === 'done' || mode === 'locate') {
    if (progress.index >= 0) effects.select(progress.index)
  }
  if (progress.state === 'failed' && mode === 'locate') {
    const uri = revealRecheckUri(nodes, progress.index)
    if (uri !== null) effects.confirm(uri)
    effects.warn()
  }
  return true
}

/**
 * 某一层超过 REVEAL_LAYER_TIMEOUT_MS 仍未就绪时结束定位：locate 选中已到达的最深一层并提示；
 * sync 什么都不做（树保持原选中，设计 2.4）
 */
export function settleRevealTimeout(
  progress: { index: number },
  mode: RevealMode,
  effects: Pick<RevealEffects, 'select' | 'warn'>
): void {
  if (mode === 'sync') return
  if (progress.index >= 0) effects.select(progress.index)
  effects.warn()
}
