import {
  isUnderUri,
  prefixOf,
  workspaceLocation,
  workspacesLocation,
  type TabLocation,
  type WorkspaceEntry
} from '@pch/shared'

/**
 * 逻辑路径的一段（设计 devDoc/2026-11-19-15 第 2.1 节）：地址栏与预览区共用。
 * workspaces：工作区一览（只在一览页本身的路径中出现）；desktop：桌面记录页（只有这一段，标签为位置标题）；workspace：工作区（目标为工作区总览）；
 * entry：条目（显示别名 = 条目标签）；dir：目录（条目内的相对路径，或条目之外的绝对路径各段）；file：文件名
 */
export interface PathSegment {
  label: string
  target: TabLocation
  kind: 'workspaces' | 'desktop' | 'workspace' | 'entry' | 'dir' | 'file'
}

export interface LogicalPathContext {
  /** 位置所属的工作区；name 为显示名（空名称已换成本地化的默认名） */
  workspace: { id: string; name: string }
  /** 工作区一览的本地化名称（一览页的段与标题、总览的上一级） */
  workspacesTitle: string
  /** 该工作区的条目（分组不出现在路径中，只用 folder / file 条目） */
  entries: readonly WorkspaceEntry[]
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * 位置所属的条目：包含它的 folder 条目，或 URI 相同的 file 条目；多个时取 URI 最长者（最内层）。
 * 工作区总览、工作区一览与条目之外的位置为 null
 */
export function entryOf(
  loc: TabLocation,
  entries: readonly WorkspaceEntry[]
): (WorkspaceEntry & { uri: string }) | null {
  if (loc.kind === 'workspace' || loc.kind === 'workspaces' || loc.kind === 'desktop') return null
  let best: (WorkspaceEntry & { uri: string }) | null = null
  for (const e of entries) {
    if (e.uri === null) continue
    const contains =
      e.kind === 'folder' ? isUnderUri(loc.uri, e.uri) : e.kind === 'file' && e.uri === loc.uri
    if (contains && (best === null || e.uri.length > best.uri.length)) {
      best = e as WorkspaceEntry & { uri: string }
    }
  }
  return best
}

/**
 * 从 baseUri 往下逐段拼出 URI（不重新编码，与资源树、缓存的 URI 一致）；
 * 最后一段在位置为文件时是 file，其余为 dir
 */
function descend(baseUri: string, rest: readonly string[], loc: TabLocation): PathSegment[] {
  const segments: PathSegment[] = []
  let current = baseUri
  rest.forEach((segment, i) => {
    current = `${prefixOf(current)}${segment}`
    const label = decode(segment)
    const isFile = i === rest.length - 1 && loc.kind === 'file'
    segments.push({
      label,
      kind: isFile ? 'file' : 'dir',
      target: { uri: current, kind: isFile ? 'file' : 'directory', title: label }
    })
  })
  return segments
}

/**
 * 条目之外的绝对路径：本地从驱动器（`C:` → `file:///C:/`）、UNC 从共享（`\\srv\share` →
 * `file://srv/share`）开始。不是 file URI 或无法分段时只有一段（位置本身，标签为 URI）
 */
function absoluteSegments(loc: TabLocation): PathSegment[] {
  const m = /^file:\/\/([^/]*)(\/.*)?$/i.exec(loc.uri)
  const [first, ...rest] = (m?.[2] ?? '').split('/').filter(Boolean)
  if (!m || first === undefined) return [{ label: loc.uri, kind: 'dir', target: loc }]
  const host = m[1] ?? ''
  const rootUri = host === '' ? `file:///${first}/` : `file://${host}/${first}`
  const rootLabel = host === '' ? decode(first) : `\\\\${decode(host)}\\${decode(first)}`
  const isFile = rest.length === 0 && loc.kind === 'file'
  const root: PathSegment = {
    label: rootLabel,
    kind: isFile ? 'file' : 'dir',
    target: { uri: rootUri, kind: isFile ? 'file' : 'directory', title: rootLabel }
  }
  return [root, ...descend(rootUri, rest, loc)]
}

/**
 * 位置的逻辑路径：`工作区` ›（分组不出现）› `条目别名` › 相对路径各段 ›（文件时）文件名。
 * 工作区总览只有工作区一段；条目之外的位置在工作区之后退化为绝对路径（驱动器 / 共享开始）。
 * 桌面记录页只有一段（标题取 loc.title）。工作区一览只有一览一段（名称取 ctx 中的本地化名称，不用标签标题的快照）；
 * 其他位置的路径不含一览这一段（地址栏前置的工作区按钮已代表这一级）
 */
export function logicalPath(loc: TabLocation, ctx: LogicalPathContext): PathSegment[] {
  if (loc.kind === 'workspaces') {
    return [
      {
        label: ctx.workspacesTitle,
        kind: 'workspaces',
        target: workspacesLocation(ctx.workspacesTitle)
      }
    ]
  }
  // 桌面记录页：只有一段（标签为位置标题，不含工作区段）
  if (loc.kind === 'desktop') return [{ label: loc.title, kind: 'desktop', target: loc }]
  const workspace: PathSegment = {
    label: ctx.workspace.name,
    kind: 'workspace',
    target: workspaceLocation(ctx.workspace.id, ctx.workspace.name)
  }
  if (loc.kind === 'workspace') return [workspace]
  const owner = entryOf(loc, ctx.entries)
  if (owner === null) return [workspace, ...absoluteSegments(loc)]
  const entry: PathSegment = {
    label: owner.label,
    kind: 'entry',
    target: {
      uri: owner.uri,
      kind: owner.kind === 'file' ? 'file' : 'directory',
      title: owner.label
    }
  }
  const rest =
    loc.uri === owner.uri
      ? []
      : loc.uri.slice(prefixOf(owner.uri).length).split('/').filter(Boolean)
  return [workspace, entry, ...descend(owner.uri, rest, loc)]
}

/**
 * 「上一级」：逻辑路径的上一段。条目内逐级向上，条目根（含 file 条目）→ 工作区总览；
 * 工作区总览 → 工作区一览；一览 → null；条目之外 → 磁盘上的上级（驱动器 / 共享根之上为工作区总览）
 */
export function parentLocation(loc: TabLocation, ctx: LogicalPathContext): TabLocation | null {
  if (loc.kind === 'workspace') return workspacesLocation(ctx.workspacesTitle)
  const segments = logicalPath(loc, ctx)
  return segments.length < 2 ? null : segments[segments.length - 2]!.target
}
