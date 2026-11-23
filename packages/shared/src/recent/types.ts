/** 最近使用（M5）：按工作区记录「明确打开」的文件与目录，供命令面板显示 */
export interface RecentItem {
  uri: string
  kind: 'file' | 'directory'
  title: string
  /** 最近一次打开的时间（毫秒） */
  openedAt: number
}

/** 每个工作区保留的条数（超出时删除最旧的） */
export const RECENT_KEEP = 100
