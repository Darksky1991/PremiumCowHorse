import type { TFunction } from 'i18next'
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

/** 「重启前」：快照属于另一次登录（logonAt 为 desktop.current 返回的本次登录时刻；未取得时没有标记） */
export function isBeforeRestart(snapshot: DesktopSnapshotSummary, logonAt: number | null): boolean {
  return logonAt !== null && snapshot.logonAt !== logonAt
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
  t: TFunction,
  language: string
): string {
  const label = snapshot.name ?? t(`desktop:${kindKey(snapshot.kind)}`)
  return `${formatSnapshotTime(snapshot.createdAt, language)} ${label}`
}

/**
 * 恢复结果的汇总消息（快照页与启动时的恢复对话框共用）：
 * 全部启动 = success，部分跳过 = info，一项也没启动 = warning
 */
export function restoreSummary(
  result: DesktopRestoreResult,
  t: TFunction,
  language: string
): { level: 'success' | 'info' | 'warning'; message: string } {
  const skipped = skippedByReason(result)
  const details = new Intl.ListFormat(language, { style: 'narrow', type: 'unit' }).format(
    skipped.map(({ reason, count }) => t(`desktop:skipReason.${reason}`, { count }))
  )
  const parts = [
    result.launched > 0
      ? t('desktop:restored', { count: result.launched })
      : t('desktop:restoredNone'),
    ...(skipped.length > 0 ? [t('desktop:skipped', { details })] : [])
  ]
  return {
    level: skipped.length === 0 ? 'success' : result.launched === 0 ? 'warning' : 'info',
    message: parts.join(' / ')
  }
}
