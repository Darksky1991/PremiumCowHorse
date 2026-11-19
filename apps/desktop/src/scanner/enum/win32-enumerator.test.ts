import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalProvider } from '../../main/vfs/providers/local.provider'
import { createEnumerator } from './create-enumerator'
import type { Enumerator, RawEntry } from './types'
import {
  createWin32Enumerator,
  loadKernel32,
  type Kernel32,
  type NativeFn
} from './win32-enumerator'

const url = (p: string): string => pathToFileURL(p).href
const byName = (entries: RawEntry[]): Record<string, RawEntry> =>
  Object.fromEntries(entries.map((e) => [e.name, e]))
const noop = (): void => {}
const signal = (): AbortSignal => new AbortController().signal
const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3600_000)

type Callback = (err: unknown, value: unknown) => void
/** 只提供 .async 的假原生函数（枚举器只用异步调用；同步调用只在关闭句柄的兜底中使用） */
const fakeFn = (
  async: (...args: unknown[]) => void,
  sync?: (...args: unknown[]) => unknown
): NativeFn =>
  Object.assign(
    sync ??
      (() => {
        throw new Error('unexpected sync call')
      }),
    { async }
  ) as unknown as NativeFn

/**
 * 包装真实的 kernel32：记录 CreateFileW 得到的句柄与 CloseHandle 关闭的句柄，
 * 并用 override 替换个别函数
 */
function spyKernel32(override: Partial<Kernel32>): {
  k: Kernel32
  opened: unknown[]
  closed: unknown[]
} {
  const real = loadKernel32()
  const opened: unknown[] = []
  const closed: unknown[] = []
  const k: Kernel32 = {
    ...real,
    CreateFileW: fakeFn((...args) => {
      const cb = args.pop() as Callback
      real.CreateFileW.async(...args, (err: unknown, value: unknown) => {
        opened.push(value)
        cb(err, value)
      })
    }),
    CloseHandle: fakeFn((h, cb) => {
      closed.push(h)
      real.CloseHandle.async(h, cb)
    }),
    ...override
  }
  return { k, opened, closed }
}

/**
 * 可注入 Win32 错误码的 kernel32：fail(cb, code, value) 以 value 作为返回值调用回调，
 * 回调中读取的 GetLastError 为 code（其余时候读真实值）
 */
function forcedErrors(): {
  real: Kernel32
  GetLastError: NativeFn
  fail: (cb: Callback, code: number, value: unknown) => void
} {
  const real = loadKernel32()
  let forced: number | null = null
  const GetLastError = fakeFn(
    () => {
      throw new Error('unexpected async GetLastError')
    },
    () => forced ?? real.GetLastError()
  )
  const fail = (cb: Callback, code: number, value: unknown): void => {
    forced = code
    try {
      cb(null, value)
    } finally {
      forced = null
    }
  }
  return { real, GetLastError, fail }
}

describe.runIf(process.platform === 'win32')('Win32Enumerator', () => {
  let root: string
  let log: ReturnType<typeof vi.fn<(msg: string) => void>>
  let en: Enumerator

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'pch-enum-'))
    log = vi.fn<(msg: string) => void>()
    en = createWin32Enumerator(log)
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const list = (p: string): Promise<RawEntry[]> =>
    en.list(url(p), { signal: signal(), onBatch: noop })

  it('is reported as native and is what createEnumerator returns on Windows', () => {
    expect(en.native).toBe(true)
    expect(createEnumerator(log).native).toBe(true)
  })

  it('lists names, kinds, sizes and mtimes', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    mkdirSync(path.join(root, 'sub'))
    const entries = byName(await list(root))
    expect(Object.keys(entries).sort()).toEqual(['a.txt', 'sub'])
    const a = statSync(path.join(root, 'a.txt'))
    const sub = statSync(path.join(root, 'sub'))
    expect(entries['a.txt']).toMatchObject({ kind: 'file', size: 3, hidden: false })
    expect(entries['sub']).toMatchObject({ kind: 'directory', size: 0, hidden: false })
    expect(Math.abs(entries['a.txt']!.mtime - a.mtimeMs)).toBeLessThan(1)
    expect(Math.abs(entries['sub']!.mtime - sub.mtimeMs)).toBeLessThan(1)
    expect('target' in entries['a.txt']!).toBe(false)
    expect('target' in entries['sub']!).toBe(false)
  })

  it('marks HIDDEN as hidden and SYSTEM-only as visible', async () => {
    for (const n of ['h.txt', 's.txt', 'hs.txt', 'plain.txt', '.dot']) {
      writeFileSync(path.join(root, n), '')
    }
    execFileSync('attrib', ['+h', path.join(root, 'h.txt')])
    execFileSync('attrib', ['+s', path.join(root, 's.txt')])
    execFileSync('attrib', ['+h', '+s', path.join(root, 'hs.txt')])
    const entries = byName(await list(root))
    expect(entries['h.txt']!.hidden).toBe(true)
    expect(entries['hs.txt']!.hidden).toBe(true)
    expect(entries['s.txt']!.hidden).toBe(false)
    expect(entries['plain.txt']!.hidden).toBe(false)
    // Windows 以属性判断隐藏：以 . 开头但没有 HIDDEN 属性的项照常显示（与资源管理器一致）
    expect(entries['.dot']!.hidden).toBe(false)
  })

  it('reports junctions and symlinks as symlink with a target', async () => {
    const target = path.join(root, 'target')
    const gone = path.join(root, 'gone')
    const dir = path.join(root, 'dir')
    mkdirSync(target)
    mkdirSync(gone)
    mkdirSync(dir)
    execFileSync('cmd', ['/c', 'mklink', '/J', path.join(dir, 'j'), target])
    execFileSync('cmd', ['/c', 'mklink', '/J', path.join(dir, 'dead'), gone])
    rmSync(gone, { recursive: true })
    const entries = byName(await list(dir))
    expect(entries['j']).toMatchObject({ kind: 'symlink', target: 'directory', size: 0 })
    expect(entries['dead']).toMatchObject({ kind: 'symlink', target: null })
  })

  it('enumerates names with # % spaces and Japanese', async () => {
    const names = ['設計 #1 100%', 'a b.txt', '日本語フォルダ', '%E8%A8%AD.txt', '#hash.md'].sort()
    for (const n of names) {
      if (n.includes('.')) writeFileSync(path.join(root, n), 'x')
      else mkdirSync(path.join(root, n))
    }
    const entries = await list(root)
    expect(entries.map((e) => e.name).sort()).toEqual(names)
    // 与现有 LocalProvider（readdir）列出的名称完全一致：后续缓存以 URI 为键，名称不能有差异
    const viaFs = await new LocalProvider().list(pathToFileURL(root))
    expect(entries.map((e) => e.name).sort()).toEqual(viaFs.map((e) => e.name).sort())
  })

  it('enumerates a directory whose path exceeds 260 characters', async () => {
    let deep = root
    while (deep.length <= 280) deep = path.join(deep, 'd'.repeat(40))
    mkdirSync(deep, { recursive: true })
    writeFileSync(path.join(deep, 'deep.txt'), 'hello')
    expect(deep.length).toBeGreaterThan(260)
    const entries = byName(await list(deep))
    expect(entries['deep.txt']).toMatchObject({ kind: 'file', size: 5 })
    expect((await en.statDir(url(deep), signal())).mtime).toBeCloseTo(statSync(deep).mtimeMs, 3)
  })

  it("does not update the directory's last access time", async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    mkdirSync(path.join(root, 'sub'))
    utimesSync(root, hoursAgo(3), hoursAgo(3))
    const before = statSync(root)
    await list(root)
    const after = statSync(root)
    expect(after.atimeMs).toBe(before.atimeMs)
    // 访问时间保护本身也不得改动其他时间
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.ctimeMs).toBe(before.ctimeMs)
    expect(log).not.toHaveBeenCalled()
  })

  it('statDir returns the directory mtime and does not change atime', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    utimesSync(root, hoursAgo(3), hoursAgo(2))
    const before = statSync(root)
    const { mtime } = await en.statDir(url(root), signal())
    expect(mtime).toBe(before.mtimeMs)
    expect(statSync(root).atimeMs).toBe(before.atimeMs)
  })

  it('statDir follows a junction to its target directory', async () => {
    const target = path.join(root, 'target')
    mkdirSync(target)
    utimesSync(target, hoursAgo(5), hoursAgo(5))
    execFileSync('cmd', ['/c', 'mklink', '/J', path.join(root, 'j'), target])
    const { mtime } = await en.statDir(url(path.join(root, 'j')), signal())
    expect(mtime).toBe(statSync(target).mtimeMs)
  })

  it('calls onBatch at least once and honours an aborted signal', async () => {
    for (let i = 0; i < 2000; i++) writeFileSync(path.join(root, `file-${i}-${'x'.repeat(40)}`), '')
    const onBatch = vi.fn()
    const entries = await en.list(url(root), { signal: signal(), onBatch })
    expect(entries).toHaveLength(2000)
    // 64KB 缓冲放不下 2000 个约 100 字节的项：至少分两批
    expect(onBatch.mock.calls.length).toBeGreaterThanOrEqual(2)

    const aborted = AbortSignal.abort()
    await expect(en.list(url(root), { signal: aborted, onBatch: noop })).rejects.toMatchObject({
      code: 'FS_CANCELLED'
    })
    await expect(en.statDir(url(root), aborted)).rejects.toMatchObject({ code: 'FS_CANCELLED' })

    // 第一批之后中止：不再读取后续批次
    const ac = new AbortController()
    const stopAfterFirst = vi.fn(() => ac.abort())
    await expect(
      en.list(url(root), { signal: ac.signal, onBatch: stopAfterFirst })
    ).rejects.toMatchObject({ code: 'FS_CANCELLED' })
    expect(stopAfterFirst).toHaveBeenCalledTimes(1)
  })

  it('maps missing paths and files to error codes', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    await expect(list(path.join(root, 'missing'))).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
    await expect(list(path.join(root, 'missing', 'deeper'))).rejects.toMatchObject({
      code: 'FS_NOT_FOUND'
    })
    await expect(list(path.join(root, 'a.txt'))).rejects.toMatchObject({
      code: 'FS_NOT_A_DIRECTORY'
    })
    await expect(en.statDir(url(path.join(root, 'missing')), signal())).rejects.toMatchObject({
      code: 'FS_NOT_FOUND'
    })
    await expect(en.statDir(url(path.join(root, 'a.txt')), signal())).rejects.toMatchObject({
      code: 'FS_NOT_A_DIRECTORY'
    })
  })

  it('falls back to a read-only handle where attributes cannot be written, logging once', async () => {
    // 对当前用户拒绝「写入属性」（WA）：只能以只读句柄打开，访问时间无法保护
    const dir = path.join(root, 'locked')
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'a.txt'), 'abc')
    // 以 SID 指定当前用户（Git Bash 的 whoami 会遮蔽系统的 whoami.exe，名称格式也因域而异）
    const whoami = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe')
    const sid = execFileSync(whoami, ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' })
      .trim()
      .split(',')[1]!
      .replaceAll('"', '')
    const user = `*${sid}`
    execFileSync('icacls', [dir, '/deny', `${user}:(WA)`])
    try {
      expect(byName(await list(dir))['a.txt']).toMatchObject({ kind: 'file', size: 3 })
      await list(dir)
      expect(log).toHaveBeenCalledTimes(1)
      expect(log.mock.calls[0]![0]).toContain('access time')
    } finally {
      execFileSync('icacls', [dir, '/remove:d', user])
    }
  })

  it('closes the handle when protecting the access time fails in koffi', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    const { k, opened, closed } = spyKernel32({
      // koffi 层的失败（不是 Win32 的 FALSE 返回值）：回调收到 err
      SetFileInformationByHandle: fakeFn((...args) => {
        ;(args.pop() as Callback)(new Error('koffi failure'), undefined)
      })
    })
    const failing = createWin32Enumerator(log, k)
    await expect(failing.list(url(root), { signal: signal(), onBatch: noop })).rejects.toThrow(
      'koffi failure'
    )
    expect(opened).toHaveLength(1)
    expect(closed).toEqual(opened)
  })

  it('closes the handle when enumeration throws, falling back to a sync close if needed', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    const real = loadKernel32()
    const syncClosed: unknown[] = []
    const { k, opened } = spyKernel32({
      // 例如 koffi 的异步队列已满：.async 同步抛出
      GetFileInformationByHandleEx: fakeFn(() => {
        throw new Error('queue full')
      }),
      CloseHandle: fakeFn(
        () => {
          throw new Error('queue full')
        },
        (h) => {
          syncClosed.push(h)
          return real.CloseHandle(h)
        }
      )
    })
    const failing = createWin32Enumerator(log, k)
    await expect(failing.list(url(root), { signal: signal(), onBatch: noop })).rejects.toThrow(
      'queue full'
    )
    expect(opened).toHaveLength(1)
    expect(syncClosed).toEqual(opened)
  })

  it('maps only network / device errors to FS_UNAVAILABLE; other codes stay per-directory', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    const { real, GetLastError, fail } = forcedErrors()
    const codeFor = async (code: number): Promise<{ code: unknown; opens: number }> => {
      let opens = 0
      const k: Kernel32 = {
        ...real,
        GetLastError,
        CreateFileW: fakeFn((...args) => {
          opens += 1
          fail(args.pop() as Callback, code, real.invalidHandle)
        })
      }
      const e = await createWin32Enumerator(log, k)
        .list(url(root), { signal: signal(), onBatch: noop })
        .then(
          () => null,
          (err: unknown) => err
        )
      return { code: (e as { code?: unknown } | null)?.code, opens }
    }
    // 53 BAD_NETPATH、64 NETNAME_DELETED、67 BAD_NET_NAME、121 SEM_TIMEOUT、1231 NETWORK_UNREACHABLE、
    // 21 NOT_READY：位置整体不可用，不再尝试只读打开
    for (const code of [21, 53, 64, 67, 121, 1231, 1232, 2250]) {
      expect(await codeFor(code), String(code)).toEqual({ code: 'FS_UNAVAILABLE', opens: 1 })
    }
    // 31 GEN_FAILURE、32 SHARING_VIOLATION、1117 IO_DEVICE：只是该目录的错误
    for (const code of [31, 32, 1117]) {
      expect((await codeFor(code)).code, String(code)).toBe('UNKNOWN')
    }
  })

  it('falls back to a read-only handle when the write-attributes open fails with another refusal', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    const { real, GetLastError, fail } = forcedErrors()
    const access: number[] = []
    const k: Kernel32 = {
      ...real,
      GetLastError,
      CreateFileW: fakeFn((...args) => {
        const cb = args.pop() as Callback
        access.push(args[1] as number)
        // 第一次（带 FILE_WRITE_ATTRIBUTES）以 50 ERROR_NOT_SUPPORTED 拒绝（部分 NAS）
        if (access.length === 1) fail(cb, 50, real.invalidHandle)
        else real.CreateFileW.async(...args, cb)
      }),
      CloseHandle: fakeFn((h, cb) => real.CloseHandle.async(h, cb))
    }
    const entries = await createWin32Enumerator(log, k).list(url(root), {
      signal: signal(),
      onBatch: noop
    })
    expect(byName(entries)['a.txt']).toMatchObject({ kind: 'file', size: 3 })
    expect(access).toHaveLength(2)
    expect(access[1]! & 0x0100).toBe(0) // 第二次不带写属性
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toContain('win32 error 50')
  })

  it('maps ERROR_INVALID_PARAMETER to not-a-directory only on the first batch of a non-directory', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'abc')
    const { real, GetLastError, fail } = forcedErrors()
    const listWith = (failOnCall: number): Promise<unknown> => {
      let calls = 0
      const k: Kernel32 = {
        ...real,
        GetLastError,
        GetFileInformationByHandleEx: fakeFn((...args) => {
          const cb = args.pop() as Callback
          calls += 1
          if (calls === failOnCall) fail(cb, 87, false)
          else real.GetFileInformationByHandleEx.async(...args, cb)
        })
      }
      return createWin32Enumerator(log, k)
        .list(url(root), { signal: signal(), onBatch: noop })
        .then(
          () => null,
          (e: unknown) => (e as { code?: unknown }).code
        )
    }
    // 第二批才返回 87：不是「不是目录」
    expect(await listWith(2)).toBe('UNKNOWN')
    // 第一批返回 87，但目标确实是目录
    expect(await listWith(1)).toBe('UNKNOWN')
  })

  it('delegates location keys to the shared locator', () => {
    expect(en.location('file:///C:/x')).toBe('local')
    expect(en.shareKey('file:///c:/x')).toBe('C:')
    expect(en.hostKey('file:///C:/x')).toBe('local')
    expect(en.location('file://Server/Share/dir')).toBe('network')
    expect(en.shareKey('file://Server/Share/dir')).toBe('\\\\server\\share')
    expect(en.hostKey('file://Server/Share/dir')).toBe('server')
  })
})
