import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopCollector, DesktopItem, DesktopRestoreResult } from '@pch/shared'
import type { Logger } from '../../infra/logger'
import { openDatabase, type Database } from '../../infra/db/client'
import { DesktopService, type DesktopMonitorLike, type DesktopServiceDeps } from './desktop.service'
import { LiveState } from './live-state'
import { DesktopSnapshotRepo } from './snapshot.repo'

const noop = (): void => undefined
const silent: Logger = { error: noop, warn: noop, info: noop, debug: noop }

const AUTO_MS = 300_000
const FREEZE_MS = 300_000
const RESCAN_MS = 10_000
const CHANGE_MS = 1_000
const LOGON = 2_000_000
const T0 = 10_000_000

const office = (path: string): DesktopItem => ({
  kind: 'office',
  app: 'word',
  path,
  readOnly: false,
  exe: 'C:\\Office\\WINWORD.EXE'
})
const explorer = (tabs: string[]): DesktopItem => ({ kind: 'explorer', tabs, bounds: null })

const pathsOf = (items: { item: DesktopItem }[]): string[] =>
  items.map(({ item }) => (item.kind === 'office' ? item.path : item.kind))

const dbs: Database[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(dbs.splice(0).map((d) => d.destroy()))
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- 测试夹具，返回类型由推断得出
async function setup(
  opts: {
    initial?: DesktopItem[]
    logonAt?: () => Promise<number>
    noMonitor?: boolean
  } = {}
) {
  const db = await openDatabase(':memory:', silent)
  dbs.push(db)
  const repo = new DesktopSnapshotRepo(db, 'PC')
  const live = new LiveState({ removeAfterMs: 60_000 })
  /** 假 monitor：refreshAll 把 initial 作为 office 类的结果交给 live；enumerateOk 为假时模拟枚举失败 */
  const state = { enumerateOk: true }
  const monitor = {
    start: vi.fn(),
    stop: vi.fn(),
    refreshAll: vi.fn(async () => {
      if (!state.enumerateOk) return false
      live.apply('office', opts.initial ?? [], Date.now())
      return true
    }),
    unreadable: vi.fn((): DesktopCollector[] => [])
  } satisfies DesktopMonitorLike
  const restore = vi.fn(async (): Promise<DesktopRestoreResult> => ({ launched: 0, skipped: [] }))
  const emit = vi.fn()
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  const deps: DesktopServiceDeps = {
    repo,
    monitor: opts.noMonitor ? null : monitor,
    live,
    restore,
    logonAt: opts.logonAt ?? (async () => LOGON),
    now: () => Date.now(),
    emit,
    autoSaveMs: AUTO_MS,
    changeSaveDelayMs: CHANGE_MS,
    keepVisible: 3,
    restoreRescanMs: RESCAN_MS,
    sessionFreezeMs: FREEZE_MS,
    logger
  }
  const service = new DesktopService(deps)
  /** 同一数据库上的另一个服务实例（模拟重启本应用 / 下一次登录）；logonAt 可换 */
  const another = (logonAt: number = LOGON): DesktopService =>
    new DesktopService({ ...deps, logonAt: async () => logonAt })
  /** 设置 office 类的当前结果（相当于一次采集） */
  const setOpen = (items: DesktopItem[]): boolean => live.apply('office', items, Date.now())
  const autos = async (): Promise<{ id: number; itemCount: number; logonAt: number }[]> =>
    (await repo.list()).filter((s) => s.kind === 'auto')
  return {
    db,
    repo,
    live,
    monitor,
    state,
    restore,
    emit,
    logger,
    service,
    another,
    setOpen,
    autos
  }
}

describe('DesktopService', () => {
  it('start 后立即有一份本次登录的 auto（含 refreshAll 的结果）', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    expect(t.monitor.start).toHaveBeenCalledTimes(1)
    expect(t.monitor.refreshAll).toHaveBeenCalledTimes(1)
    const autos = await t.autos()
    expect(autos).toHaveLength(1)
    expect(autos[0]).toMatchObject({ itemCount: 1, logonAt: LOGON })
    expect(pathsOf((await t.repo.get(autos[0]!.id))!.items)).toEqual(['C:\\a.docx'])
    expect(t.emit).toHaveBeenCalledWith({ scope: 'snapshots' })
    t.service.stop()
  })

  it('retained 不变时 autoSaveMs 到期不写；变化后原地更新同一份 auto', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const [first] = await t.autos()
    await vi.advanceTimersByTimeAsync(AUTO_MS)
    expect(await t.autos()).toHaveLength(1)

    t.setOpen([office('C:\\a.docx'), office('C:\\b.docx')])
    await vi.advanceTimersByTimeAsync(AUTO_MS)
    t.setOpen([office('C:\\a.docx'), office('C:\\b.docx'), office('C:\\c.docx')])
    await vi.advanceTimersByTimeAsync(AUTO_MS)
    const autos = await t.autos()
    // 同一登录只有一份 auto：id 不变，项目与时间被更新
    expect(autos.map((s) => [s.id, s.itemCount])).toEqual([[first!.id, 3]])
    expect((await t.repo.get(first!.id))!.createdAt).toBe(T0 + AUTO_MS * 3)
    t.service.stop()
  })

  it('auto 被用户删除后，下次自动保存重新写一份', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const [first] = await t.autos()
    await t.service.delete(first!.id)
    t.setOpen([office('C:\\a.docx'), office('C:\\b.docx')])
    await vi.advanceTimersByTimeAsync(AUTO_MS)
    const autos = await t.autos()
    expect(autos).toHaveLength(1)
    expect(autos[0]).toMatchObject({ itemCount: 2 })
    expect(autos[0]!.id).not.toBe(first!.id)
    t.service.stop()
  })

  it('auto 被清理掉（手动快照挤出 3 个）后，自动保存重新写入而不是静默丢失', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(1000)
      await t.service.saveManual([], `m${i}`)
    }
    expect(await t.autos()).toHaveLength(0)
    t.setOpen([office('C:\\a.docx'), office('C:\\b.docx')])
    await vi.advanceTimersByTimeAsync(AUTO_MS)
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([2])
    expect((await t.service.list()).filter((s) => s.kind === 'manual')).toHaveLength(2)
    t.service.stop()
  })

  it('每次写入后保留最新 3 个可见快照；恢复候选受保护', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    const prev = LOGON - 100_000
    const cand = await t.repo.insert({
      kind: 'exit',
      createdAt: 1,
      logonAt: prev,
      items: [office('C:\\z.docx')]
    })
    await t.service.start()
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(1000)
      await t.service.saveManual([], `m${i}`)
    }
    const list = await t.service.list()
    expect(list).toHaveLength(3)
    // 候选（最旧）仍在；auto 已被较新的手动快照挤掉
    expect(list.some((s) => s.id === cand)).toBe(true)
    expect(list.filter((s) => s.kind === 'manual').map((s) => s.name)).toEqual(['m3', 'm2'])
    t.service.stop()
  })

  it('restorePrompt：上一次登录以 exit 结束 → exit 快照（滤掉开着的），只返回一次', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    const prev = LOGON - 100_000
    await t.repo.insert({ kind: 'auto', createdAt: 1, logonAt: prev, items: [office('C:\\x')] })
    const exitId = await t.repo.insert({
      kind: 'exit',
      createdAt: 2,
      logonAt: prev,
      items: [office('C:\\a.docx'), office('C:\\b.docx')]
    })
    await t.service.start()
    const prompt = await t.service.restorePrompt()
    expect(prompt?.id).toBe(exitId)
    // C:\\a.docx 已开着：不提示
    expect(pathsOf(prompt!.items)).toEqual(['C:\\b.docx'])
    expect(await t.service.restorePrompt()).toBeNull()
    t.service.stop()
  })

  it('restorePrompt：候选在写本次快照之前取得；全部开着时为 null', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.repo.insert({
      kind: 'auto',
      createdAt: 1,
      logonAt: LOGON - 1,
      items: [office('C:\\a.docx')]
    })
    await t.service.start()
    expect(await t.service.restorePrompt()).toBeNull()
    t.service.stop()
  })

  it('restorePrompt 在 start 完成前调用时等待 start', async () => {
    let release: () => void = noop
    const t = await setup({
      logonAt: () => new Promise<number>((r) => (release = () => r(LOGON)))
    })
    await t.repo.insert({
      kind: 'auto',
      createdAt: 1,
      logonAt: LOGON - 1,
      items: [office('C:\\z.docx')]
    })
    const starting = t.service.start()
    const prompt = t.service.restorePrompt()
    release()
    await starting
    expect(pathsOf((await prompt)!.items)).toEqual(['C:\\z.docx'])
    t.service.stop()
  })

  it('saveExit(true)：本次登录的 auto 原地改为 exit（只含勾选的项目），该登录只有 1 个可见快照', async () => {
    const t = await setup({ initial: [office('C:\\a.docx'), office('C:\\b.docx')] })
    await t.service.start()
    const [auto] = await t.autos()
    await vi.advanceTimersByTimeAsync(1000)
    await t.service.saveExit(true, [{ key: 'office:c:\\b.docx' }, { key: 'office:c:\\nope' }])
    const all = await t.repo.listByLogon()
    expect(all.map((s) => [s.id, s.kind])).toEqual([[auto!.id, 'exit']])
    const exit = (await t.repo.get(auto!.id))!
    expect(exit.createdAt).toBe(T0 + 1000)
    expect(pathsOf(exit.items)).toEqual(['C:\\b.docx'])
    t.service.stop()
  })

  it('saveExit(true)：auto 已被删除时新写一份 exit', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const [auto] = await t.autos()
    await t.service.delete(auto!.id)
    await t.service.saveExit(true, [{ key: 'office:c:\\a.docx' }])
    const all = await t.repo.listByLogon()
    expect(all.map((s) => [s.kind, s.itemCount])).toEqual([['exit', 1]])
    t.service.stop()
  })

  it('saveExit(false)：删除本次登录的 auto，写 exit-none；手动快照不动', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    await t.service.saveManual([{ key: 'office:c:\\a.docx' }], 'm')
    await t.service.saveExit(false, [{ key: 'office:c:\\a.docx' }])
    const all = await t.repo.listByLogon()
    expect(all.map((s) => [s.kind, s.itemCount])).toEqual([
      ['exit-none', 0],
      ['manual', 1]
    ])
    t.service.stop()
  })

  it('退出保存后下一次登录提示那份 exit（只提示一次）；不保存则不提示', async () => {
    const initial = [office('C:\\a.docx'), office('C:\\b.docx')]
    const t = await setup({ initial })
    await t.service.start()
    const [auto] = await t.autos()
    await t.service.saveExit(true, [{ key: 'office:c:\\b.docx' }])
    t.service.stop()

    // 重启后桌面上什么也没开
    initial.length = 0
    t.setOpen([])
    const next = t.another(LOGON + 1)
    await next.start()
    const prompt = await next.restorePrompt()
    expect(prompt?.id).toBe(auto!.id)
    expect(pathsOf(prompt!.items)).toEqual(['C:\\b.docx'])
    expect(await next.restorePrompt()).toBeNull()
    await next.saveExit(false, [])
    next.stop()

    const third = t.another(LOGON + 2)
    await third.start()
    expect(await third.restorePrompt()).toBeNull()
    third.stop()
  })

  it('同一登录内启动两次（重启本应用）：只有一份 auto，原地更新', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const [first] = await t.autos()
    t.service.stop()
    t.setOpen([office('C:\\a.docx'), office('C:\\b.docx')])
    const again = t.another()
    await again.start()
    const autos = await t.autos()
    expect(autos.map((s) => [s.id, s.itemCount])).toEqual([[first!.id, 2]])
    again.stop()
  })

  it('同一登录内退出保存后再启动：接回那份 exit 当作 auto，该登录仍只占 1 个可见名额', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const [first] = await t.autos()
    await t.service.saveExit(true, [{ key: 'office:c:\\a.docx' }])
    t.service.stop()

    const again = t.another()
    await again.start()
    expect((await t.repo.listByLogon()).map((s) => [s.id, s.kind])).toEqual([[first!.id, 'auto']])
    await again.saveExit(true, [{ key: 'office:c:\\a.docx' }])
    expect((await t.repo.listByLogon()).map((s) => [s.id, s.kind])).toEqual([[first!.id, 'exit']])
    again.stop()
  })

  it('连续两天（每天一次登录 + 退出保存）后手动快照仍在：3 个 = 手动 + 前一天 exit + 当天 exit', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    const DAY = 86_400_000
    // 第 1 天：手动保存一次，退出时保存
    await t.service.start()
    const manual = await t.service.saveManual([{ key: 'office:c:\\a.docx' }], 'm')
    await vi.advanceTimersByTimeAsync(1000)
    await t.service.saveExit(true, [{ key: 'office:c:\\a.docx' }])
    t.service.stop()
    expect((await t.service.list()).map((s) => s.kind)).toEqual(['exit', 'manual'])
    // 第 2 天：新的登录，启动时写本次 auto（3 个），退出时改为 exit（仍 3 个）
    await vi.advanceTimersByTimeAsync(DAY)
    const day2 = t.another(LOGON + DAY)
    await day2.start()
    expect(await t.service.list()).toHaveLength(3)
    await day2.saveExit(true, [{ key: 'office:c:\\a.docx' }])
    day2.stop()
    const list = await t.service.list()
    expect(list.map((s) => [s.kind, s.logonAt])).toEqual([
      ['exit', LOGON + DAY],
      ['exit', LOGON],
      ['manual', LOGON]
    ])
    expect(list.some((s) => s.id === manual)).toBe(true)
    // 第 3 天启动时可见快照为 4 个，按「超过 3 个删除最旧的」最旧的手动快照被删
    // （裁定 15 预期第 3 天后仍保留手动快照，与「删除最旧」矛盾，待控制者确认）
    await vi.advanceTimersByTimeAsync(DAY)
    const day3 = t.another(LOGON + 2 * DAY)
    await day3.start()
    expect((await t.service.list()).map((s) => s.kind)).toEqual(['auto', 'exit', 'exit'])
    day3.stop()
  })

  it('第一次完整读取之前退出保存：不写 exit，本次登录已有的 auto 保留为下次的恢复候选', async () => {
    const initial = [office('C:\\a.docx')]
    const t = await setup({ initial })
    await t.service.start()
    const [auto] = await t.autos()
    t.service.stop()
    // 同一登录内重启，第一次完整读取失败（未就绪）时用户就退出了
    t.state.enumerateOk = false
    const again = t.another()
    await again.start()
    expect(again.current().ready).toBe(false)
    await again.saveExit(true, [])
    expect((await t.repo.listByLogon()).map((s) => [s.id, s.kind, s.itemCount])).toEqual([
      [auto!.id, 'auto', 1]
    ])
    again.stop()
    // 下一次登录：桌面上什么也没开
    t.state.enumerateOk = true
    initial.length = 0
    t.setOpen([])
    const next = t.another(LOGON + 1)
    await next.start()
    expect((await next.restorePrompt())?.id).toBe(auto!.id)
    next.stop()
  })

  it('就绪时广播 current（退出对话框据此结束加载态）', async () => {
    const t = await setup({ initial: [] })
    expect(t.service.current().ready).toBe(false)
    await t.service.start()
    expect(t.service.current().ready).toBe(true)
    expect(t.emit).toHaveBeenCalledWith({ scope: 'current' })
    t.service.stop()
  })

  it('退出开始后不再自动保存 / 写 saveAutoNow，退出快照不被冲掉', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    await t.service.saveExit(true, [{ key: 'office:c:\\a.docx' }])
    t.setOpen([office('C:\\a.docx'), office('C:\\b.docx')])
    await vi.advanceTimersByTimeAsync(AUTO_MS * 2)
    await t.service.querySessionEnd()
    expect((await t.repo.listByLogon()).map((s) => [s.kind, s.itemCount])).toEqual([['exit', 1]])
    t.service.stop()
  })

  it('恢复进行中开始退出：恢复完成后不重新扫描，clear 也不做（exit 保留）', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const id = await t.service.saveManual([{ key: 'office:c:\\a.docx' }], 'm')
    let finish: () => void = noop
    t.restore.mockImplementationOnce(
      () =>
        new Promise<DesktopRestoreResult>((r) => (finish = () => r({ launched: 1, skipped: [] })))
    )
    const restoring = t.service.restore(id, [])
    await vi.advanceTimersByTimeAsync(0)
    await t.service.saveExit(true, [{ key: 'office:c:\\a.docx' }])
    t.monitor.refreshAll.mockClear()
    finish()
    expect(await restoring).toEqual({ launched: 1, skipped: [] })
    await vi.advanceTimersByTimeAsync(RESCAN_MS * 2)
    expect(t.monitor.refreshAll).not.toHaveBeenCalled()
    await t.service.clear()
    expect((await t.repo.listByLogon()).map((s) => s.kind).sort()).toEqual(['exit', 'manual'])
    t.service.stop()
  })

  it('saveManual：当前现场中 key 在列表里的项目，带名称', async () => {
    const t = await setup({ initial: [office('C:\\a.docx'), office('C:\\b.docx')] })
    await t.service.start()
    t.emit.mockClear()
    const id = await t.service.saveManual([{ key: 'office:c:\\a.docx' }], 'mine')
    const snap = (await t.service.get(id))!
    expect(snap).toMatchObject({ kind: 'manual', name: 'mine', logonAt: LOGON })
    expect(pathsOf(snap.items)).toEqual(['C:\\a.docx'])
    expect(t.emit).toHaveBeenCalledWith({ scope: 'snapshots' })
    t.service.stop()
  })

  it('saveAutoNow 不比较、立即写出 retained（含消失未满 1 分钟的）', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    t.setOpen([])
    await t.service.saveAutoNow()
    const autos = await t.autos()
    expect(autos.map((s) => s.itemCount)).toEqual([1])
    t.service.stop()
  })

  it('stop 后计时不再写', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    t.service.stop()
    expect(t.monitor.stop).toHaveBeenCalled()
    t.setOpen([office('C:\\b.docx')])
    await vi.advanceTimersByTimeAsync(AUTO_MS * 3)
    expect(await t.autos()).toHaveLength(1)
  })

  it('idle 等待进行中的写入', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const writing = t.service.saveAutoNow()
    t.service.stop()
    await t.service.idle()
    expect(await t.autos()).toHaveLength(1)
    await writing
  })

  it('query-session-end 后 5 分钟内全部消失也不写缩水的自动记录，5 分钟后恢复', async () => {
    const t = await setup({ initial: [office('C:\\a.docx'), office('C:\\b.docx')] })
    await t.service.start()
    await vi.advanceTimersByTimeAsync(AUTO_MS - 10_000) // 距下一次自动保存 10 秒
    await t.service.querySessionEnd()
    // 收到通知时立即写一份（不比较）
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([2])

    // 其他程序在关机过程中全部关闭
    await vi.advanceTimersByTimeAsync(5_000)
    t.setOpen([])
    // 冻结期内：经过多个自动保存周期与远超 1 分钟的移除时间，也不写缩水的记录
    await vi.advanceTimersByTimeAsync(FREEZE_MS - 5_000 - 1)
    t.setOpen([])
    expect((await t.autos()).every((s) => s.itemCount === 2)).toBe(true)
    expect(t.live.retained(Date.now())).toHaveLength(2)

    // 5 分钟后视为关机被取消：恢复移除计时与自动保存
    await vi.advanceTimersByTimeAsync(60_000 + AUTO_MS)
    t.setOpen([])
    await vi.advanceTimersByTimeAsync(AUTO_MS)
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([0])
    t.service.stop()
  })

  it('冻结期内现场有变化也暂停自动保存，到期后恢复', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    await vi.advanceTimersByTimeAsync(10_000) // 冻结期内会经过一次自动保存（T0 + 300 s）
    await t.service.querySessionEnd()
    t.setOpen([office('C:\\a.docx'), office('C:\\b.docx')])
    await vi.advanceTimersByTimeAsync(FREEZE_MS - 1)
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([1])
    await vi.advanceTimersByTimeAsync(AUTO_MS)
    expect((await t.autos())[0]!.itemCount).toBe(2)
    t.service.stop()
  })

  it('liveChanged：现场变化后 changeSaveDelayMs 内写入（多次变化合并为一次），不等自动保存周期', async () => {
    const t = await setup({ initial: [office('C:/a.docx')] })
    await t.service.start()
    const update = vi.spyOn(t.repo, 'updateAuto')
    t.setOpen([office('C:/a.docx'), office('C:/b.docx')])
    t.service.liveChanged()
    t.setOpen([office('C:/a.docx'), office('C:/b.docx'), office('C:/c.docx')])
    t.service.liveChanged()
    await vi.advanceTimersByTimeAsync(CHANGE_MS - 1)
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([1])
    await vi.advanceTimersByTimeAsync(1)
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([3])
    expect(update).toHaveBeenCalledTimes(1)
    // 内容没变：不写
    t.service.liveChanged()
    await vi.advanceTimersByTimeAsync(CHANGE_MS)
    expect(update).toHaveBeenCalledTimes(1)
    t.service.stop()
  })

  it('关闭的项目在 removeAfterMs 到期时从自动快照去掉，不等自动保存周期', async () => {
    const t = await setup({ initial: [office('C:/a.docx'), office('C:/b.docx')] })
    await t.service.start()
    t.setOpen([office('C:/a.docx')])
    t.service.liveChanged()
    await vi.advanceTimersByTimeAsync(CHANGE_MS)
    // 1 分钟内仍保留
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([2])
    await vi.advanceTimersByTimeAsync(60_000 - CHANGE_MS - 1)
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([2])
    await vi.advanceTimersByTimeAsync(1)
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([1])
    expect(60_000).toBeLessThan(AUTO_MS)
    t.service.stop()
  })

  it('liveChanged：会话结束冻结期内、退出流程中、第一次完整读取之前都不写', async () => {
    const t = await setup({ initial: [office('C:/a.docx')] })
    t.service.liveChanged() // 尚未 start（未就绪）
    await vi.advanceTimersByTimeAsync(CHANGE_MS)
    expect(await t.autos()).toEqual([])
    await t.service.start()
    await t.service.querySessionEnd()
    t.setOpen([office('C:/a.docx'), office('C:/b.docx')])
    t.service.liveChanged()
    await vi.advanceTimersByTimeAsync(CHANGE_MS)
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([1])
    await t.service.saveExit(true, [{ key: 'office:c:/a.docx' }])
    await vi.advanceTimersByTimeAsync(FREEZE_MS)
    t.setOpen([office('C:/c.docx')])
    t.service.liveChanged()
    await vi.advanceTimersByTimeAsync(CHANGE_MS)
    expect(await t.autos()).toEqual([])
    expect((await t.repo.listByLogon()).map((s) => s.kind)).toEqual(['exit'])
    t.service.stop()
  })

  it('saveManual / saveExit：Explorer 按 tabs 只保存选中的标签，一个都不剩的窗口不保存', async () => {
    const t = await setup()
    await t.service.start()
    t.live.apply('explorer', [explorer(['C:/A', 'C:/B', 'C:/C']), explorer(['C:/D'])], Date.now())
    const keyOf = (tabs: string[]): string =>
      `explorer:${tabs.map((x) => x.toLowerCase()).join('|')}`
    const id = await t.service.saveManual(
      [
        { key: keyOf(['C:/A', 'C:/B', 'C:/C']), tabs: [1, 2] },
        { key: keyOf(['C:/D']), tabs: [] }
      ],
      null
    )
    expect((await t.service.get(id)).items.map((i) => i.item)).toEqual([explorer(['C:/B', 'C:/C'])])
    await t.service.saveExit(true, [
      { key: keyOf(['C:/A', 'C:/B', 'C:/C']), tabs: [0] },
      { key: keyOf(['C:/D']) }
    ])
    const exit = (await t.repo.listByLogon()).find((s) => s.kind === 'exit')!
    expect((await t.service.get(exit.id)).items.map((i) => i.item)).toEqual([
      explorer(['C:/A']),
      explorer(['C:/D'])
    ])
    t.service.stop()
  })

  it('sessionEnded 停止监控与自动保存', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    t.service.sessionEnded()
    expect(t.monitor.stop).toHaveBeenCalled()
    t.setOpen([office('C:\\b.docx')])
    await vi.advanceTimersByTimeAsync(AUTO_MS * 3)
    expect(await t.autos()).toHaveLength(1)
  })

  it('logonAt 失败时仍启动，登录时刻用启动时刻并记 warn', async () => {
    const t = await setup({
      initial: [office('C:\\a.docx')],
      logonAt: () => Promise.reject(new Error('wts failed'))
    })
    await t.service.start()
    expect(t.logger.warn).toHaveBeenCalledWith(expect.stringContaining('wts failed'))
    expect((await t.autos())[0]!.logonAt).toBe(T0)
    t.service.stop()
  })

  it('恢复候选计算失败：记 warn、候选为 null，照常启动监控并写 auto', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    vi.spyOn(t.repo, 'listByLogon').mockRejectedValueOnce(new Error('db locked'))
    await t.service.start()
    expect(t.logger.warn).toHaveBeenCalledWith(expect.stringContaining('db locked'))
    expect(t.monitor.start).toHaveBeenCalledTimes(1)
    expect(await t.autos()).toHaveLength(1)
    expect(await t.service.restorePrompt()).toBeNull()
    t.service.stop()
  })

  it('首次完整读取因枚举失败：不写第一份 auto（saveAutoNow 也不写），之后的 tick 读取成功后再写', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    t.state.enumerateOk = false
    await t.service.start()
    expect(await t.autos()).toHaveLength(0)
    await t.service.saveAutoNow()
    expect(await t.autos()).toHaveLength(0)
    // 下一次 tick：仍失败 → 不写
    await vi.advanceTimersByTimeAsync(AUTO_MS)
    expect(await t.autos()).toHaveLength(0)
    expect(t.monitor.refreshAll).toHaveBeenCalledTimes(2)
    // 再下一次 tick：成功 → 写出完整的现场
    t.state.enumerateOk = true
    await vi.advanceTimersByTimeAsync(AUTO_MS)
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([1])
    // 之后不再每次 tick 都完整读取
    await vi.advanceTimersByTimeAsync(AUTO_MS)
    expect(t.monitor.refreshAll).toHaveBeenCalledTimes(3)
    t.service.stop()
  })

  it('没有监控（非 Windows / koffi 失败）时不写快照，查询照常返回空结果', async () => {
    const t = await setup({ noMonitor: true })
    await t.service.start()
    expect(t.service.enabled).toBe(false)
    await vi.advanceTimersByTimeAsync(AUTO_MS * 2)
    expect(await t.service.list()).toEqual([])
    expect(t.service.current()).toEqual({
      logonAt: LOGON,
      ready: false,
      items: [],
      unreadable: []
    })
    expect(await t.service.restorePrompt()).toBeNull()
    t.service.stop()
  })

  it('current 返回现场与无法读取的类别', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    t.monitor.unreadable.mockReturnValue(['explorer'])
    await t.service.start()
    expect(t.service.current()).toEqual({
      logonAt: LOGON,
      ready: true,
      items: [{ key: 'office:c:\\a.docx', item: office('C:\\a.docx') }],
      unreadable: ['explorer']
    })
    t.service.stop()
  })

  it('restore 只接受属于该快照的项目 id（其余忽略），已开着的判断用当前现场', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const id = await t.repo.insert({
      kind: 'manual',
      createdAt: 1,
      logonAt: LOGON,
      items: [office('C:\\a.docx'), office('C:\\b.docx'), office('C:\\c.docx')]
    })
    const other = await t.repo.insert({
      kind: 'manual',
      createdAt: 1,
      logonAt: LOGON,
      items: [office('C:\\x.docx')]
    })
    const items = (await t.repo.get(id))!.items
    const foreign = (await t.repo.get(other))!.items[0]!.id
    await t.service.restore(id, [{ id: items[2]!.id }, { id: foreign }, { id: items[0]!.id }])
    expect(t.restore).toHaveBeenCalledTimes(1)
    const [passed, open] = t.restore.mock.calls[0] as unknown as [{ id: number }[], Set<string>]
    // 按快照中的顺序
    expect(passed.map((i) => i.id)).toEqual([items[0]!.id, items[2]!.id])
    expect([...open]).toEqual(['office:c:\\a.docx'])
    t.service.stop()
  })

  it('restore 不删除快照（删除由用户确认），10 秒后重新扫描并原地更新 auto', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const manual = await t.service.saveManual([{ key: 'office:c:\\a.docx' }], 'm')
    t.restore.mockResolvedValueOnce({ launched: 1, skipped: [] })
    t.monitor.refreshAll.mockClear()
    const items = (await t.service.get(manual)).items
    const result = await t.service.restore(
      manual,
      items.map((i) => ({ id: i.id }))
    )
    expect(result).toEqual({ launched: 1, skipped: [] })
    expect((await t.service.list()).some((s) => s.id === manual)).toBe(true)
    await vi.advanceTimersByTimeAsync(RESCAN_MS)
    expect(t.monitor.refreshAll).toHaveBeenCalledTimes(1)
    expect(await t.autos()).toHaveLength(1)
    t.service.stop()
  })

  it('restore 的 Explorer 只恢复选中的标签（按原顺序），一个都不剩的项目不传', async () => {
    const t = await setup()
    await t.service.start()
    const id = await t.repo.insert({
      kind: 'manual',
      createdAt: 1,
      logonAt: LOGON,
      items: [explorer(['C:\\A', 'C:\\B', 'C:\\C']), explorer(['C:\\D']), office('C:\\x.docx')]
    })
    const [win, solo, doc] = (await t.repo.get(id))!.items
    await t.service.restore(id, [
      { id: win!.id, tabs: [2, 0] },
      { id: solo!.id, tabs: [] },
      { id: doc!.id, tabs: [] }
    ])
    const [passed] = t.restore.mock.calls[0] as unknown as [{ id: number; item: DesktopItem }[]]
    expect(passed).toEqual([
      { id: win!.id, item: explorer(['C:\\A', 'C:\\C']) },
      { id: doc!.id, item: office('C:\\x.docx') }
    ])
    t.service.stop()
  })

  it('clear：删除全部快照（含 exit-none），立即写一份新的 auto 并广播', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    await t.service.saveManual([{ key: 'office:c:\\a.docx' }], 'm')
    await t.repo.insert({ kind: 'exit-none', createdAt: 1, logonAt: LOGON - 1, items: [] })
    await t.repo.insert({ kind: 'exit', createdAt: 2, logonAt: LOGON - 1, items: [] })
    t.emit.mockClear()
    await t.service.clear()
    const all = await t.repo.listByLogon()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ kind: 'auto', itemCount: 1, logonAt: LOGON })
    expect(t.emit).toHaveBeenCalledWith({ scope: 'snapshots' })
    // 之后的自动保存原地更新这一份
    t.setOpen([office('C:\\a.docx'), office('C:\\b.docx')])
    await vi.advanceTimersByTimeAsync(AUTO_MS)
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([2])
    t.service.stop()
  })

  it('clear 失败时抛出（由页面提示），快照保留', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const id = await t.service.saveManual([], 'm')
    vi.spyOn(t.repo, 'deleteAll').mockRejectedValueOnce(new Error('db locked'))
    await expect(t.service.clear()).rejects.toThrow('db locked')
    expect((await t.service.list()).some((s) => s.id === id)).toBe(true)
    t.service.stop()
  })

  it('restore 的启动失败（抛错）时不清空快照', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const id = await t.service.saveManual([], 'm')
    t.restore.mockRejectedValueOnce(new Error('boom'))
    await expect(t.service.restore(id, [])).rejects.toThrow('boom')
    expect((await t.service.list()).some((s) => s.id === id)).toBe(true)
    t.service.stop()
  })

  it('等待期间 stop：取消重新扫描', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const id = await t.service.saveManual([], 'm')
    t.monitor.refreshAll.mockClear()
    await t.service.restore(id, [])
    t.service.stop()
    await vi.advanceTimersByTimeAsync(RESCAN_MS * 2)
    expect(t.monitor.refreshAll).not.toHaveBeenCalled()
  })

  it('重新扫描时枚举失败：不写，之后的自动保存读取成功后写', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const auto = (await t.autos())[0]!.id
    await t.service.restore(auto, [])
    t.state.enumerateOk = false
    t.setOpen([office('C:\\a.docx'), office('C:\\b.docx')])
    await vi.advanceTimersByTimeAsync(RESCAN_MS)
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([1])
    t.state.enumerateOk = true
    await vi.advanceTimersByTimeAsync(AUTO_MS)
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([2])
    t.service.stop()
  })

  it('get / restore 不存在的快照 → DESKTOP_SNAPSHOT_NOT_FOUND', async () => {
    const t = await setup()
    await t.service.start()
    await expect(t.service.get(999)).rejects.toMatchObject({ code: 'DESKTOP_SNAPSHOT_NOT_FOUND' })
    await expect(t.service.restore(999, [{ id: 1 }])).rejects.toMatchObject({
      code: 'DESKTOP_SNAPSHOT_NOT_FOUND'
    })
    t.service.stop()
  })

  it('rename / delete 后广播 snapshots', async () => {
    const t = await setup()
    await t.service.start()
    const id = await t.service.saveManual([], null)
    t.emit.mockClear()
    await t.service.rename(id, 'x')
    expect((await t.service.get(id)).name).toBe('x')
    await t.service.delete(id)
    expect((await t.service.list()).some((s) => s.id === id)).toBe(false)
    expect(t.emit).toHaveBeenCalledTimes(2)
    t.service.stop()
  })
})
