import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError, type FileStat } from '@pch/shared'
import { LocalProvider } from '../../vfs/providers/local.provider'
import { VfsService } from '../../vfs/vfs.service'
import { ScopeTable, toWebUrl } from './scope'
import { MARKDOWN_CSP, MARKDOWN_MAX_BYTES } from './markdown-shell'
import {
  createAssetProtocolHandler,
  createWebProtocolHandler,
  guardAssetInitiator,
  guardInitiator
} from './web-protocol'

const unused = (): never => {
  throw new Error('unused')
}
const fileStat = (size: number): FileStat => ({
  uri: '',
  name: 'x',
  kind: 'file',
  size,
  mtime: 0
})
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('createWebProtocolHandler', () => {
  let tmp: string
  let root: string
  let rootUri: string
  let scopes: ScopeTable
  let handler: (r: Request) => Promise<Response>
  let id: string
  const html = '<h1>こんにちは</h1>'
  const bytes = Buffer.from(Array.from({ length: 100 }, (_, i) => i))

  const get = (p: string, init?: RequestInit): Promise<Response> =>
    handler(new Request(`pch-web://${id}${p}`, init))

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'pch-web-'))
    root = path.join(tmp, '案件 A')
    mkdirSync(path.join(root, 'proto', 'dir.d'), { recursive: true })
    writeFileSync(path.join(root, 'proto', 'index.html'), html)
    writeFileSync(path.join(root, 'proto', 'a b#1.bin'), bytes)
    writeFileSync(path.join(root, 'proto', 'empty.txt'), '')
    writeFileSync(path.join(tmp, 'secret.txt'), 'SECRET')
    rootUri = pathToFileURL(root).href
    scopes = new ScopeTable()
    id = scopes.register(rootUri)
    handler = createWebProtocolHandler({ scopes, vfs: new VfsService([new LocalProvider()]) })
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('serves a file with headers and ignores unknown queries', async () => {
    const res = await get('/proto/index.html?v=1')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Length')).toBe(String(Buffer.byteLength(html)))
    expect(await res.text()).toBe(html)
  })

  it('serves a file whose name needs escaping, via toWebUrl', async () => {
    const uri = pathToFileURL(path.join(root, 'proto', 'a b#1.bin')).href
    const res = await handler(new Request(toWebUrl(uri, rootUri)))
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true)
  })

  it('serves an empty file', async () => {
    const res = await get('/proto/empty.txt')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it('answers HEAD without a body', async () => {
    const res = await get('/proto/index.html', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe(String(Buffer.byteLength(html)))
    expect(await res.text()).toBe('')
  })

  it('rejects other methods with 405', async () => {
    expect((await get('/proto/index.html', { method: 'POST', body: 'x' })).status).toBe(405)
  })

  it('serves a byte range as 206', async () => {
    const res = await get('/proto/a%20b%231.bin', { headers: { Range: 'bytes=10-19' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 10-19/100')
    expect(res.headers.get('Content-Length')).toBe('10')
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes.subarray(10, 20))).toBe(true)
  })

  it('supports open-ended and suffix ranges and clamps the end', async () => {
    const open = await get('/proto/a%20b%231.bin', { headers: { Range: 'bytes=90-' } })
    expect(open.headers.get('Content-Range')).toBe('bytes 90-99/100')
    const suffix = await get('/proto/a%20b%231.bin', { headers: { Range: 'bytes=-5' } })
    expect(suffix.headers.get('Content-Range')).toBe('bytes 95-99/100')
    expect(Buffer.from(await suffix.arrayBuffer()).equals(bytes.subarray(95))).toBe(true)
    const clamp = await get('/proto/a%20b%231.bin', { headers: { Range: 'bytes=95-500' } })
    expect(clamp.headers.get('Content-Range')).toBe('bytes 95-99/100')
  })

  it('answers an unsatisfiable range with 416', async () => {
    const res = await get('/proto/a%20b%231.bin', { headers: { Range: 'bytes=100-120' } })
    expect(res.status).toBe(416)
    expect(res.headers.get('Content-Range')).toBe('bytes */100')
  })

  it('ignores a malformed or multi range and serves the whole file', async () => {
    for (const range of ['bytes=a-b', 'bytes=1-2,5-6', 'items=1-2', 'bytes=5-2']) {
      const res = await get('/proto/a%20b%231.bin', { headers: { Range: range } })
      expect(res.status, range).toBe(200)
      expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true)
    }
  })

  it('returns 403 for paths that leave the scope', async () => {
    for (const p of [
      '/..%2fsecret.txt',
      '/proto/..%2f..%2fsecret.txt',
      '/%2e%2e%2fsecret.txt',
      '/proto%5c..%5c..%5csecret.txt'
    ]) {
      expect((await get(p)).status, p).toBe(403)
    }
  })

  it('never reads a file outside the scope through dot segments', async () => {
    for (const p of ['/%2e%2e/secret.txt', '/../secret.txt', '/proto/%2e%2e/%2e%2e/secret.txt']) {
      const res = await get(p)
      expect(await res.text(), p).not.toContain('SECRET')
    }
  })

  it('returns 404 for an unregistered scope id', async () => {
    const res = await handler(new Request('pch-web://0123456789abcdef/proto/index.html'))
    expect(res.status).toBe(404)
  })

  it('returns 404 for a missing file and for a directory', async () => {
    expect((await get('/proto/nope.html')).status).toBe(404)
    expect((await get('/proto/dir.d')).status).toBe(404)
    expect((await get('/proto/dir.d/')).status).toBe(404)
    expect((await get('/')).status).toBe(404)
  })

  it.each([
    ['FS_TIMEOUT', 504],
    ['FS_UNAVAILABLE', 502]
  ] as const)('maps %s from stat to %i', async (code, status) => {
    const h = createWebProtocolHandler({
      scopes,
      vfs: {
        stat: async () => {
          throw new AppError({ code })
        },
        createReadStream: unused,
        read: unused
      }
    })
    expect((await h(new Request(`pch-web://${id}/proto/index.html`))).status).toBe(status)
  })

  it.each([
    ['FS_TIMEOUT', 504],
    ['FS_UNAVAILABLE', 502]
  ] as const)('maps %s while opening the stream to %i', async (code, status) => {
    const h = createWebProtocolHandler({
      scopes,
      vfs: {
        stat: async () => fileStat(5),
        createReadStream: async () => {
          throw new AppError({ code })
        },
        read: unused
      }
    })
    expect((await h(new Request(`pch-web://${id}/proto/index.html`))).status).toBe(status)
  })

  it('destroys the stream when the response body is cancelled', async () => {
    const source = new Readable({ read: () => undefined })
    const h = createWebProtocolHandler({
      scopes,
      vfs: { stat: async () => fileStat(100), createReadStream: async () => source, read: unused }
    })
    const res = await h(new Request(`pch-web://${id}/a.bin`))
    source.push(Buffer.from('abc'))
    const reader = res.body!.getReader()
    await reader.read()
    await reader.cancel()
    await wait(20)
    expect(source.destroyed).toBe(true)
  })

  describe('Markdown（设计 5.4）', () => {
    beforeEach(() => {
      writeFileSync(path.join(root, 'proto', 'README.md'), '# 見出し\n')
      handler = createWebProtocolHandler({
        scopes,
        vfs: new VfsService([new LocalProvider()]),
        markdownShell: '<!doctype html><p>shell</p>'
      })
    })

    it('?pch-view=markdown → 外壳 HTML（带 CSP，不缓存），文档地址仍是 .md 本身', async () => {
      const res = await get('/proto/README.md?pch-view=markdown')
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
      expect(res.headers.get('Content-Security-Policy')).toBe(MARKDOWN_CSP)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(await res.text()).toBe('<!doctype html><p>shell</p>')
    })

    it('?pch-view=markdown：文件不存在 → 404，目录 → 404', async () => {
      expect((await get('/proto/missing.md?pch-view=markdown')).status).toBe(404)
      expect((await get('/proto/dir.d?pch-view=markdown')).status).toBe(404)
    })

    it('?pch-raw=1 → 原始字节（不按扩展名声明类型）', async () => {
      const res = await get('/proto/README.md?pch-raw=1')
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(await res.text()).toBe('# 見出し\n')
    })

    it('?pch-raw=1：超过上限 → 413，不打开文件', async () => {
      let opened = 0
      const h = createWebProtocolHandler({
        scopes,
        vfs: {
          stat: async () => fileStat(MARKDOWN_MAX_BYTES + 1),
          createReadStream: async () => {
            opened++
            return Readable.from([])
          },
          read: unused
        }
      })
      expect((await h(new Request(`pch-web://${id}/big.md?pch-raw=1`))).status).toBe(413)
      expect(opened).toBe(0)
    })
  })

  it('does not hold the file after the response was read: the folder can be renamed', async () => {
    const res = await get('/proto/a%20b%231.bin')
    await res.arrayBuffer()
    await wait(20)
    renameSync(root, path.join(tmp, '案件 B'))
  })
})

describe('guardInitiator', () => {
  const ok = async (): Promise<Response> => new Response('ok')
  const guarded = guardInitiator(ok)
  /** protocol.handle 的请求：标准 Request + Electron 追加的 initiatorOrigin（浏览器自身发起时不存在） */
  const req = (url: string, initiatorOrigin?: string): Request =>
    Object.assign(new Request(url), initiatorOrigin === undefined ? {} : { initiatorOrigin })

  it('无发起方（浏览器自身的主框架加载）→ 放行', async () => {
    expect((await guarded(req('pch-web://sabc/index.html'))).status).toBe(200)
  })

  it('同一 pch-web://<范围编号> 源 → 放行', async () => {
    expect((await guarded(req('pch-web://sabc/img/a.png', 'pch-web://sabc'))).status).toBe(200)
  })

  it('外站、其他范围、不透明源（"null"）、其他协议 → 403，不调用处理器', async () => {
    let called = 0
    const g = guardInitiator(async () => {
      called++
      return new Response('ok')
    })
    for (const origin of [
      'https://example.com',
      'pch-web://sdef',
      'null',
      'pch-asset://viewer',
      'pch-web://sabc.evil'
    ]) {
      const res = await g(req('pch-web://sabc/a.png', origin))
      expect(res.status, origin).toBe(403)
    }
    expect(called).toBe(0)
  })
})

describe('createAssetProtocolHandler（生产：产物目录内的白名单扩展名）', () => {
  let tmp: string
  let root: string
  let handler: (r: Request) => Promise<Response>

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'pch-asset-'))
    root = path.join(tmp, 'markdown')
    mkdirSync(path.join(root, 'chunks'), { recursive: true })
    writeFileSync(path.join(root, 'markdown.js'), 'export {}')
    writeFileSync(path.join(root, 'markdown.css'), 'body{}')
    writeFileSync(path.join(root, 'chunks', 'mermaid-x.js'), 'export const m = 1')
    writeFileSync(path.join(root, 'chunks', 'mermaid-x.js.map'), '{}')
    writeFileSync(path.join(root, 'index.html'), '<p>no</p>')
    writeFileSync(path.join(root, 'LICENSE'), 'no')
    writeFileSync(path.join(tmp, 'secret.js'), 'SECRET')
    handler = createAssetProtocolHandler({ kind: 'files', root })
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  const get = (p: string, init?: RequestInit): Promise<Response> =>
    handler(new Request(`pch-asset://viewer${p}`, init))

  it('提供查看脚本、样式与分块（允许跨源加载：页面是 pch-web 源）', async () => {
    const js = await get('/markdown.js')
    expect(js.status).toBe(200)
    expect(js.headers.get('Content-Type')).toBe('text/javascript')
    expect(js.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(js.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await js.text()).toBe('export {}')
    const css = await get('/markdown.css')
    expect(css.headers.get('Content-Type')).toBe('text/css')
    expect(await css.text()).toBe('body{}')
    expect(await (await get('/chunks/mermaid-x.js')).text()).toBe('export const m = 1')
    expect((await get('/chunks/mermaid-x.js.map')).status).toBe(200)
  })

  it('白名单以外的扩展名 → 404', async () => {
    expect((await get('/index.html')).status).toBe(404)
    expect((await get('/LICENSE')).status).toBe(404)
    expect((await get('/')).status).toBe(404)
  })

  it('不离开产物目录：编码的 .. / 反斜杠 / 斜杠 → 404，读不到上级的文件', async () => {
    for (const p of [
      '/%2e%2e/secret.js',
      '/..%2fsecret.js',
      '/..%5csecret.js',
      '/chunks/../../secret.js'
    ]) {
      const res = await get(p)
      expect(res.status, p).toBe(404)
    }
  })

  it('其他主机名、不存在的文件 → 404；其他方法 → 405', async () => {
    expect((await handler(new Request('pch-asset://other/markdown.js'))).status).toBe(404)
    expect((await get('/missing.js')).status).toBe(404)
    expect((await get('/markdown.js', { method: 'POST', body: 'x' })).status).toBe(405)
  })
})

describe('createAssetProtocolHandler（开发：代理到 renderer dev server）', () => {
  it('路径与查询原样转发，响应追加跨源许可', async () => {
    const seen: string[] = []
    const h = createAssetProtocolHandler({
      kind: 'dev',
      origin: 'http://localhost:5173/',
      fetch: async (url) => {
        seen.push(url)
        return new Response('code', { status: 200, headers: { 'Content-Type': 'text/javascript' } })
      }
    })
    const res = await h(new Request('pch-asset://viewer/@fs/C:/x/main.ts?v=1'))
    expect(seen).toEqual(['http://localhost:5173/@fs/C:/x/main.ts?v=1'])
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/javascript')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await res.text()).toBe('code')
  })
})

describe('guardAssetInitiator', () => {
  const req = (url: string, initiatorOrigin?: string): Request =>
    Object.assign(new Request(url), initiatorOrigin === undefined ? {} : { initiatorOrigin })

  it('无发起方或来自 pch-web 页面 → 放行；其他 → 403，不调用处理器', async () => {
    let called = 0
    const g = guardAssetInitiator(async () => {
      called++
      return new Response('ok')
    })
    expect((await g(req('pch-asset://viewer/markdown.js'))).status).toBe(200)
    expect((await g(req('pch-asset://viewer/markdown.js', 'pch-web://sabc'))).status).toBe(200)
    expect(called).toBe(2)
    for (const origin of ['https://example.com', 'null', 'pch-asset://viewer', 'app://renderer']) {
      expect((await g(req('pch-asset://viewer/markdown.js', origin))).status, origin).toBe(403)
    }
    expect(called).toBe(2)
  })
})
