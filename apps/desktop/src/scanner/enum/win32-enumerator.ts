import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs/promises'
import { AppError } from '@pch/shared'
import { toAppError } from '../../main/vfs/errors'
import { fileUriToLocalPath } from '../../main/vfs/local-path'
import { hostKey, location, shareKey } from '../../main/vfs/location'
import { mapLimited, resolveTarget, throwIfAborted } from './fs-enumerator'
import type { Enumerator, RawEntry } from './types'

type Koffi = typeof import('koffi')
type NativeFn = ReturnType<import('koffi').LibraryHandle['func']>

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
// Win32 错误码
const ERROR_FILE_NOT_FOUND = 2
const ERROR_PATH_NOT_FOUND = 3
const ERROR_ACCESS_DENIED = 5
const ERROR_WRITE_PROTECT = 19
const ERROR_NO_MORE_FILES = 18
const ERROR_INVALID_PARAMETER = 87
const ERROR_DIRECTORY = 267

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

interface Kernel32 {
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
function loadKernel32(): Kernel32 {
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
      // 网络类（53 ERROR_BAD_NETPATH、64 ERROR_NETNAME_DELETED、67 ERROR_BAD_NET_NAME、
      // 1231 ERROR_NETWORK_UNREACHABLE 等）与其他未知错误：位置暂时不可用
      return new AppError({ code: 'FS_UNAVAILABLE', detail })
  }
}

/**
 * koffi 调用 Win32 API 的枚举器。
 * 目录以 FILE_WRITE_ATTRIBUTES 打开，并把句柄的 LastAccessTime 设为 -1（MS-FSCC：此句柄上
 * 后续操作不更新访问时间），再在同一句柄上用 GetFileInformationByHandleEx 枚举——
 * 普通枚举会把目录自身的最后访问时间更新为当前时间。拿不到写属性权限时用只读句柄枚举
 * （此时无法保护访问时间），每个共享 / 盘符只记一次日志。
 */
export function createWin32Enumerator(log: (msg: string) => void): Enumerator {
  const k = loadKernel32()
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

  const openDir = async (uri: string, p: string): Promise<bigint> => {
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
    if (isValid(rw.value)) {
      const info = Buffer.alloc(BASIC_INFO_SIZE) // 其他时间为 0、属性为 0：不修改
      info.writeBigInt64LE(-1n, BASIC_LAST_ACCESS_TIME)
      const set = await callAsync(
        k,
        k.SetFileInformationByHandle,
        rw.value,
        FileBasicInfo,
        info,
        BASIC_INFO_SIZE
      )
      if (!set.value) warnUnprotected(uri, `SetFileInformationByHandle: win32 error ${set.error}`)
      return rw.value
    }
    // 只读共享、ACL 不允许写属性、写保护的介质：退回只读句柄
    if (rw.error !== ERROR_ACCESS_DENIED && rw.error !== ERROR_WRITE_PROTECT) {
      throw win32Error(rw.error, p)
    }
    const ro = await open(FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES)
    if (!isValid(ro.value)) throw win32Error(ro.error, p)
    warnUnprotected(uri, `no write-attributes access: win32 error ${rw.error}`)
    return ro.value
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
        // 打开的是文件而不是目录（已实测）
        if (r.error === ERROR_INVALID_PARAMETER) throw win32Error(ERROR_DIRECTORY, p)
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
        const data = Buffer.alloc(ATTR_DATA_SIZE)
        const r = await callAsync(
          k,
          k.GetFileAttributesExW,
          path.win32.toNamespacedPath(p),
          0, // GetFileExInfoStandard
          data
        )
        throwIfAborted(signal)
        if (!r.value) throw win32Error(r.error, p)
        const attrs = data.readUInt32LE(0)
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
        const h = await openDir(uri, p)
        let entries: RawEntry[]
        try {
          entries = await readAll(h, p, signal, onBatch)
        } finally {
          await callAsync(k, k.CloseHandle, h).catch(() => {})
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
