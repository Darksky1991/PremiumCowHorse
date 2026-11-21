import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExitGuard } from './exit-guard'

const SHOWN_MS = 10_000
const FREEZE_MS = 300_000

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- 测试夹具，返回类型由推断得出
function setup(opts: { ask?: boolean; alive?: boolean; enabled?: boolean } = {}) {
  const state = { ask: opts.ask ?? true, alive: opts.alive ?? true, enabled: opts.enabled ?? true }
  const deps = {
    enabled: () => state.enabled,
    askOnExit: () => state.ask,
    setAskOnExit: vi.fn(async (v: boolean) => {
      state.ask = v
    }),
    rendererAlive: () => state.alive,
    focusMain: vi.fn(),
    requestExit: vi.fn(),
    notifyCancelled: vi.fn(),
    closeMain: vi.fn(),
    saveExit: vi.fn<(save: boolean, keys: string[]) => Promise<void>>(async () => undefined),
    currentKeys: () => ['k1', 'k2'],
    now: () => Date.now(),
    shownTimeoutMs: SHOWN_MS,
    sessionFreezeMs: FREEZE_MS,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  }
  const guard = new ExitGuard(deps)
  return { guard, deps, state }
}

describe('ExitGuard', () => {
  it('询问开启且渲染端存活：先聚焦再请求；exit 后保存、关闭，之后的 close 不再拦截', async () => {
    const t = setup()
    expect(t.guard.onClose()).toBe(true)
    expect(t.deps.requestExit).toHaveBeenCalledTimes(1)
    expect(t.deps.focusMain).toHaveBeenCalledTimes(1)
    expect(t.deps.focusMain.mock.invocationCallOrder[0]).toBeLessThan(
      t.deps.requestExit.mock.invocationCallOrder[0]!
    )

    t.guard.shown()
    await t.guard.exit({ save: true, keys: ['k1'], dontAskAgain: true })
    expect(t.deps.setAskOnExit).toHaveBeenCalledWith(false)
    expect(t.deps.saveExit).toHaveBeenCalledWith(true, ['k1'])
    expect(t.deps.closeMain).toHaveBeenCalledTimes(1)
    expect(t.guard.onClose()).toBe(false)
  })

  it('exitShown 之前 10 秒超时：按全部保存并退出处理', async () => {
    const t = setup()
    t.guard.onClose()
    await vi.advanceTimersByTimeAsync(SHOWN_MS - 1)
    expect(t.deps.saveExit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(t.deps.saveExit).toHaveBeenCalledWith(true, ['k1', 'k2'])
    expect(t.deps.closeMain).toHaveBeenCalledTimes(1)
    expect(t.deps.logger.warn).toHaveBeenCalled()
    // 迟到的回应被忽略
    await t.guard.exit({ save: false, keys: [], dontAskAgain: true })
    expect(t.deps.saveExit).toHaveBeenCalledTimes(1)
    expect(t.deps.setAskOnExit).not.toHaveBeenCalled()
  })

  it('exitShown 之后不超时，无限等待用户回答', async () => {
    const t = setup()
    t.guard.onClose()
    t.guard.shown()
    await vi.advanceTimersByTimeAsync(SHOWN_MS * 100)
    expect(t.deps.saveExit).not.toHaveBeenCalled()
    expect(t.deps.closeMain).not.toHaveBeenCalled()
    await t.guard.exit({ save: false, keys: [], dontAskAgain: false })
    expect(t.deps.saveExit).toHaveBeenCalledWith(false, [])
    expect(t.deps.closeMain).toHaveBeenCalledTimes(1)
  })

  it('询问中再次关闭：重发请求、重新聚焦并重新开始 10 秒确认计时', async () => {
    const t = setup()
    t.guard.onClose()
    t.guard.shown()
    await vi.advanceTimersByTimeAsync(SHOWN_MS * 3)
    expect(t.guard.onClose()).toBe(true)
    expect(t.deps.requestExit).toHaveBeenCalledTimes(2)
    expect(t.deps.focusMain).toHaveBeenCalledTimes(2)
    // 重发后没有 exitShown：10 秒后保存退出
    await vi.advanceTimersByTimeAsync(SHOWN_MS)
    expect(t.deps.saveExit).toHaveBeenCalledWith(true, ['k1', 'k2'])
    expect(t.deps.closeMain).toHaveBeenCalledTimes(1)
  })

  it('页面重新加载 / 渲染进程退出：询问回到 idle，计时取消，下次关闭重新询问', async () => {
    const t = setup()
    t.guard.onClose()
    t.guard.rendererReset()
    await vi.advanceTimersByTimeAsync(SHOWN_MS * 2)
    expect(t.deps.saveExit).not.toHaveBeenCalled()
    await t.guard.exit({ save: true, keys: [], dontAskAgain: false })
    expect(t.deps.saveExit).not.toHaveBeenCalled()
    expect(t.guard.onClose()).toBe(true)
    expect(t.deps.requestExit).toHaveBeenCalledTimes(2)
    // 渲染端自己重置，不需要 exitCancelled
    expect(t.deps.notifyCancelled).not.toHaveBeenCalled()
  })

  it('cancelExit 清除挂起状态与计时，下次关闭重新询问', async () => {
    const t = setup()
    t.guard.onClose()
    t.guard.cancel()
    await vi.advanceTimersByTimeAsync(SHOWN_MS * 2)
    expect(t.deps.saveExit).not.toHaveBeenCalled()
    expect(t.deps.notifyCancelled).not.toHaveBeenCalled()
    expect(t.guard.onClose()).toBe(true)
    expect(t.deps.requestExit).toHaveBeenCalledTimes(2)
  })

  it('不询问：拦截，全部保存后关闭', async () => {
    const t = setup({ ask: false })
    expect(t.guard.onClose()).toBe(true)
    expect(t.deps.requestExit).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(t.deps.closeMain).toHaveBeenCalledTimes(1))
    expect(t.deps.saveExit).toHaveBeenCalledWith(true, ['k1', 'k2'])
    expect(t.guard.onClose()).toBe(false)
  })

  it('保存中再次关闭：继续拦截（保存完成后由守卫关闭）', async () => {
    const t = setup({ ask: false })
    let release: () => void = () => undefined
    t.deps.saveExit.mockImplementation(
      () => new Promise<void>((r) => (release = () => r(undefined)))
    )
    t.guard.onClose()
    t.state.alive = false
    expect(t.guard.onClose()).toBe(true)
    release()
    await vi.waitFor(() => expect(t.deps.closeMain).toHaveBeenCalledTimes(1))
    expect(t.deps.saveExit).toHaveBeenCalledTimes(1)
  })

  it('渲染端已崩溃 / 销毁：不拦截', () => {
    const t = setup({ alive: false })
    expect(t.guard.onClose()).toBe(false)
    expect(t.deps.requestExit).not.toHaveBeenCalled()
  })

  it('询问中渲染端崩溃：下一次 close 不拦截', () => {
    const t = setup()
    t.guard.onClose()
    t.state.alive = false
    expect(t.guard.onClose()).toBe(false)
  })

  it('监控未启用：不拦截', () => {
    const t = setup({ enabled: false })
    expect(t.guard.onClose()).toBe(false)
  })

  it('退出流程（before-quit）开始后不拦截，询问中的计时也取消', async () => {
    const t = setup()
    t.guard.onClose()
    t.guard.quitStarted()
    expect(t.guard.onClose()).toBe(false)
    await vi.advanceTimersByTimeAsync(SHOWN_MS * 2)
    expect(t.deps.saveExit).not.toHaveBeenCalled()
  })

  it('没有挂起的询问时 exit 被忽略', async () => {
    const t = setup()
    await t.guard.exit({ save: true, keys: [], dontAskAgain: false })
    expect(t.deps.saveExit).not.toHaveBeenCalled()
    expect(t.deps.closeMain).not.toHaveBeenCalled()
  })

  it('保存失败也关闭窗口（不把用户困住）', async () => {
    const t = setup()
    t.deps.saveExit.mockRejectedValueOnce(new Error('db gone'))
    t.guard.onClose()
    await t.guard.exit({ save: true, keys: ['k1'], dontAskAgain: false })
    expect(t.deps.closeMain).toHaveBeenCalledTimes(1)
    expect(t.deps.logger.error).toHaveBeenCalled()
    expect(t.guard.onClose()).toBe(false)
  })

  it('会话结束期间不拦截；冻结 5 分钟后（关机被取消）恢复拦截', async () => {
    const t = setup()
    t.guard.sessionEnding()
    expect(t.guard.onClose()).toBe(false)
    expect(t.deps.notifyCancelled).not.toHaveBeenCalled() // 没有挂起的询问
    await vi.advanceTimersByTimeAsync(FREEZE_MS)
    expect(t.guard.onClose()).toBe(true)
  })

  it('询问中收到会话结束：取消询问并发 exitCancelled，不再拦截', async () => {
    const t = setup()
    t.guard.onClose()
    t.guard.shown()
    t.guard.sessionEnding()
    expect(t.deps.notifyCancelled).toHaveBeenCalledTimes(1)
    expect(t.guard.onClose()).toBe(false)
    await vi.advanceTimersByTimeAsync(SHOWN_MS)
    expect(t.deps.saveExit).not.toHaveBeenCalled()
    // 关机被取消后：渲染端已关闭对话框，迟到的回答不生效，重新关闭时重新询问
    await vi.advanceTimersByTimeAsync(FREEZE_MS)
    await t.guard.exit({ save: true, keys: [], dontAskAgain: false })
    expect(t.deps.saveExit).not.toHaveBeenCalled()
    expect(t.guard.onClose()).toBe(true)
    expect(t.deps.requestExit).toHaveBeenCalledTimes(2)
  })

  it('session-end 之后一直不拦截', async () => {
    const t = setup()
    t.guard.sessionEnded()
    await vi.advanceTimersByTimeAsync(FREEZE_MS * 2)
    expect(t.guard.onClose()).toBe(false)
  })
})
