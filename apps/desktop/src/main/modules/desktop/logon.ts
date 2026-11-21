import { createRequire } from 'node:module'

const WTS_CURRENT_SESSION = 0xffffffff
const WTS_SESSION_INFO = 24 // WTSSessionInfo
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const FILETIME_UNIX_EPOCH = 116444736000000000n // 1601-01-01 到 1970-01-01，100 ns 单位

/** FILETIME（100 ns，自 1601）转毫秒时间戳，取整到秒 */
function fileTimeToMs(ft: bigint): number {
  const ms = Number((ft - FILETIME_UNIX_EPOCH) / 10000n)
  return Math.floor(ms / 1000) * 1000
}

type Koffi = typeof import('koffi')

interface WtsNative {
  query: (...args: unknown[]) => unknown
  free: (p: unknown) => void
  decode: (p: unknown) => { LogonTime: bigint | number }
}

// koffi 的结构体同名重复定义会抛错，声明在进程内只做一次
let wtsNative: WtsNative | undefined

function loadWts(koffi: Koffi): WtsNative {
  if (wtsNative) return wtsNative
  const wtsapi32 = koffi.load('wtsapi32.dll')
  const WTSINFOW = koffi.struct('PchWTSINFOW', {
    State: 'int',
    SessionId: 'uint32',
    IncomingBytes: 'uint32',
    OutgoingBytes: 'uint32',
    IncomingFrames: 'uint32',
    OutgoingFrames: 'uint32',
    IncomingCompressedBytes: 'uint32',
    OutgoingCompressedBytes: 'uint32',
    WinStationName: koffi.array('uint16', 32),
    Domain: koffi.array('uint16', 17),
    UserName: koffi.array('uint16', 21),
    ConnectTime: 'int64',
    DisconnectTime: 'int64',
    LastInputTime: 'int64',
    LogonTime: 'int64',
    CurrentTime: 'int64'
  })
  const query = wtsapi32.func(
    'int WTSQuerySessionInformationW(void *hServer, uint32 SessionId, int WTSInfoClass, _Out_ void **ppBuffer, _Out_ uint32 *pBytesReturned)'
  )
  const free = wtsapi32.func('void WTSFreeMemory(void *p)')
  return (wtsNative = {
    query,
    free,
    decode: (p) => koffi.decode(p, WTSINFOW) as { LogonTime: bigint | number }
  })
}

function logonTimeFromWts(koffi: Koffi): number {
  const { query, free, decode } = loadWts(koffi)
  const buf: unknown[] = [null]
  const len = [0]
  if (!query(null, WTS_CURRENT_SESSION, WTS_SESSION_INFO, buf, len)) {
    throw new Error(`WTSQuerySessionInformationW failed (errno ${koffi.errno()})`)
  }
  try {
    const info = decode(buf[0])
    const ft = BigInt(info.LogonTime)
    if (ft <= 0n) throw new Error('WTS LogonTime is empty')
    return fileTimeToMs(ft)
  } finally {
    free(buf[0])
  }
}

interface ShellNative {
  getShellWindow: () => unknown
  getWindowThreadProcessId: (h: unknown, pid: number[]) => unknown
  openProcess: (access: number, inherit: number, pid: number) => unknown
  closeHandle: (h: unknown) => unknown
  getProcessTimes: (h: unknown, ...out: { lo: number; hi: number }[]) => unknown
}

let shellNative: ShellNative | undefined

function loadShell(koffi: Koffi): ShellNative {
  if (shellNative) return shellNative
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const GetShellWindow = user32.func('void *GetShellWindow()')
  const GetWindowThreadProcessId = user32.func(
    'uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *pid)'
  )
  const OpenProcess = kernel32.func('void *OpenProcess(uint32 access, int inherit, uint32 pid)')
  const CloseHandle = kernel32.func('int CloseHandle(void *h)')
  koffi.struct('PchFILETIME', { lo: 'uint32', hi: 'uint32' })
  const GetProcessTimes = kernel32.func(
    'int GetProcessTimes(void *h, _Out_ PchFILETIME *c, _Out_ PchFILETIME *e, _Out_ PchFILETIME *k, _Out_ PchFILETIME *u)'
  )
  return (shellNative = {
    getShellWindow: GetShellWindow,
    getWindowThreadProcessId: GetWindowThreadProcessId,
    openProcess: OpenProcess,
    closeHandle: CloseHandle,
    getProcessTimes: GetProcessTimes
  })
}

/** 退路：shell 进程（GetShellWindow 取 pid）的创建时刻 */
function logonTimeFromShell(koffi: Koffi): number {
  const n = loadShell(koffi)
  const shell = n.getShellWindow()
  if (!shell) throw new Error('no shell window')
  const pid = [0]
  n.getWindowThreadProcessId(shell, pid)
  const h = n.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid[0]!)
  if (!h) throw new Error(`OpenProcess(shell pid ${pid[0]}) failed`)
  try {
    const c = { lo: 0, hi: 0 }
    if (!n.getProcessTimes(h, c, { lo: 0, hi: 0 }, { lo: 0, hi: 0 }, { lo: 0, hi: 0 })) {
      throw new Error('GetProcessTimes failed')
    }
    return fileTimeToMs((BigInt(c.hi) << 32n) | BigInt(c.lo))
  } finally {
    n.closeHandle(h)
  }
}

/**
 * 当前登录会话的开始时刻（毫秒时间戳，取整到秒），用来判断记录是否来自上一次登录。
 * 先用 WTS（WTSSessionInfo.LogonTime），失败退回 shell 进程的创建时刻；都失败则 reject。
 */
export function getLogonTime(): Promise<number> {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error(`not supported on ${process.platform}`))
  }
  try {
    const koffi = createRequire(import.meta.url)('koffi') as Koffi
    try {
      return Promise.resolve(logonTimeFromWts(koffi))
    } catch {
      return Promise.resolve(logonTimeFromShell(koffi))
    }
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)))
  }
}
