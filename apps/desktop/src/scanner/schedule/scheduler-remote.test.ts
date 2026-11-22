import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@pch/shared'
import { BACKOFF_BASE_MS } from './backoff'
import { disposeHarnesses, hang, none, prelist, root, setup } from './scheduler.test-helper'

/**
 * 远程目录（sftp:）的调度方针（设计 devDoc/2026-11-22-37 第 5.6 节）：只在展开 / 选中 / 标签中新显示 /
 * 刷新时读取；定期确认、热点、窗口重新获得焦点、滚回视口都不读取；后台只读「建立索引」的目录。
 */

const CONN = 'sftp://c1'
/** 远程根（连接 c1 的登录用户的 /）；扫描配置中远程根的策略恒为 passive */
const RR = 'sftp://c1'
const R = 'file:///C:/r'
const N = 'file://srv/share/n'
const MIN = 60_000

const remoteRoot = root(RR, 'passive', 'remote')

afterEach(disposeHarnesses)

describe('Scheduler: remote directories', () => {
  it('a remote focus is read once and never periodically', async () => {
    const { clock, fs, s } = setup([remoteRoot])
    const A = fs.addDir(RR, 'a')
    s.setInterest(1, { ...none, focus: A })
    await clock.advance(0)
    expect(fs.count('list', A)).toBe(1)
    const n = fs.calls.length
    // 超过 remoteIndexIntervalSec（30 分钟）：关注点也没有任何定期确认
    await clock.advance(40 * MIN)
    expect(fs.calls.length).toBe(n)
  })

  it('a remote directory newly shown in a tab is read once', async () => {
    const { clock, fs, s } = setup([remoteRoot])
    const T = fs.addDir(RR, 't')
    s.setInterest(1, { ...none, tabs: [T] })
    await clock.advance(0)
    expect(fs.count('list', T)).toBe(1)
    // 同一 tabs 再次发送（超过 2 秒去重）：不再读取
    await clock.advance(3000)
    s.setInterest(1, { ...none, tabs: [T] })
    await clock.advance(40 * MIN)
    expect(fs.count('list', T)).toBe(1)
  })

  it('refocusing the window does not read the remote focus', async () => {
    const { clock, fs, s } = setup([remoteRoot, root(R)])
    const A = fs.addDir(RR, 'a')
    const L = fs.addDir(R, 'l')
    s.setInterest(1, { ...none, focus: A })
    s.setInterest(2, { ...none, focus: L })
    await clock.advance(0)
    s.setWindowFocus(1, false)
    s.setWindowFocus(2, false)
    await clock.advance(3000)
    const remote = fs.count('list', A)
    const local = fs.count('list', L)
    s.setWindowFocus(1, true)
    s.setWindowFocus(2, true)
    await clock.advance(0)
    expect(fs.count('list', A)).toBe(remote)
    // 对照：本地关注点照常以 P0 读取
    expect(fs.count('list', L)).toBe(local + 1)
  })

  it('a remote directory scrolled back into view is not read', async () => {
    const { clock, fs, s } = setup([remoteRoot, root(R)])
    const V = fs.addDir(RR, 'v')
    const X = fs.addDir(R, 'x')
    s.setInterest(1, { ...none, offscreen: [V, X] })
    await clock.advance(3000)
    const before = fs.count('stat', V)
    s.setInterest(1, { ...none, visible: [V, X] })
    await clock.advance(0)
    expect(fs.count('stat', V)).toBe(before)
    // 对照：本地目录滚回视口时以 P0 读取
    expect(fs.count('list', X)).toBe(1)
  })

  it('index targets are read in the background, one at a time per connection, every 30 minutes', async () => {
    const OPT = `${RR}/opt`
    const { clock, fs } = setup([remoteRoot], { indexTargets: [OPT] })
    fs.mkdir(OPT)
    fs.dirs.get(RR)!.entries.push({
      name: 'opt',
      kind: 'directory',
      size: 0,
      mtime: 1,
      hidden: false
    })
    const A = fs.addDir(OPT, 'a')
    const B = fs.addDir(OPT, 'b')
    const C = fs.addDir(A, 'c')
    const t0 = clock.now()
    await clock.advance(10_000)
    for (const u of [OPT, A, B, C]) expect(fs.count('list', u), u).toBe(1)
    // 建立索引的范围之外（根本身）不读取
    expect(fs.count('stat', RR)).toBe(0)
    expect(fs.maxInFlight.get(CONN)).toBe(1)

    const n = fs.calls.length
    await clock.advance(t0 + 29 * MIN - clock.now())
    expect(fs.calls.length).toBe(n)
    // 距上次读取超过 30 分钟：再次完整列出（目录修改时间未变也列出）
    await clock.advance(t0 + 31 * MIN - clock.now())
    for (const u of [OPT, A, B, C]) expect(fs.count('list', u), u).toBe(2)
    expect(fs.maxInFlight.get(CONN)).toBe(1)
  })

  it('a background check of a cached remote directory re-lists it even when its mtime is unchanged', async () => {
    const OPT = `${RR}/opt`
    const h = setup([remoteRoot], { indexTargets: [OPT] })
    const { clock, fs } = h
    fs.mkdir(OPT)
    prelist(h, OPT, clock.now() - 31 * MIN)
    await clock.advance(5000)
    expect(fs.count('stat', OPT)).toBe(1)
    expect(fs.count('list', OPT)).toBe(1)
  })

  it('a P0 check of a cached remote directory with an unchanged mtime still lists it', async () => {
    const h = setup([remoteRoot])
    const { clock, fs, s } = h
    const A = fs.addDir(RR, 'a')
    prelist(h, A, clock.now() - 10_000)
    const l = await s.listNow(A)
    expect(l.state).toBe('cached')
    await clock.advance(0)
    expect(fs.count('list', A)).toBe(1)
  })

  it('remote P0 reads pass userAction: true, background reads false', async () => {
    const OPT = `${RR}/opt`
    const { clock, fs, s } = setup([remoteRoot], { indexTargets: [OPT] })
    const A = fs.addDir(RR, 'a')
    fs.mkdir(OPT)
    const p = s.listNow(A)
    await clock.advance(5000)
    await p
    const ua = (uri: string): boolean[] =>
      fs.calls.filter((c) => c.uri === uri).map((c) => c.userAction)
    expect(ua(A)).toEqual([true, true]) // stat + list
    expect(ua(OPT)).toEqual([false, false])
  })

  it('FS_UNAVAILABLE takes the connection offline and the probe brings it back', async () => {
    const { clock, fs, s, reach } = setup([remoteRoot])
    const A = fs.addDir(RR, 'a')
    let fail = true
    fs.gate = (op, uri) => {
      if (op === 'list' && uri === A && fail) {
        fail = false
        return Promise.reject(new AppError({ code: 'FS_UNAVAILABLE', detail: uri }))
      }
      return undefined
    }
    s.setInterest(1, { ...none, focus: A })
    await clock.advance(0)
    expect(reach).toEqual([[CONN, 'offline', clock.now()]])
    expect(s.isOffline(A)).toBe(true)

    const n = fs.calls.length
    await clock.advance(BACKOFF_BASE_MS)
    // 退避到期：以 statDir 探测（非用户操作），成功即恢复
    expect(fs.calls[n]).toMatchObject({ op: 'stat', uri: A, userAction: false })
    expect(reach.map((r) => r.slice(0, 2))).toEqual([
      [CONN, 'offline'],
      [CONN, 'online']
    ])
    // 恢复后该连接下的关注点以 P0 读取：系统派生，不是用户操作（不让连接池重试记住的身份失败）
    const after = fs.calls.slice(n + 1).filter((c) => c.uri === A)
    expect(after.map((c) => [c.op, c.userAction])).toEqual([
      ['stat', false],
      ['list', false]
    ])
  })

  it('CONN_* errors mark the directory, not the connection', async () => {
    const h = setup([remoteRoot])
    const { clock, fs, s, reach, cache } = h
    const A = fs.addDir(RR, 'a')
    prelist(h, RR, clock.now())
    fs.errors.set(A, 'CONN_AUTH_FAILED')
    await expect(s.listNow(A)).rejects.toMatchObject({ code: 'CONN_AUTH_FAILED' })
    expect(reach).toEqual([])
    expect(s.isOffline(A)).toBe(false)
    expect(cache.getDir(A)).toMatchObject({ state: 'unreachable', errorCode: 'CONN_AUTH_FAILED' })
    // 不进入退避探测
    const n = fs.calls.length
    await clock.advance(10 * MIN)
    expect(fs.calls.length).toBe(n)
  })

  it('remote reads do not take libuv threads', async () => {
    const OPT = `${RR}/opt`
    const { clock, fs, s } = setup([root(R), root(N), remoteRoot], {
      threadPoolSize: 2,
      indexTargets: [OPT]
    })
    const L = fs.addDir(R, 'l')
    const M = fs.addDir(N, 'm')
    const A = fs.addDir(RR, 'a')
    fs.mkdir(OPT)
    // 本地、网络各一个挂起的调用占满线程池；远程的后台读取也挂起
    fs.gate = (_op, uri, signal) => (uri === A ? undefined : hang(signal))
    void s.listNow(L).catch(() => {})
    void s.listNow(M).catch(() => {})
    await clock.advance(0)
    expect(fs.count('stat', L)).toBe(1)
    expect(fs.count('stat', M)).toBe(1)
    expect(fs.count('stat', OPT)).toBe(1)
    // 远程 P0 仍能开始（同一连接：P0 1 个 + 后台 1 个）
    const p = s.listNow(A)
    await clock.advance(0)
    await expect(p).resolves.toMatchObject({ state: 'fresh' })
    expect(fs.count('list', A)).toBe(1)
  })
})

describe('Scheduler: remote directories (review fixes)', () => {
  it('parent corrections derived from errors are not user actions', async () => {
    const h = setup([remoteRoot])
    const { clock, fs, s } = h
    const P = fs.addDir(RR, 'p')
    const D = fs.addDir(P, 'd')
    const F = fs.addDir(P, 'f')
    const old = clock.now() - 10 * MIN
    for (const u of [RR, P, D, F]) prelist(h, u, old)
    // P 的列表仍有 d / f：读取 d 得到 FS_NOT_FOUND、读取 f 得到 FS_NOT_A_DIRECTORY → 对 P 派生一次 P0
    fs.rmdir(D)
    fs.errors.set(F, 'FS_NOT_A_DIRECTORY')
    const ofP = (from: number): boolean[] =>
      fs.calls
        .slice(from)
        .filter((c) => c.uri === P)
        .map((c) => c.userAction)

    s.refresh([D])
    await clock.advance(0)
    expect(fs.calls.filter((c) => c.uri === D).map((c) => c.userAction)).toEqual([true])
    expect(ofP(0)).toEqual([false, false])

    const n = fs.calls.length
    s.refresh([F])
    await clock.advance(0)
    expect(fs.calls.filter((c) => c.uri === F).map((c) => c.userAction)).toEqual([true])
    expect(ofP(n)).toEqual([false, false])
  })

  it('a user P0 merged into a queued system P0 is a user action', async () => {
    const OPT = `${RR}/opt`
    const h = setup([remoteRoot], { indexTargets: [OPT] })
    const { clock, fs, s } = h
    const H = fs.addDir(RR, 'h')
    fs.mkdir(OPT)
    const D = fs.addDir(OPT, 'd')
    // OPT 有列表（含 d），d 只有行（未列出）：后台读取 d 得到 FS_NOT_FOUND → 对 OPT 派生系统 P0
    prelist(h, OPT, clock.now() - 10 * MIN)
    fs.rmdir(D)
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    fs.gate = (_op, uri) => (uri === H ? held : undefined)
    // 用户 P0 占住该连接的 P0 通道：派生的 P0 在队列中等待
    const ph = s.listNow(H)
    await clock.advance(1000)
    expect(fs.count('stat', D)).toBe(1)
    expect(fs.count('stat', OPT)).toBe(0)
    // 用户展开 OPT：并入排队中的系统 P0，合并后为用户操作
    await s.listNow(OPT)
    release()
    await clock.advance(0)
    await ph
    expect(fs.calls.filter((c) => c.uri === OPT).map((c) => c.userAction)).toEqual([true, true])
  })

  it('a user P0 does not join a running system P0', async () => {
    const h = setup([remoteRoot])
    const { clock, fs, s } = h
    const P = fs.addDir(RR, 'p')
    const D = fs.addDir(P, 'd')
    const old = clock.now() - 10 * MIN
    for (const u of [RR, P, D]) prelist(h, u, old)
    fs.rmdir(D)
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    // 派生的系统 P0（P）在执行中挂起
    fs.gate = (op, uri) => (uri === P && op === 'stat' ? held : undefined)
    s.refresh([D])
    await clock.advance(0)
    expect(fs.count('stat', P)).toBe(1)
    fs.gate = undefined
    const p = s.listNow(P)
    release()
    await clock.advance(0)
    await p
    // 用户的请求另排一次（userAction 为 true），不沿用系统 P0 的结果
    expect(fs.calls.filter((c) => c.uri === P && c.op === 'stat').map((c) => c.userAction)).toEqual(
      [false, true]
    )
  })

  it('a remote root misconfigured as "all" still has no background ranges', async () => {
    const { clock, fs } = setup([root(RR, 'all', 'remote')])
    fs.addDir(fs.addDir(RR, 'a'), 'b')
    await clock.advance(40 * MIN)
    expect(fs.calls).toEqual([])
  })

  it('identities of one connection share the concurrency group and the offline state', async () => {
    const RA = 'sftp://app1@c1'
    const { clock, fs, s, reach } = setup([remoteRoot, root(RA, 'passive', 'remote')])
    const X = fs.addDir(RR, 'x')
    const Y = fs.addDir(RA, 'y')
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    fs.gate = (_op, uri) => (uri === X ? held : undefined)
    const px = s.listNow(X)
    const py = s.listNow(Y)
    await clock.advance(0)
    // 同一连接的 P0 通道被登录用户的读取占着：app1 的读取等待
    expect(fs.count('stat', Y)).toBe(0)
    release()
    await clock.advance(0)
    await px
    await py
    expect(fs.count('list', Y)).toBe(1)
    expect(fs.maxInFlight.get(CONN)).toBe(1)

    // 一个身份的读取断线 = 整个连接断开
    fs.gate = (op, uri) =>
      op === 'stat' && uri === X
        ? Promise.reject(new AppError({ code: 'FS_UNAVAILABLE', detail: uri }))
        : undefined
    s.refresh([X])
    await clock.advance(0)
    expect(reach).toEqual([[CONN, 'offline', clock.now()]])
    expect(s.isOffline(Y)).toBe(true)
    await expect(s.listNow(`${RA}/z`)).rejects.toMatchObject({ code: 'FS_UNAVAILABLE' })
  })

  it('a CONN_* error from a refresh while offline brings the connection online and stops probing', async () => {
    const { clock, fs, s, reach } = setup([remoteRoot])
    const A = fs.addDir(RR, 'a')
    fs.errors.set(A, 'FS_UNAVAILABLE')
    s.setInterest(1, { ...none, focus: A })
    await clock.advance(0)
    expect(s.isOffline(A)).toBe(true)

    fs.errors.set(A, 'CONN_AUTH_FAILED')
    s.refresh([A])
    await clock.advance(0)
    expect(reach.map((r) => r.slice(0, 2))).toEqual([
      [CONN, 'offline'],
      [CONN, 'online']
    ])
    expect(s.isOffline(A)).toBe(false)
    // 不再探测（退避时刻早已过去也不读取）
    const n = fs.calls.length
    await clock.advance(10 * MIN)
    expect(fs.calls.length).toBe(n)
  })
})
