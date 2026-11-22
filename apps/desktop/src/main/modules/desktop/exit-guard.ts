import type { DesktopPick } from '@pch/shared'
import type { Logger } from '../../infra/logger'

export interface ExitGuardDeps {
  /** 桌面记录是否在监控（不监控时不拦截） */
  enabled: () => boolean
  /** 设置 desktop.askOnExit */
  askOnExit: () => boolean
  setAskOnExit: (value: false) => Promise<void>
  /** 主窗口的渲染端存活（webContents 未销毁且未崩溃） */
  rendererAlive: () => boolean
  /** 让主窗口可见并获得焦点（最小化时先还原），对话框才看得见 */
  focusMain: () => void
  /** 向主窗口发 desktop.exitRequested */
  requestExit: () => void
  /** 向主窗口发 desktop.exitCancelled（主进程取消了挂起的询问，渲染端关闭对话框） */
  notifyCancelled: () => void
  /** 关闭主窗口（之后的 close 不再拦截） */
  closeMain: () => void
  saveExit: (save: boolean, picks: DesktopPick[]) => Promise<void>
  /** 当前现场的全部项目（不再询问 = 全部保存，设计第 8 节） */
  currentPicks: () => DesktopPick[]
  now: () => number
  /** 发出请求后等待 desktop.exitShown 的上限；到期视为渲染端无法显示对话框 */
  shownTimeoutMs: number
  /** query-session-end 后不拦截的时长（与现场冻结相同；到期视为关机被取消） */
  sessionFreezeMs: number
  logger: Logger
}

type Phase = 'idle' | 'asking' | 'saving' | 'confirmed'

const firstLine = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).split(/\r?\n/)[0] ?? ''

/**
 * 主窗口关闭时的「退出时保存」流程（设计 5.7、第 8 节）。只管状态，不碰 Electron：
 * onClose 返回 true 时调用方 preventDefault。
 * - 已确认退出、退出流程（before-quit）已开始、会话结束中 → 不拦截（不会出现关不掉 / 死循环）
 * - 询问开启且渲染端存活 → 聚焦主窗口并请求渲染端弹对话框；shownTimeoutMs 内没有 desktop.exitShown
 *   → 按「全部保存并退出」（渲染端卡住时窗口仍能关闭）；收到 exitShown 后无限等待用户回答
 * - 询问中再次关闭 → 重发请求并重新计时（对话框没出来时用户还能再点一次）
 * - 页面重新加载 / 渲染进程退出 → 询问作废（回到 idle）
 * - 不询问 → 全部保存后关闭；渲染端崩溃 / 销毁 → 不拦截（before-quit 中照常停止服务）
 * 保存失败也关闭窗口（记日志），不把用户困在应用里
 */
export class ExitGuard {
  private readonly d: ExitGuardDeps
  private phase: Phase = 'idle'
  private quitting = false
  private sessionOver = false
  private sessionEndingUntil = 0
  private shownTimer: ReturnType<typeof setTimeout> | undefined

  constructor(deps: ExitGuardDeps) {
    this.d = deps
  }

  /** 主窗口 close 事件：返回是否拦截 */
  onClose(): boolean {
    if (this.phase === 'confirmed' || this.quitting || this.sessionClosing()) return false
    // 保存进行中：完成后由守卫关闭
    if (this.phase === 'saving') return true
    if (!this.d.rendererAlive()) {
      this.reset()
      return false
    }
    if (this.phase === 'asking') {
      this.request()
      return true
    }
    if (!this.d.enabled()) return false
    if (this.d.askOnExit()) {
      this.phase = 'asking'
      this.request()
    } else {
      void this.finish(true, this.d.currentPicks(), false)
    }
    return true
  }

  /** desktop.exitShown：渲染端已显示对话框，之后不再超时 */
  shown(): void {
    if (this.phase === 'asking') this.clearTimer()
  }

  /** desktop.exit：只在询问中有效（迟到或多余的调用忽略） */
  async exit(input: { save: boolean; picks: DesktopPick[]; dontAskAgain: boolean }): Promise<void> {
    if (this.phase !== 'asking') {
      this.d.logger.info(`desktop: ignoring desktop.exit in phase ${this.phase}`)
      return
    }
    await this.finish(input.save, input.picks, input.dontAskAgain)
  }

  /** desktop.cancelExit：清除挂起状态（渲染端发起，不必再通知） */
  cancel(): void {
    this.reset()
  }

  /** 主窗口页面重新加载 / 渲染进程退出：对话框已不存在，询问作废 */
  rendererReset(): void {
    this.reset()
  }

  /** before-quit：之后的 close（app.quit 关闭窗口）不再拦截 */
  quitStarted(): void {
    this.quitting = true
    this.abandon()
  }

  /** query-session-end：sessionFreezeMs 内不拦截（关机中不弹对话框，设计 5.7） */
  sessionEnding(): void {
    this.sessionEndingUntil = Math.max(
      this.sessionEndingUntil,
      this.d.now() + this.d.sessionFreezeMs
    )
    this.abandon()
  }

  /** session-end：会话确实结束，之后一直不拦截 */
  sessionEnded(): void {
    this.sessionOver = true
    this.abandon()
  }

  private sessionClosing(): boolean {
    return this.sessionOver || this.d.now() < this.sessionEndingUntil
  }

  /** 聚焦主窗口、发请求，并（重新）开始等待 exitShown 的计时 */
  private request(): void {
    this.clearTimer()
    this.shownTimer = setTimeout(() => {
      this.shownTimer = undefined
      if (this.phase !== 'asking') return
      this.d.logger.warn(
        `desktop: the exit dialog was not shown in ${this.d.shownTimeoutMs} ms, saving everything`
      )
      void this.finish(true, this.d.currentPicks(), false)
    }, this.d.shownTimeoutMs)
    this.d.focusMain()
    this.d.requestExit()
  }

  /** 主进程取消挂起的询问：通知渲染端关闭对话框 */
  private abandon(): void {
    if (this.phase !== 'asking') return
    this.reset()
    this.d.notifyCancelled()
  }

  private reset(): void {
    if (this.phase !== 'asking') return
    this.clearTimer()
    this.phase = 'idle'
  }

  private async finish(save: boolean, picks: DesktopPick[], dontAskAgain: boolean): Promise<void> {
    this.clearTimer()
    this.phase = 'saving'
    try {
      if (dontAskAgain) await this.d.setAskOnExit(false)
      await this.d.saveExit(save, picks)
    } catch (e) {
      this.d.logger.error(`desktop: saving on exit failed: ${firstLine(e)}`)
    } finally {
      this.phase = 'confirmed'
      this.d.closeMain()
    }
  }

  private clearTimer(): void {
    clearTimeout(this.shownTimer)
    this.shownTimer = undefined
  }
}
