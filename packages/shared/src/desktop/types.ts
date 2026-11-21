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
  items: { key: string; item: DesktopItem }[]
  unreadable: DesktopCollector[]
}

export type DesktopSkipReason = 'open' | 'missing' | 'unreachable' | 'failed'

export interface DesktopRestoreResult {
  launched: number
  skipped: { itemId: number; reason: DesktopSkipReason }[]
}
