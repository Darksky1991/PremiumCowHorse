import { useEffect } from 'react'
import { startRecentRecording } from './recent-recording'

/**
 * 不渲染任何内容；挂在 app.tsx。store 不调 IPC，所以由这里转成 recent.record
 */
export function RecentRecorder(): null {
  useEffect(() => startRecentRecording(), [])
  return null
}
