/**
 * 桌面记录的时序与保留数值（设计 5.2–5.4；集中在这里，组合根按此组装）。
 * 恢复相关的数值（项目间隔、存在性检查超时）在 restore.ts
 */
export const DESKTOP_TIMINGS = {
  /** 窗口枚举间隔 */
  pollMs: 5000,
  /** 标题 / 窗口集合变化后到采集的防抖 */
  debounceMs: 2000,
  /** VS Code 标题随编辑频繁变化，防抖更长 */
  debounceOverrides: { vscode: 10_000 },
  /** 全部类别完整读取的兜底间隔 */
  fullRefreshMs: 300_000,
  /** 单次采集的超时 */
  collectorTimeoutMs: 10_000,
  /** 消失后持续这么久才从现场移除 */
  removeAfterMs: 60_000,
  /** 自动保存间隔 */
  autoSaveMs: 300_000,
  /** 自动记录保留最近几份 */
  keepAuto: 20,
  /** 另外保留最近几次登录各自的最后一份自动记录 */
  keepLogons: 10,
  /** query-session-end 后冻结现场、暂停自动保存的时长；到期视为关机被取消 */
  sessionFreezeMs: 300_000,
  /**
   * 发出 desktop.exitRequested 后等待 desktop.exitShown（渲染端已显示对话框）的上限；
   * 到期按「全部保存并退出」处理。收到 exitShown 后无限等待用户回答
   */
  exitShownTimeoutMs: 10_000
} as const
