import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesktopSnapshot } from '@pch/shared'
import { call, subscribe } from '@renderer/lib/ipc'

/**
 * 启动时的恢复候选：主窗口挂载后只调用一次 desktop.restorePrompt（主进程每次启动只返回一次，
 * StrictMode 的重复挂载不能再调用）。候选为 null（没有可提示的）或调用失败时不显示
 */
export function useRestorePrompt(): { snapshot: DesktopSnapshot | null; dismiss: () => void } {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null)
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    call('desktop.restorePrompt', undefined).then(
      (s) => setSnapshot(s),
      () => undefined
    )
  }, [])
  const dismiss = useCallback(() => setSnapshot(null), [])
  return { snapshot, dismiss }
}

/**
 * 退出询问（desktop.exitRequested）：收到后打开对话框，显示后立即调用 desktop.exitShown。
 * 对话框已开着时再次收到请求（用户又点了关闭），也要再调一次（主进程每次重发都重新开始确认计时）。
 * desktop.exitCancelled：主进程取消了询问，关闭对话框（不调用任何 IPC）
 */
export function useExitRequest(): { open: boolean; close: () => void } {
  const [open, setOpen] = useState(false)
  // 每收到一次请求加一；对话框渲染提交后的 effect 中调用 exitShown
  const [requests, setRequests] = useState(0)
  useEffect(() => {
    const offRequested = subscribe('desktop.exitRequested', () => {
      setOpen(true)
      setRequests((n) => n + 1)
    })
    const offCancelled = subscribe('desktop.exitCancelled', () => setOpen(false))
    return () => {
      offRequested()
      offCancelled()
    }
  }, [])
  useEffect(() => {
    if (requests === 0) return
    call('desktop.exitShown', undefined).catch(() => undefined)
  }, [requests])
  const close = useCallback(() => setOpen(false), [])
  return { open, close }
}
