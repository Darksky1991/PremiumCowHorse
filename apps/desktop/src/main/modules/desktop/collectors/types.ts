import type { DesktopCollector, DesktopItem } from '@pch/shared'
import type { WindowInfo } from '../window-list'

/** 某一类窗口的详情采集器 */
export interface Collector {
  readonly id: DesktopCollector
  /** windows 为本轮属于该类的窗口；失败（超时、脚本错误、解析失败）时 reject */
  collect(windows: WindowInfo[]): Promise<DesktopItem[]>
}
