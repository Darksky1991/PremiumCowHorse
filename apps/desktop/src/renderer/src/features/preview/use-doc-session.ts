import { useEffect, useState, useSyncExternalStore } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '@pch/shared'
import { docEvents } from '@renderer/data/doc'
import { call } from '@renderer/lib/ipc'
import { isWindowFocused, subscribeWindowFocus } from '@renderer/lib/window-focus'
import { onTabRefresh, useTabsStore } from '@renderer/stores/tabs-store'
import { createDocSession, type DocSession } from './doc-session'

/**
 * 标签内容的 PreviewHost.doc（doc-session.ts）：在标签内容存续期间保持同一个对象
 * （宿主随设置、断开状态等重建时插件不必重新打开文档），卸载时关闭仍打开的文档。
 * 自动刷新的条件 = 本标签是其工作区的激活标签 且 窗口聚焦；间隔取 cache.interval.focus.*（秒）。
 */
export function useDocSession(tabId: string, settings: Settings | undefined): DocSession {
  const [session] = useState(() =>
    createDocSession({
      invoke: call,
      events: docEvents,
      onRefresh: (listener) => onTabRefresh(tabId, listener)
    })
  )
  const tabActive = useTabsStore((s) =>
    Object.values(s.byWorkspace).some((w) => w.activeId === tabId)
  )
  const focused = useSyncExternalStore(subscribeWindowFocus, isWindowFocused)
  const localSec = (settings ?? DEFAULT_SETTINGS)['cache.interval.focus.local']
  const networkSec = (settings ?? DEFAULT_SETTINGS)['cache.interval.focus.network']

  useEffect(() => {
    session.setIntervals({ localMs: localSec * 1000, networkMs: networkSec * 1000 })
  }, [session, localSec, networkSec])
  useEffect(() => {
    session.setActive(tabActive && focused)
    return () => session.setActive(false)
  }, [session, tabActive, focused])
  useEffect(() => () => session.dispose(), [session])
  return session
}
