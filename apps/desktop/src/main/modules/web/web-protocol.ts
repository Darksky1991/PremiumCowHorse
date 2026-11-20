import { Readable } from 'node:stream'
import { AppError, type ErrorCode } from '@pch/shared'
import { toAppError } from '../../vfs/errors'
import type { VfsService } from '../../vfs/vfs.service'
import { mimeOf } from './mime'
import { fromWebUrl, isScopeRegistered, type ScopeTable } from './scope'

type WebVfs = Pick<VfsService, 'stat' | 'createReadStream' | 'read'>

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  FS_NOT_FOUND: 404,
  FS_NOT_A_DIRECTORY: 404,
  FS_PERMISSION_DENIED: 403,
  FS_INVALID_URI: 400,
  FS_UNAVAILABLE: 502, // 共享不可达 / 中断
  FS_TIMEOUT: 504,
  FS_CANCELLED: 499
}

function fail(status: number, headers?: HeadersInit): Response {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

function failFrom(e: unknown): Response {
  const err = e instanceof AppError ? e : toAppError(e)
  return fail(STATUS_BY_CODE[err.code] ?? 500)
}

type ParsedRange = { start: number; end: number } | 'unsatisfiable' | null

/** 解析 Range（只支持单个 bytes 区间；多区间 / 非法 → null，即忽略并返回整个文件） */
function parseRange(header: string | null, size: number): ParsedRange {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  if (m[1] === '') {
    const n = Number(m[2])
    if (n === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(m[1])
  if (m[2] !== '' && Number(m[2]) < start) return null
  if (start >= size) return 'unsatisfiable'
  return { start, end: m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1) }
}

/**
 * `pch-web://` 协议处理器：范围内的本地文件只读读取（注册到浏览器视图的会话在 Task 6）。
 * 每个请求 打开 → 读 → 关闭；响应体被取消或请求中止时销毁流（关闭句柄）。查询参数一律忽略。
 */
export function createWebProtocolHandler(deps: {
  scopes: ScopeTable
  vfs: WebVfs
}): (request: Request) => Promise<Response> {
  const { scopes, vfs } = deps
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return fail(405, { Allow: 'GET, HEAD' })
    }
    const target = fromWebUrl(request.url, scopes)
    if (!target) return fail(isScopeRegistered(request.url, scopes) ? 403 : 404)

    try {
      const stat = await vfs.stat(target.uri)
      if (stat.kind === 'directory') return fail(404)
      const size = stat.size
      const range = parseRange(request.headers.get('Range'), size)
      if (range === 'unsatisfiable') return fail(416, { 'Content-Range': `bytes */${size}` })

      const length = range ? range.end - range.start + 1 : size
      const headers: Record<string, string> = {
        'Content-Type': mimeOf(target.uri),
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(length)
      }
      if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
      const status = range ? 206 : 200

      if (request.method === 'HEAD' || length === 0) return new Response(null, { status, headers })

      const stream = await vfs.createReadStream(target.uri, range ?? undefined, request.signal)
      const body = Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>
      return new Response(body, { status, headers })
    } catch (e) {
      return failFrom(e)
    }
  }
}

/** Electron 的 protocol.handle 在标准 Request 上追加的字段：发起请求的源（不透明源为 "null"；浏览器自身发起时不存在） */
type ProtocolRequest = Request & { initiatorOrigin?: string }

/**
 * 发起方检查（包在 pch-web 处理器外）：只放行「无发起方」（视图的主框架加载 = 应用的 loadURL / reload）
 * 与「与被请求资源同一 `pch-web://<范围编号>` 源」的请求，其余 403——页面里嵌入的外站 iframe、
 * 其他范围的页面、不透明源（沙箱 iframe、data: 框架）不能读取本地资源。
 * 用 initiatorOrigin 而非 Referer：前者不受页面控制（electron.d.ts 的 Protocol.handle 说明）。
 * 期望的源手工拼接：WHATWG URL 对非特殊 scheme 的 origin 一律为 "null"，Chromium 中 pch-web 是标准 scheme
 */
export function guardInitiator(
  handler: (request: Request) => Promise<Response>
): (request: ProtocolRequest) => Promise<Response> {
  return async (request) => {
    const initiator = request.initiatorOrigin
    if (initiator !== undefined && URL.canParse(request.url)) {
      const u = new URL(request.url)
      if (initiator !== `${u.protocol}//${u.host}`) return fail(403)
    }
    return handler(request)
  }
}
