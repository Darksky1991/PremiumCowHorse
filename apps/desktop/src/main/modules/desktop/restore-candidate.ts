import {
  desktopItemKey,
  type DesktopSnapshot,
  type DesktopSnapshotItem,
  type DesktopSnapshotSummary
} from '@pch/shared'

/**
 * 启动时是否提示恢复：当前登录已有任何快照 → 不提示（每次登录只提示一次）；
 * 否则看上一次登录（logon_at 小于当前的最大者）中 created_at 最后一份非 manual 快照：
 * exit / auto → 它；exit-none 或没有 → null（设计 5.7）
 */
export function pickRestoreCandidate(
  snapshots: DesktopSnapshotSummary[],
  currentLogonAt: number
): { snapshotId: number } | null {
  if (snapshots.some((s) => s.logonAt === currentLogonAt)) return null
  let prevLogon = -Infinity
  for (const s of snapshots) {
    if (s.logonAt < currentLogonAt && s.logonAt > prevLogon) prevLogon = s.logonAt
  }
  if (prevLogon === -Infinity) return null

  let last: DesktopSnapshotSummary | null = null
  for (const s of snapshots) {
    if (s.logonAt !== prevLogon || s.kind === 'manual') continue
    if (!last || s.createdAt > last.createdAt || (s.createdAt === last.createdAt && s.id > last.id))
      last = s
  }
  if (!last || last.kind === 'exit-none') return null
  return { snapshotId: last.id }
}

/** 快照中尚未开着的项目（Explorer 只要第一个标签的路径已开着就算整个窗口开着） */
export function itemsToOffer(
  snapshot: DesktopSnapshot,
  openTargets: Set<string>
): DesktopSnapshotItem[] {
  return snapshot.items.filter(({ item }) => {
    if (item.kind === 'explorer') {
      const first = item.tabs[0]
      return first === undefined || !openTargets.has(`explorer-tab:${first.toLowerCase()}`)
    }
    return !openTargets.has(desktopItemKey(item))
  })
}
