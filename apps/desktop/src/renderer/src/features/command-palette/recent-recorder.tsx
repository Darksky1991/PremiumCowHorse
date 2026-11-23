import { useEffect } from 'react'
import { recordRecent } from '@renderer/data/recent'
import { reportError } from '@renderer/lib/report-error'
import { useTabsStore } from '@renderer/stores/tabs-store'

/**
 * 订阅 tabs-store 的 recentSignal（D1：只有明确的打开才发信号），把位置记入最近使用。
 * 不渲染任何内容；挂在 app.tsx。store 不调 IPC，所以由这里转成 recent.record
 */
export function RecentRecorder(): null {
  useEffect(
    () =>
      useTabsStore.subscribe((s, prev) => {
        const signal = s.recentSignal
        if (signal.seq === prev.recentSignal.seq) return
        const { workspaceId, location } = signal
        if (workspaceId === null || location === null) return
        if (location.kind !== 'file' && location.kind !== 'directory') return
        recordRecent(workspaceId, {
          uri: location.uri,
          kind: location.kind,
          title: location.title
        }).catch(reportError)
      }),
    []
  )
  return null
}
