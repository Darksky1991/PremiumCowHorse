import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ScopeTable, fromWebUrl, scopeIdOf, toWebUrl } from './scope'

function table(root: string): { scopes: ScopeTable; id: string } {
  const scopes = new ScopeTable()
  return { scopes, id: scopes.register(root) }
}

describe('scopeIdOf', () => {
  it('is `s` + 16 hex chars and stable for the same input', () => {
    const a = scopeIdOf('file:///C:/案件%20A')
    expect(a).toMatch(/^s[0-9a-f]{16}$/)
    expect(scopeIdOf('file:///C:/案件%20A')).toBe(a)
    expect(scopeIdOf('file:///C:/案件%20B')).not.toBe(a)
  })

  it('always parses back as the same host name (never IPv4-like)', () => {
    for (let i = 0; i < 300; i++) {
      const id = scopeIdOf(`file:///C:/dir${i}`)
      expect(id).toHaveLength(17)
      expect(new URL(`pch-web://${id}/a.html`).hostname).toBe(id)
    }
  })
})

describe('toWebUrl / fromWebUrl', () => {
  it('round-trips a local file under a root with an escaped space', () => {
    const root = 'file:///C:/案件%20A'
    const uri = 'file:///C:/案件%20A/proto/index.html'
    const { scopes, id } = table(root)
    const web = toWebUrl(uri, root)
    expect(web).toBe(`pch-web://${id}/proto/index.html`)
    expect(fromWebUrl(web, scopes)).toEqual({ uri, scopeId: id })
  })

  it('round-trips a UNC root', () => {
    const root = 'file://nas/share/dir'
    const uri = 'file://nas/share/dir/a/b.css'
    const { scopes, id } = table(root)
    expect(fromWebUrl(toWebUrl(uri, root), scopes)).toEqual({ uri, scopeId: id })
  })

  it('maps the root itself and a drive root', () => {
    const { scopes, id } = table('file:///C:/')
    expect(toWebUrl('file:///C:/a.html', 'file:///C:/')).toBe(`pch-web://${id}/a.html`)
    expect(fromWebUrl(`pch-web://${id}/a.html`, scopes)?.uri).toBe('file:///C:/a.html')
    expect(fromWebUrl(`pch-web://${id}/`, scopes)?.uri).toBe('file:///C:/')
  })

  it.each(['a #1.html', 'q?x.html', '100%.html', 'with space.html', '設計書.html', 'a+b&c=d.html'])(
    'round-trips the file name %s',
    (name) => {
      const base = path.join(tmpdir(), 'proj')
      const root = pathToFileURL(base).href
      const uri = pathToFileURL(path.join(base, 'sub', name)).href
      const { scopes } = table(root)
      const web = toWebUrl(uri, root)
      expect(new URL(web).search).toBe('')
      expect(new URL(web).hash).toBe('')
      const back = fromWebUrl(web, scopes)
      expect(back).not.toBeNull()
      // 文件名相同（编码写法可以不同）
      expect(decodeURIComponent(back!.uri)).toBe(decodeURIComponent(uri))
      expect(back!.uri.startsWith(`${root}/sub/`)).toBe(true)
    }
  )

  it('throws when the uri is not under the root', () => {
    expect(() => toWebUrl('file:///C:/other/a.html', 'file:///C:/proj')).toThrow()
    expect(() => toWebUrl('file:///C:/proj2/a.html', 'file:///C:/proj')).toThrow()
  })

  it.each([
    ['..%2fsecret.txt'],
    ['a/..%2f..%2fsecret.txt'],
    ['%2e%2e%2fsecret.txt'],
    ['a%5csecret.txt'],
    ['%5c..%5csecret.txt'],
    ['a%2fb.txt'],
    ['a%00.txt'],
    ['a//b.txt']
  ])('rejects %s', (p) => {
    const { scopes, id } = table('file:///C:/proj')
    expect(fromWebUrl(`pch-web://${id}/${p}`, scopes)).toBeNull()
  })

  it('never resolves dot segments to a uri outside the root', () => {
    const { scopes, id } = table('file:///C:/proj')
    for (const p of [
      '%2e%2e/secret.txt',
      '../../secret.txt',
      'a/%2e%2e/%2e%2e/secret.txt',
      '%2E%2E/x'
    ]) {
      const r = fromWebUrl(`pch-web://${id}/${p}`, scopes)
      if (r) expect(r.uri.startsWith('file:///C:/proj/')).toBe(true)
    }
  })

  it('rejects an unregistered scope id, other schemes and unparsable urls', () => {
    const { scopes } = table('file:///C:/proj')
    expect(fromWebUrl('pch-web://0123456789abcdef/a.html', scopes)).toBeNull()
    expect(fromWebUrl('https://example.com/a.html', scopes)).toBeNull()
    expect(fromWebUrl('not a url', scopes)).toBeNull()
  })

  it('ignores query and hash', () => {
    const { scopes, id } = table('file:///C:/proj')
    expect(fromWebUrl(`pch-web://${id}/a.html?x=1#y`, scopes)?.uri).toBe('file:///C:/proj/a.html')
  })
})

describe('ScopeTable', () => {
  it('registers idempotently and looks up the root', () => {
    const scopes = new ScopeTable()
    const id = scopes.register('file:///C:/proj')
    expect(scopes.register('file:///C:/proj')).toBe(id)
    expect(scopes.rootOf(id)).toBe('file:///C:/proj')
    expect(scopes.rootOf('ffffffffffffffff')).toBeUndefined()
  })
})
