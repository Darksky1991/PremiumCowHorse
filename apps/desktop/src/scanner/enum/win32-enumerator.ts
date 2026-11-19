import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs/promises'
import { AppError } from '@pch/shared'
import { toAppError } from '../../main/vfs/errors'
import { mapLimited, resolveTarget, throwIfAborted } from '../../main/vfs/fs-list'
import { fileUriToLocalPath } from '../../main/vfs/local-path'
import { hostKey, location, shareKey } from '../../main/vfs/location'
import type { Enumerator, RawEntry } from './types'

type Koffi = typeof import('koffi')
export type NativeFn = ReturnType<import('koffi').LibraryHandle['func']>

// CreateFileW
const FILE_LIST_DIRECTORY = 0x0001
const FILE_READ_ATTRIBUTES = 0x0080
const FILE_WRITE_ATTRIBUTES = 0x0100
const FILE_SHARE_ALL = 0x1 | 0x2 | 0x4 // READ | WRITE | DELETE：不妨碍其他程序改名、删除
const OPEN_EXISTING = 3
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000 // 打开目录必需
// FILE_INFO_BY_HANDLE_CLASS（minwinbase.h）
const FileBasicInfo = 0
const FileFullDirectoryInfo = 14
const FileFullDirectoryRestartInfo = 15
// 文件属性
const FILE_ATTRIBUTE_HIDDEN = 0x02
const FILE_ATTRIBUTE_DIRECTORY = 0x10
const FILE_ATTRIBUTE_REPARSE_POINT = 0x400
/**
 * 按链接处理的重解析标签（与 libuv 的 lstat 判为 S_IFLNK 的范围一致）：符号链接、
 * 目录联接 / 挂载点、应用执行别名。其他标签（OneDrive 等云文件占位、重复数据删除等）
 * 是普通文件 / 目录，按 DIRECTORY 属性判断。
 */
const LINK_TAGS = new Set([0xa000000c, 0xa0000003, 0x8000001b])
// Win32 错误码（含义见 Microsoft Learn「System Error Codes」）
const ERROR_FILE_NOT_FOUND = 2
const ERROR_PATH_NOT_FOUND = 3
const ERROR_ACCESS_DENIED = 5
const ERROR_NO_MORE_FILES = 18
const ERROR_INVALID_PARAMETER = 87
const ERROR_DIRECTORY = 267

/**
 * 确定表示「位置整体不可用」的错误码：网络路径 / 连接 / 主机不可达，或设备未就绪 / 未连接。
 * 只有这些映射为 FS_UNAVAILABLE（调度器据此判定整个共享 / 卷断开）；其他未知错误码只是
 * 该目录的错误（UNKNOWN，目录状态记为 unreachable，按 P2 间隔重试），不影响同一位置的其他目录。
 */
const UNAVAILABLE_ERRORS = new Set([
  15, // ERROR_INVALID_DRIVE：The system cannot find the drive specified.
  21, // ERROR_NOT_READY：The device is not ready.
  51, // ERROR_REM_NOT_LIST：Windows cannot find the network path.
  53, // ERROR_BAD_NETPATH：The network path was not found.
  55, // ERROR_DEV_NOT_EXIST：The specified network resource or device is no longer available.
  59, // ERROR_UNEXP_NET_ERR：An unexpected network error occurred.
  64, // ERROR_NETNAME_DELETED：The specified network name is no longer available.
  67, // ERROR_BAD_NET_NAME：The network name cannot be found.
  121, // ERROR_SEM_TIMEOUT：The semaphore timeout period has expired.（SMB 的网络超时）
  1167, // ERROR_DEVICE_NOT_CONNECTED：The device is not connected.
  1201, // ERROR_CONNECTION_UNAVAIL：The device is not currently connected but it is a remembered connection.
  1222, // ERROR_NO_NETWORK：The network is not present or not started.
  1225, // ERROR_CONNECTION_REFUSED：The remote computer refused the network connection.
  1231, // ERROR_NETWORK_UNREACHABLE：The network location cannot be reached.
  1232, // ERROR_HOST_UNREACHABLE：The network location cannot be reached.
  1236, // ERROR_CONNECTION_ABORTED：The network connection was aborted by the local system.
  1256, // ERROR_HOST_DOWN：The remote system is not available.
  2250 // ERROR_NOT_CONNECTED：This network connection does not exist.
])

/** GetFileInformationByHandleEx 的输出缓冲：一次系统调用（网络上一次往返）取回的量 */
const BUFFER_SIZE = 64 * 1024
const LINK_CONCURRENCY = 16

/**
 * FILE_FULL_DIR_INFO（winbase.h；字段含义见 MS-FSCC 2.4.17 FileFullDirectoryInformation）的偏移。
 * 各项按 8 字节对齐，NextEntryOffset 为 0 表示本批最后一项。
 */
const DIR = {
  nextEntryOffset: 0,
  lastWriteTime: 24,
  endOfFile: 40,
  fileAttributes: 56,
  fileNameLength: 60, // 字节数
  eaSize: 64, // 有 REPARSE_POINT 属性时为重解析标签（MS-FSCC）
  fileName: 68
}
/** FILE_BASIC_INFO：4 个 LARGE_INTEGER 时间 + DWORD 属性，按 8 字节对齐为 40 字节 */
const BASIC_INFO_SIZE = 40
const BASIC_LAST_ACCESS_TIME = 8
/** WIN32_FILE_ATTRIBUTE_DATA：DWORD 属性 + 3 个 FILETIME + 2 个 DWORD，共 36 字节 */
const ATTR_DATA_SIZE = 36
const ATTR_LAST_WRITE_TIME = 20

export interface Kernel32 {
  koffi: Koffi
  CreateFileW: NativeFn
  SetFileInformationByHandle: NativeFn
  GetFileInformationByHandleEx: NativeFn
  GetFileAttributesExW: NativeFn
  CloseHandle: NativeFn
  GetLastError: NativeFn
  invalidHandle: bigint
}

let kernel32: Kernel32 | undefined

/** 加载 koffi 与 kernel32 的函数（进程内一次）；失败时抛出，由 createEnumerator 回退到 fs */
export function loadKernel32(): Kernel32 {
  if (kernel32) return kernel32
  if (process.platform !== 'win32') throw new Error(`not Windows (${process.platform})`)
  const koffi = createRequire(import.meta.url)('koffi') as Koffi
  const lib = koffi.load('kernel32.dll')
  kernel32 = {
    koffi,
    CreateFileW: lib.func(
      'void * __stdcall CreateFileW(const char16_t *lpFileName, uint32_t dwDesiredAccess, uint32_t dwShareMode, void *lpSecurityAttributes, uint32_t dwCreationDisposition, uint32_t dwFlagsAndAttributes, void *hTemplateFile)'
    ),
    SetFileInformationByHandle: lib.func(
      'bool __stdcall SetFileInformationByHandle(void *hFile, int FileInformationClass, void *lpFileInformation, uint32_t dwBufferSize)'
    ),
    GetFileInformationByHandleEx: lib.func(
      'bool __stdcall GetFileInformationByHandleEx(void *hFile, int FileInformationClass, _Out_ void *lpFileInformation, uint32_t dwBufferSize)'
    ),
    GetFileAttributesExW: lib.func(
      'bool __stdcall GetFileAttributesExW(const char16_t *lpFileName, int fInfoLevelId, _Out_ void *lpFileInformation)'
    ),
    CloseHandle: lib.func('bool __stdcall CloseHandle(void *hObject)'),
    GetLastError: lib.func('uint32_t __stdcall GetLastError()'),
    // INVALID_HANDLE_VALUE = (HANDLE)-1；koffi 3 的指针是 BigInt
    invalidHandle: BigInt.asUintN(koffi.sizeof('void *') * 8, -1n)
  }
  return kernel32
}

/**
 * 在 koffi 的工作线程上调用（不阻塞事件循环；网络上的调用可能很慢）。
 * GetLastError 必须在回调内读取：koffi 只在回调执行期间恢复工作线程上的错误码。
 */
function callAsync(
  k: Kernel32,
  fn: NativeFn,
  ...args: unknown[]
): Promise<{ value: unknown; error: number }> {
  return new Promise((resolve, reject) => {
    fn.async(...args, (err: unknown, value: unknown) => {
      if (err) reject(err)
      else resolve({ value, error: k.GetLastError() as number })
    })
  })
}

/** FILETIME（1601 年起的 100ns）→ Unix 毫秒；与 Node 的 mtimeMs 同样按「秒 + 纳秒」换算 */
function filetimeToMs(ft: bigint): number {
  const t = ft - 116444736000000000n
  return Number(t / 10_000_000n) * 1000 + Number((t % 10_000_000n) * 100n) / 1e6
}

function win32Error(code: number, p: string): AppError {
  const detail = `win32 error ${code}: ${p}`
  switch (code) {
    case ERROR_FILE_NOT_FOUND:
    case ERROR_PATH_NOT_FOUND:
      return new AppError({ code: 'FS_NOT_FOUND', detail })
    case ERROR_ACCESS_DENIED:
      return new AppError({ code: 'FS_PERMISSION_DENIED', detail })
    case ERROR_DIRECTORY:
      return new AppError({ code: 'FS_NOT_A_DIRECTORY', detail })
    default:
      // 确定的网络 / 设备类错误：位置暂时不可用；其余（含不认识的码）只算该目录的错误
      return new AppError({
        code: UNAVAILABLE_ERRORS.has(code) ? 'FS_UNAVAILABLE' : 'UNKNOWN',
        detail
      })
  }
}

/** 路径不存在（2 / 3）或位置整体不可用：再以只读方式打开也不会成功 */
const isFinalOpenError = (code: number): boolean =>
  code === ERROR_FILE_NOT_FOUND || code === ERROR_PATH_NOT_FOUND || UNAVAILABLE_ERRORS.has(code)

/**
 * koffi 调用 Win32 API 的枚举器。
 * 目录以 FILE_WRITE_ATTRIBUTES 打开，并把句柄的 LastAccessTime 设为 -1（MS-FSCC：此句柄上
 * 后续操作不更新访问时间），再在同一句柄上用 GetFileInformationByHandleEx 枚举——
 * 普通枚举会把目录自身的最后访问时间更新为当前时间。以写属性打开失败（不存在与网络 / 设备
 * 不可用除外）时用只读句柄枚举（此时无法保护访问时间），每个共享 / 盘符只记一次日志。
 * 错误分类：只有确定的网络 / 设备类 Win32 错误码为 FS_UNAVAILABLE（UNAVAILABLE_ERRORS），
 * 其他未知错误码为 UNKNOWN（只影响该目录）。
 */
export function createWin32Enumerator(
  log: (msg: string) => void,
  /** 测试用：替换个别原生函数（例如注入会失败的调用） */
  k: Kernel32 = loadKernel32()
): Enumerator {
  const warned = new Set<string>()
  const warnUnprotected = (uri: string, reason: string): void => {
    const key = shareKey(uri)
    if (warned.has(key)) return
    warned.add(key)
    log(
      `[enumerator] cannot protect the last access time of directories on ${key} (${reason}); the system may update it when listing, first seen at ${uri}`
    )
  }

  const isValid = (h: unknown): h is bigint =>
    typeof h === 'bigint' && h !== 0n && h !== k.invalidHandle

  /**
   * 打开目录句柄。writable = 以 FILE_WRITE_ATTRIBUTES 打开（可以保护访问时间）。
   * 这里只打开，不做其他调用：句柄一旦得到就由调用方的 try/finally 负责关闭。
   */
  const openDir = async (uri: string, p: string): Promise<{ h: bigint; writable: boolean }> => {
    const name = path.win32.toNamespacedPath(p) // \\?\ 前缀：路径超过 260 字符也能打开
    const open = (access: number): Promise<{ value: unknown; error: number }> =>
      callAsync(
        k,
        k.CreateFileW,
        name,
        access,
        FILE_SHARE_ALL,
        null,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS,
        null
      )
    const rw = await open(FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES)
    if (isValid(rw.value)) return { h: rw.value, writable: true }
    // 只读共享、ACL 不允许写属性、写保护的介质，以及不支持写属性的 NAS 等返回的其他拒绝码：
    // 退回只读句柄。只有不存在与网络 / 设备不可用时直接报错（只读打开也不会成功）
    if (isFinalOpenError(rw.error)) throw win32Error(rw.error, p)
    const ro = await open(FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES)
    if (!isValid(ro.value)) throw win32Error(ro.error, p)
    warnUnprotected(uri, `no write-attributes access: win32 error ${rw.error}`)
    return { h: ro.value, writable: false }
  }

  /** 把句柄的 LastAccessTime 设为 -1：其他时间为 0、属性为 0（均不修改）；失败只记日志 */
  const protectAccessTime = async (uri: string, h: bigint): Promise<void> => {
    const info = Buffer.alloc(BASIC_INFO_SIZE)
    info.writeBigInt64LE(-1n, BASIC_LAST_ACCESS_TIME)
    const set = await callAsync(
      k,
      k.SetFileInformationByHandle,
      h,
      FileBasicInfo,
      info,
      BASIC_INFO_SIZE
    )
    if (!set.value) warnUnprotected(uri, `SetFileInformationByHandle: win32 error ${set.error}`)
  }

  /** 关闭句柄；异步调用本身失败（如 koffi 的异步队列已满）时退回同步调用，保证不残留 */
  const closeHandle = async (h: bigint): Promise<void> => {
    try {
      await callAsync(k, k.CloseHandle, h)
    } catch {
      try {
        k.CloseHandle(h)
      } catch {
        // 无法再做什么：同步调用也失败只可能是 koffi 自身异常
      }
    }
  }

  /** GetFileAttributesExW（不跟随链接，不打开句柄，不更新访问时间） */
  const queryAttributes = async (
    p: string
  ): Promise<{ ok: true; attrs: number; data: Buffer } | { ok: false; error: number }> => {
    const data = Buffer.alloc(ATTR_DATA_SIZE)
    const r = await callAsync(
      k,
      k.GetFileAttributesExW,
      path.win32.toNamespacedPath(p),
      0, // GetFileExInfoStandard
      data
    )
    if (!r.value) return { ok: false, error: r.error }
    return { ok: true, attrs: data.readUInt32LE(0), data }
  }

  /** 确认 p 存在且不是目录；查询失败（无法确认）时为 false */
  const isNotDirectory = async (p: string): Promise<boolean> => {
    const a = await queryAttributes(p)
    return a.ok && !(a.attrs & FILE_ATTRIBUTE_DIRECTORY)
  }

  const readAll = async (
    h: bigint,
    p: string,
    signal: AbortSignal,
    onBatch: () => void
  ): Promise<RawEntry[]> => {
    const entries: RawEntry[] = []
    const buf = Buffer.alloc(BUFFER_SIZE)
    for (let first = true; ; first = false) {
      throwIfAborted(signal)
      const cls = first ? FileFullDirectoryRestartInfo : FileFullDirectoryInfo
      const r = await callAsync(k, k.GetFileInformationByHandleEx, h, cls, buf, BUFFER_SIZE)
      if (!r.value) {
        if (r.error === ERROR_NO_MORE_FILES) break
        // 没有任何项（连 . 与 .. 都没有，如空的卷根目录）时首次查询返回 FILE_NOT_FOUND（未实测）
        if (first && r.error === ERROR_FILE_NOT_FOUND) break
        // 打开的是文件而不是目录时第一次查询返回 87（已实测）。87 也可能有其他原因（例如部分
        // 文件系统不支持该信息类）：只在第一批、且确认目标不是目录时才当作「不是目录」
        if (r.error === ERROR_INVALID_PARAMETER && first && (await isNotDirectory(p))) {
          throw win32Error(ERROR_DIRECTORY, p)
        }
        throw win32Error(r.error, p)
      }
      parseBatch(buf, entries)
      onBatch()
    }
    return entries
  }

  return {
    native: true,

    async statDir(uri, signal) {
      try {
        throwIfAborted(signal)
        const p = fileUriToLocalPath(uri)
        const r = await queryAttributes(p)
        throwIfAborted(signal)
        if (!r.ok) throw win32Error(r.error, p)
        const { attrs, data } = r
        if (!(attrs & FILE_ATTRIBUTE_DIRECTORY)) throw win32Error(ERROR_DIRECTORY, p)
        // GetFileAttributesExW 不跟随链接：目录联接 / 符号链接取目标目录的修改时间
        if (attrs & FILE_ATTRIBUTE_REPARSE_POINT) {
          const s = await fs.stat(p)
          if (!s.isDirectory()) throw win32Error(ERROR_DIRECTORY, p)
          return { mtime: s.mtimeMs }
        }
        return { mtime: filetimeToMs(data.readBigUInt64LE(ATTR_LAST_WRITE_TIME)) }
      } catch (e) {
        throw toAppError(e)
      }
    },

    async list(uri, { signal, onBatch }) {
      try {
        throwIfAborted(signal)
        const p = fileUriToLocalPath(uri)
        const { h, writable } = await openDir(uri, p)
        let entries: RawEntry[]
        // 从得到句柄到枚举结束的任何失败（含 koffi 层的异常、中止）都关闭句柄
        try {
          if (writable) await protectAccessTime(uri, h)
          entries = await readAll(h, p, signal, onBatch)
        } finally {
          await closeHandle(h)
        }
        const links = entries.filter((e) => e.kind === 'symlink')
        await mapLimited(links, LINK_CONCURRENCY, signal, async (e) => {
          e.target = await resolveTarget(path.join(p, e.name))
        })
        throwIfAborted(signal)
        return entries
      } catch (e) {
        throw toAppError(e)
      }
    },

    location,
    shareKey,
    hostKey
  }
}

/** 解析一批 FILE_FULL_DIR_INFO，跳过 . 与 .. */
function parseBatch(buf: Buffer, out: RawEntry[]): void {
  for (let off = 0; ;) {
    const nameStart = off + DIR.fileName
    const name = buf.toString(
      'utf16le',
      nameStart,
      nameStart + buf.readUInt32LE(off + DIR.fileNameLength)
    )
    if (name !== '.' && name !== '..') {
      const attrs = buf.readUInt32LE(off + DIR.fileAttributes)
      const isLink =
        (attrs & FILE_ATTRIBUTE_REPARSE_POINT) !== 0 &&
        LINK_TAGS.has(buf.readUInt32LE(off + DIR.eaSize))
      const kind = isLink ? 'symlink' : attrs & FILE_ATTRIBUTE_DIRECTORY ? 'directory' : 'file'
      out.push({
        name,
        kind,
        size: kind === 'file' ? Number(buf.readBigInt64LE(off + DIR.endOfFile)) : 0,
        mtime: filetimeToMs(buf.readBigInt64LE(off + DIR.lastWriteTime)),
        // 有 HIDDEN 即隐藏（含 HIDDEN + SYSTEM）；只有 SYSTEM 的项照常显示（与资源管理器一致）
        hidden: (attrs & FILE_ATTRIBUTE_HIDDEN) !== 0
      })
    }
    const next = buf.readUInt32LE(off + DIR.nextEntryOffset)
    if (next === 0) return
    off += next
  }
}
