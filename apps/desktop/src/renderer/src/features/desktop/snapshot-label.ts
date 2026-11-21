import type {
  DesktopRestoreResult,
  DesktopSkipReason,
  DesktopSnapshotKind,
  DesktopSnapshotSummary
} from '@pch/shared'

/** 种类的文案键（命名空间 desktop 内） */
export function kindKey(kind: DesktopSnapshotKind): string {
  return kind === 'exit-none' ? 'kind.exitNone' : `kind.${kind}`
}

/** 快照时刻的显示（按界面语言） */
export function formatSnapshotTime(ms: number, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(ms)
}

/**
 * 「本次登录」的登录时刻：渲染端不知道，取列表中最大的 logonAt
 * （本次登录至少有一份记录之前，最大值是上一次登录，「重启前」标记不会出现——可接受）
 */
export function latestLogonAt(snapshots: readonly DesktopSnapshotSummary[]): number | null {
  return snapshots.reduce<number | null>(
    (max, s) => (max === null || s.logonAt > max ? s.logonAt : max),
    null
  )
}

/** 「重启前」：该快照属于比 latest 更早的登录 */
export function isBeforeRestart(snapshot: DesktopSnapshotSummary, latest: number | null): boolean {
  return latest !== null && snapshot.logonAt < latest
}

const SKIP_ORDER: readonly DesktopSkipReason[] = ['open', 'missing', 'unreachable', 'failed']

/** 恢复结果中被跳过的项目按原因计数（只含出现过的原因，顺序固定） */
export function skippedByReason(
  result: DesktopRestoreResult
): { reason: DesktopSkipReason; count: number }[] {
  return SKIP_ORDER.flatMap((reason) => {
    const count = result.skipped.filter((s) => s.reason === reason).length
    return count > 0 ? [{ reason, count }] : []
  })
}

/** 快照标签 / 页面的标题：「时间 名称或种类」 */
export function snapshotTitle(
  snapshot: DesktopSnapshotSummary,
  t: (key: string) => string,
  language: string
): string {
  const label = snapshot.name ?? t(`desktop:${kindKey(snapshot.kind)}`)
  return `${formatSnapshotTime(snapshot.createdAt, language)} ${label}`
}
