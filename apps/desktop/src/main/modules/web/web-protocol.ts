import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { AppError, type ErrorCode } from '@pch/shared'
import { toAppError } from '../../vfs/errors'
import type { VfsService } from '../../vfs/vfs.service'
import { MARKDOWN_CSP, MARKDOWN_MAX_BYTES, markdownShell } from './markdown-shell'
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
 * 每个请求 打开 → 读 → 关闭；响应体被取消或请求中止时销毁流（关闭句柄）。
 * 查询参数只认两个（设计 5.4），其余忽略：
 * - `pch-view=markdown`：文件存在时返回 Markdown 外壳页（带 CSP 响应头），不读文件内容
 * - `pch-raw=1`：原始字节（`application/octet-stream`，上限 MARKDOWN_MAX_BYTES，超过 413），供查看脚本 fetch
 */
export function createWebProtocolHandler(deps: {
  scopes: ScopeTable
  vfs: WebVfs
  /** 外壳 HTML（开发模式的脚本地址不同，由组合根生成）；省略时为生产的外壳 */
  markdownShell?: string
}): (request: Request) => Promise<Response> {
  const { scopes, vfs } = deps
  const shell = deps.markdownShell ?? markdownShell()
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return fail(405, { Allow: 'GET, HEAD' })
    }
    const target = fromWebUrl(request.url, scopes)
    if (!target) return fail(isScopeRegistered(request.url, scopes) ? 403 : 404)
    const query = new URL(request.url).searchParams
    const view = query.get('pch-view') === 'markdown'
    const raw = query.get('pch-raw') === '1'

    try {
      const stat = await vfs.stat(target.uri)
      if (stat.kind === 'directory') return fail(404)
      if (view) {
        return new Response(request.method === 'HEAD' ? null : shell, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': MARKDOWN_CSP,
            'Cache-Control': 'no-store'
          }
        })
      }
      const size = stat.size
      if (raw && size > MARKDOWN_MAX_BYTES) return fail(413)
      const range = raw ? null : parseRange(request.headers.get('Range'), size)
      if (range === 'unsatisfiable') return fail(416, { 'Content-Range': `bytes */${size}` })

      const length = range ? range.end - range.start + 1 : size
      const headers: Record<string, string> = {
        'Content-Type': raw ? 'application/octet-stream' : mimeOf(target.uri),
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

/** pch-asset 的主机名（外壳中的地址 `pch-asset://viewer/…`） */
export const ASSET_HOST = 'viewer'

/** pch-asset 在生产模式下只提供这些扩展名（查看脚本、分块、样式、source map） */
const ASSET_EXTENSIONS = new Set(['.js', '.css', '.map'])

/**
 * pch-asset 的来源：
 * - files：生产，产物目录（out/web-assets/markdown，位于 asar 内）中白名单扩展名的文件
 * - dev：开发模式，所有路径原样代理到 renderer dev server（外壳的脚本地址为 `/@fs/<main.ts 的绝对路径>`，
 *   其中的 import 也都是 dev server 的根相对路径；台账 S9）
 */
export type AssetSource =
  | { kind: 'files'; root: string }
  | { kind: 'dev'; origin: string; fetch: (url: string) => Promise<Response> }

/** 跨源许可：外壳页是 pch-web 源，module 脚本与动态分块以 CORS 模式请求 pch-asset */
const ASSET_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store'
}

/**
 * `pch-asset://` 协议处理器（设计 5.4）：只提供应用自带的 Markdown 查看脚本及其分块，与用户文件完全分开。
 * 生产模式：路径逐段解码后拒绝空段、`.` / `..`、含 `/`、`\`、NUL 的段，拼接后复核仍在产物目录之下，
 * 扩展名不在白名单 → 404
 */
export function createAssetProtocolHandler(
  source: AssetSource
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return fail(405, { Allow: 'GET, HEAD' })
    }
    const u = new URL(request.url)
    if (u.hostname !== ASSET_HOST) return fail(404)

    if (source.kind === 'dev') {
      const res = await source.fetch(new URL(u.pathname + u.search, source.origin).href)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(ASSET_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    const segments: string[] = []
    for (const r of u.pathname.split('/').slice(1)) {
      let seg: string
      try {
        seg = decodeURIComponent(r)
      } catch {
        return fail(404)
      }
      if (seg === '' || seg === '.' || seg === '..' || /[/\\\0]/.test(seg)) return fail(404)
      segments.push(seg)
    }
    const root = path.resolve(source.root)
    const file = path.join(root, ...segments)
    if (segments.length === 0 || !file.startsWith(root + path.sep)) return fail(404)
    if (!ASSET_EXTENSIONS.has(path.extname(file).toLowerCase())) return fail(404)

    try {
      const bytes = await readFile(file)
      return new Response(request.method === 'HEAD' ? null : bytes, {
        headers: { 'Content-Type': mimeOf(file.replace(/\\/g, '/')), ...ASSET_HEADERS }
      })
    } catch {
      return fail(404)
    }
  }
}

/**
 * pch-asset 的发起方检查：只放行无发起方与来自 pch-web 页面（Markdown 外壳）的请求，其余 403——
 * 应用窗口、外站、不透明源都不能取得查看脚本
 */
export function guardAssetInitiator(
  handler: (request: Request) => Promise<Response>
): (request: ProtocolRequest) => Promise<Response> {
  return async (request) => {
    const initiator = request.initiatorOrigin
    if (initiator !== undefined && !/^pch-web:\/\/[^/]+$/.test(initiator)) return fail(403)
    return handler(request)
  }
}
