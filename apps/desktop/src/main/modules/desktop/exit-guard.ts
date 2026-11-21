import type { Logger } from '../../infra/logger'

export interface ExitGuardDeps {
  /** 桌面记录是否在监控（不监控时不拦截） */
  enabled: () => boolean
  /** 设置 desktop.askOnExit */
  askOnExit: () => boolean
  setAskOnExit: (value: false) => Promise<void>
  /** 主窗口的渲染端存活（webContents 未销毁且未崩溃） */
  rendererAlive: () => boolean
  /** 向主窗口发 desktop.exitRequested */
  requestExit: () => void
  /** 关闭主窗口（之后的 close 不再拦截） */
  closeMain: () => void
  saveExit: (save: boolean, keys: string[]) => Promise<void>
  /** 当前现场全部项目的 key（不再询问 = 全部保存，设计第 8 节） */
  currentKeys: () => string[]
  now: () => number
  /** 发出请求后等待渲染端回应的上限 */
  promptTimeoutMs: number
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
 * - 询问开启且渲染端存活 → 请求渲染端弹对话框；promptTimeoutMs 内没有回应按「全部保存并退出」
 * - 不询问 → 全部保存后关闭
 * - 渲染端崩溃 / 销毁 → 不拦截（before-quit 中照常停止服务）
 * 保存失败也关闭窗口（记日志），不把用户困在应用里
 */
export class ExitGuard {
  private readonly d: ExitGuardDeps
  private phase: Phase = 'idle'
  private quitting = false
  private sessionOver = false
  private sessionEndingUntil = 0
  private promptTimer: ReturnType<typeof setTimeout> | undefined

  constructor(deps: ExitGuardDeps) {
    this.d = deps
  }

  /** 主窗口 close 事件：返回是否拦截 */
  onClose(): boolean {
    if (this.phase === 'confirmed' || this.quitting || this.sessionClosing()) return false
    // 保存进行中：完成后由守卫关闭
    if (this.phase === 'saving') return true
    if (!this.d.rendererAlive()) {
      this.clearPrompt()
      this.phase = 'idle'
      return false
    }
    if (this.phase === 'asking') return true
    if (!this.d.enabled()) return false
    if (this.d.askOnExit()) {
      this.phase = 'asking'
      this.promptTimer = setTimeout(() => {
        this.promptTimer = undefined
        if (this.phase !== 'asking') return
        this.d.logger.warn(
          `desktop: no answer to the exit prompt in ${this.d.promptTimeoutMs} ms, saving everything`
        )
        void this.finish(true, this.d.currentKeys(), false)
      }, this.d.promptTimeoutMs)
      this.d.requestExit()
    } else {
      void this.finish(true, this.d.currentKeys(), false)
    }
    return true
  }

  /** desktop.exit：只在询问中有效（迟到或多余的调用忽略） */
  async exit(input: { save: boolean; keys: string[]; dontAskAgain: boolean }): Promise<void> {
    if (this.phase !== 'asking') {
      this.d.logger.info(`desktop: ignoring desktop.exit in phase ${this.phase}`)
      return
    }
    await this.finish(input.save, input.keys, input.dontAskAgain)
  }

  /** desktop.cancelExit：清除挂起状态 */
  cancel(): void {
    if (this.phase !== 'asking') return
    this.clearPrompt()
    this.phase = 'idle'
  }

  /** before-quit：之后的 close（app.quit 关闭窗口）不再拦截 */
  quitStarted(): void {
    this.quitting = true
    this.cancel()
  }

  /** query-session-end：sessionFreezeMs 内不拦截（关机中不弹对话框，设计 5.7） */
  sessionEnding(): void {
    this.sessionEndingUntil = Math.max(
      this.sessionEndingUntil,
      this.d.now() + this.d.sessionFreezeMs
    )
    this.cancel()
  }

  /** session-end：会话确实结束，之后一直不拦截 */
  sessionEnded(): void {
    this.sessionOver = true
    this.cancel()
  }

  private sessionClosing(): boolean {
    return this.sessionOver || this.d.now() < this.sessionEndingUntil
  }

  private async finish(save: boolean, keys: string[], dontAskAgain: boolean): Promise<void> {
    this.clearPrompt()
    this.phase = 'saving'
    try {
      if (dontAskAgain) await this.d.setAskOnExit(false)
      await this.d.saveExit(save, keys)
    } catch (e) {
      this.d.logger.error(`desktop: saving on exit failed: ${firstLine(e)}`)
    } finally {
      this.phase = 'confirmed'
      this.d.closeMain()
    }
  }

  private clearPrompt(): void {
    clearTimeout(this.promptTimer)
    this.promptTimer = undefined
  }
}
