/** 桌面记录（M3）的共享类型 */

/** 采集器种类 */
export const DESKTOP_COLLECTORS = ['explorer', 'office', 'vscode', 'eclipse'] as const
export type DesktopCollector = (typeof DESKTOP_COLLECTORS)[number]

/** 窗口位置与大小（屏幕坐标） */
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export type OfficeApp = 'word' | 'excel' | 'powerpoint'

/** 桌面上的一个可恢复项目 */
export type DesktopItem =
  | { kind: 'explorer'; tabs: string[]; bounds: WindowBounds | null } // 路径或 `::{CLSID}`，按标签顺序
  | { kind: 'office'; app: OfficeApp; path: string; readOnly: boolean; exe: string }
  | { kind: 'vscode'; target: string; exe: string; bounds: WindowBounds | null } // 本地路径、.code-workspace 路径或 vscode-remote:// URI
  | { kind: 'eclipse'; workspace: string; exe: string; bounds: WindowBounds | null }

/** 快照的种类：auto 自动 / manual 手动 / exit 退出时保存 / exit-none 退出时选择了不保存 */
export type DesktopSnapshotKind = 'auto' | 'manual' | 'exit' | 'exit-none'

export interface DesktopSnapshotSummary {
  id: number
  kind: DesktopSnapshotKind
  createdAt: number
  logonAt: number
  name: string | null
  /** 项目数：Explorer 每个标签算一项（desktopEntryCount） */
  itemCount: number
}

export interface DesktopSnapshotItem {
  id: number
  item: DesktopItem
}

export interface DesktopSnapshot extends DesktopSnapshotSummary {
  items: DesktopSnapshotItem[]
}

/** 现场：当前桌面上开着的项目；unreadable 为本轮无法读取的采集器 */
export interface DesktopCurrent {
  /** 本次登录的时刻（与快照的 logonAt 不同 = 重启前的快照） */
  logonAt: number
  /** 第一次完整读取已完成（之前 items 不完整；退出对话框据此显示加载中） */
  ready: boolean
  items: { key: string; item: DesktopItem }[]
  unreadable: DesktopCollector[]
}

export type DesktopSkipReason = 'open' | 'missing' | 'unreachable' | 'failed'

export interface DesktopRestoreResult {
  launched: number
  skipped: { itemId: number; reason: DesktopSkipReason }[]
}

/**
 * 保存 / 退出时选中的现场项目：key 为现场项目的 key；tabs 只对 Explorer 有效，
 * 为选中标签的下标（按原顺序保留，越界忽略，一个都不剩时不保存该窗口）；省略 = 整个项目
 */
export interface DesktopPick {
  key: string
  tabs?: number[] | undefined
}

/** 恢复时选中的快照项目：id 为快照项目 id；tabs 同 DesktopPick */
export interface DesktopRestorePick {
  id: number
  tabs?: number[] | undefined
}
