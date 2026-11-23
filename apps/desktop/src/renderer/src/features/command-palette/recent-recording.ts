import { recordRecent } from '@renderer/data/recent'
import { reportError } from '@renderer/lib/report-error'
import { useTabsStore } from '@renderer/stores/tabs-store'

/** recent.record 契约中 title 的上限（packages/shared 的 contract） */
export const RECENT_TITLE_MAX = 500

type RecordFn = (
  workspaceId: string,
  item: { uri: string; kind: 'file' | 'directory'; title: string }
) => Promise<void>

/**
 * 订阅 tabs-store 的 recentSignal（D1：只有明确的打开才发信号），命中时调用 record；返回取消订阅函数。
 * 只记文件与目录；title 截到契约上限（超长的文件名不能让 IPC 校验失败而丢掉记录）
 */
export function startRecentRecording(
  record: RecordFn = recordRecent,
  onError: (e: unknown) => void = reportError
): () => void {
  return useTabsStore.subscribe((s, prev) => {
    const signal = s.recentSignal
    if (signal.seq === prev.recentSignal.seq) return
    const { workspaceId, location } = signal
    if (workspaceId === null || location === null) return
    if (location.kind !== 'file' && location.kind !== 'directory') return
    record(workspaceId, {
      uri: location.uri,
      kind: location.kind,
      title: location.title.slice(0, RECENT_TITLE_MAX)
    }).catch(onError)
  })
}
