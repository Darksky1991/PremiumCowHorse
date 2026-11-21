import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopCollector, DesktopItem, DesktopRestoreResult } from '@pch/shared'
import type { Logger } from '../../infra/logger'
import { openDatabase, type Database } from '../../infra/db/client'
import { DesktopService, type DesktopMonitorLike } from './desktop.service'
import { LiveState } from './live-state'
import { DesktopSnapshotRepo } from './snapshot.repo'

const noop = (): void => undefined
const silent: Logger = { error: noop, warn: noop, info: noop, debug: noop }

const AUTO_MS = 300_000
const FREEZE_MS = 300_000
const RESCAN_MS = 10_000
const LOGON = 2_000_000
const T0 = 10_000_000

const office = (path: string): DesktopItem => ({
  kind: 'office',
  app: 'word',
  path,
  readOnly: false,
  exe: 'C:\\Office\\WINWORD.EXE'
})
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
  const service = new DesktopService({
    repo,
    monitor: opts.noMonitor ? null : monitor,
    live,
    restore,
    logonAt: opts.logonAt ?? (async () => LOGON),
    now: () => Date.now(),
    emit,
    autoSaveMs: AUTO_MS,
    keepVisible: 3,
    restoreRescanMs: RESCAN_MS,
    sessionFreezeMs: FREEZE_MS,
    logger
  })
  /** 设置 office 类的当前结果（相当于一次采集） */
  const setOpen = (items: DesktopItem[]): boolean => live.apply('office', items, Date.now())
  const autos = async (): Promise<{ id: number; itemCount: number; logonAt: number }[]> =>
    (await repo.list()).filter((s) => s.kind === 'auto')
  return { db, repo, live, monitor, state, restore, emit, logger, service, setOpen, autos }
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

  it('saveExit(false) 写 exit-none；saveExit(true) 只写勾选的项目', async () => {
    const t = await setup({ initial: [office('C:\\a.docx'), office('C:\\b.docx')] })
    await t.service.start()
    await t.service.saveExit(true, ['office:c:\\b.docx', 'office:c:\\nope'])
    await t.service.saveExit(false, ['office:c:\\a.docx'])
    const all = await t.repo.listByLogon()
    expect(all.map((s) => s.kind)).toEqual(['exit-none', 'exit', 'auto'])
    expect(all[0]!.itemCount).toBe(0)
    expect(pathsOf((await t.repo.get(all[1]!.id))!.items)).toEqual(['C:\\b.docx'])
    t.service.stop()
  })

  it('saveManual：当前现场中 key 在列表里的项目，带名称', async () => {
    const t = await setup({ initial: [office('C:\\a.docx'), office('C:\\b.docx')] })
    await t.service.start()
    t.emit.mockClear()
    const id = await t.service.saveManual(['office:c:\\a.docx'], 'mine')
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
    expect(t.service.current()).toEqual({ logonAt: LOGON, items: [], unreadable: [] })
    expect(await t.service.restorePrompt()).toBeNull()
    t.service.stop()
  })

  it('current 返回现场与无法读取的类别', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    t.monitor.unreadable.mockReturnValue(['explorer'])
    await t.service.start()
    expect(t.service.current()).toEqual({
      logonAt: LOGON,
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
    await t.service.restore(id, [items[2]!.id, foreign, items[0]!.id])
    expect(t.restore).toHaveBeenCalledTimes(1)
    const [passed, open] = t.restore.mock.calls[0] as unknown as [{ id: number }[], Set<string>]
    // 按快照中的顺序
    expect(passed.map((i) => i.id)).toEqual([items[0]!.id, items[2]!.id])
    expect([...open]).toEqual(['office:c:\\a.docx'])
    t.service.stop()
  })

  it('restore 完成后清空全部快照，10 秒后重新扫描并写一份新的 auto', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const manual = await t.service.saveManual(['office:c:\\a.docx'], 'm')
    await t.service.saveExit(false, [])
    const items = (await t.service.get(manual)).items
    t.emit.mockClear()
    t.monitor.refreshAll.mockClear()

    const result = await t.service.restore(
      manual,
      items.map((i) => i.id)
    )
    expect(result).toEqual({ launched: 0, skipped: [] })
    // 清空：含 exit-none；广播
    expect(await t.repo.listByLogon()).toEqual([])
    expect(t.emit).toHaveBeenCalledWith({ scope: 'snapshots' })
    expect(t.monitor.refreshAll).not.toHaveBeenCalled()

    // 等待期内又点恢复：快照已不存在
    await vi.advanceTimersByTimeAsync(RESCAN_MS - 1)
    await expect(t.service.restore(manual, [items[0]!.id])).rejects.toMatchObject({
      code: 'DESKTOP_SNAPSHOT_NOT_FOUND'
    })
    expect(await t.repo.listByLogon()).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(t.monitor.refreshAll).toHaveBeenCalledTimes(1)
    const all = await t.repo.listByLogon()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ kind: 'auto', itemCount: 1, logonAt: LOGON })
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
    expect(await t.repo.listByLogon()).toEqual([])
  })

  it('重新扫描时枚举失败：不写，之后的自动保存读取成功后写', async () => {
    const t = await setup({ initial: [office('C:\\a.docx')] })
    await t.service.start()
    const id = await t.service.saveManual([], 'm')
    await t.service.restore(id, [])
    t.state.enumerateOk = false
    await vi.advanceTimersByTimeAsync(RESCAN_MS)
    expect(await t.repo.listByLogon()).toEqual([])
    t.state.enumerateOk = true
    await vi.advanceTimersByTimeAsync(AUTO_MS)
    expect((await t.autos()).map((s) => s.itemCount)).toEqual([1])
    t.service.stop()
  })

  it('get / restore 不存在的快照 → DESKTOP_SNAPSHOT_NOT_FOUND', async () => {
    const t = await setup()
    await t.service.start()
    await expect(t.service.get(999)).rejects.toMatchObject({ code: 'DESKTOP_SNAPSHOT_NOT_FOUND' })
    await expect(t.service.restore(999, [1])).rejects.toMatchObject({
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
