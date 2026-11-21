import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExitGuard } from './exit-guard'

const PROMPT_MS = 30_000
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
    requestExit: vi.fn(),
    closeMain: vi.fn(),
    saveExit: vi.fn<(save: boolean, keys: string[]) => Promise<void>>(async () => undefined),
    currentKeys: () => ['k1', 'k2'],
    now: () => Date.now(),
    promptTimeoutMs: PROMPT_MS,
    sessionFreezeMs: FREEZE_MS,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  }
  const guard = new ExitGuard(deps)
  return { guard, deps, state }
}

describe('ExitGuard', () => {
  it('询问开启且渲染端存活：拦截并请求一次；exit 后保存、关闭，之后的 close 不再拦截', async () => {
    const t = setup()
    expect(t.guard.onClose()).toBe(true)
    expect(t.deps.requestExit).toHaveBeenCalledTimes(1)
    // 询问中再次关闭：继续拦截，不重复请求
    expect(t.guard.onClose()).toBe(true)
    expect(t.deps.requestExit).toHaveBeenCalledTimes(1)

    await t.guard.exit({ save: true, keys: ['k1'], dontAskAgain: true })
    expect(t.deps.setAskOnExit).toHaveBeenCalledWith(false)
    expect(t.deps.saveExit).toHaveBeenCalledWith(true, ['k1'])
    expect(t.deps.closeMain).toHaveBeenCalledTimes(1)
    expect(t.guard.onClose()).toBe(false)
  })

  it('cancelExit 清除挂起状态，下次关闭重新询问', () => {
    const t = setup()
    t.guard.onClose()
    t.guard.cancel()
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
      () => new Promise<undefined>((r) => (release = () => r(undefined)))
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
    await vi.advanceTimersByTimeAsync(PROMPT_MS * 2)
    expect(t.deps.saveExit).not.toHaveBeenCalled()
  })

  it('30 秒内没有回应：按全部保存并退出处理', async () => {
    const t = setup()
    t.guard.onClose()
    await vi.advanceTimersByTimeAsync(PROMPT_MS - 1)
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

  it('cancel 后计时取消', async () => {
    const t = setup()
    t.guard.onClose()
    t.guard.cancel()
    await vi.advanceTimersByTimeAsync(PROMPT_MS * 2)
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
    await vi.advanceTimersByTimeAsync(FREEZE_MS)
    expect(t.guard.onClose()).toBe(true)
  })

  it('询问中收到会话结束：取消询问，不再拦截', async () => {
    const t = setup()
    t.guard.onClose()
    t.guard.sessionEnding()
    expect(t.guard.onClose()).toBe(false)
    await vi.advanceTimersByTimeAsync(PROMPT_MS)
    expect(t.deps.saveExit).not.toHaveBeenCalled()
  })

  it('session-end 之后一直不拦截', async () => {
    const t = setup()
    t.guard.sessionEnded()
    await vi.advanceTimersByTimeAsync(FREEZE_MS * 2)
    expect(t.guard.onClose()).toBe(false)
  })
})
