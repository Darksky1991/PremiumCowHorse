import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type {
  DesktopCurrent,
  DesktopPick,
  DesktopRestorePick,
  DesktopRestoreResult,
  DesktopSnapshot,
  DesktopSnapshotSummary
} from '@pch/shared'
import { call } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'

/**
 * 桌面记录（M3）的查询与写操作。主进程在现场 / 快照变化时广播 desktop.changed，
 * 缓存由 query-client 的桥接失效；写操作不需要自己失效缓存。
 */

/** 本机的快照列表（按创建时间倒序，由主进程排序） */
export function useDesktopSnapshots(): UseQueryResult<DesktopSnapshotSummary[]> {
  return useQuery({
    queryKey: queryKeys.desktopSnapshots,
    queryFn: () => call('desktop.list', undefined)
  })
}

/** 单个快照（含项目）；id 不存在时查询失败（DESKTOP_SNAPSHOT_NOT_FOUND） */
export function useDesktopSnapshot(id: number): UseQueryResult<DesktopSnapshot> {
  return useQuery({
    queryKey: queryKeys.desktopSnapshot(id),
    queryFn: () => call('desktop.get', { id })
  })
}

/** 当前现场（开着的项目与本轮无法读取的类别） */
export function useDesktopCurrent(): UseQueryResult<DesktopCurrent> {
  return useQuery({
    queryKey: queryKeys.desktopCurrent,
    queryFn: () => call('desktop.current', undefined)
  })
}

/** 保存现场中选中的项目为手动快照（Explorer 可只选部分标签）；返回快照 id */
export function saveDesktop(picks: DesktopPick[], name: string | null): Promise<number> {
  return call('desktop.save', { picks, name })
}

/** 按快照恢复所选项目（项目 id 来自快照；Explorer 可只选部分标签）。不删除快照 */
export function restoreDesktop(
  snapshotId: number,
  picks: DesktopRestorePick[]
): Promise<DesktopRestoreResult> {
  return call('desktop.restore', { snapshotId, picks })
}

/** 删除全部快照（恢复后经用户确认）；主进程随后写一份新的自动快照 */
export function clearDesktop(): Promise<void> {
  return call('desktop.clear', undefined)
}

/** 改名；null 恢复为无名称（按种类显示） */
export function renameDesktop(id: number, name: string | null): Promise<void> {
  return call('desktop.rename', { id, name })
}

export function deleteDesktop(id: number): Promise<void> {
  return call('desktop.delete', { id })
}
