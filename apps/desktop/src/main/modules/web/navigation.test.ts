import { describe, expect, it } from 'vitest'
import { decideNavigation } from './navigation'
import { ScopeTable, toWebUrl } from './scope'

const ROOT = 'file:///C:/work/%E6%A1%88%E4%BB%B6A'
const OTHER = 'file:///C:/work/other'
const UNC_ROOT = 'file://nas/share/proto'

describe('decideNavigation', () => {
  const scopes = new ScopeTable()
  const scopeId = scopes.register(ROOT)
  const otherId = scopes.register(OTHER)
  const uncId = scopes.register(UNC_ROOT)
  const ctx = { scopeId, scopes, newTab: false }

  it('同范围的 pch-web 文件与目录 → app（uri 为工作区 URI）', () => {
    const uri = `${ROOT}/proto/second%20page.html`
    expect(decideNavigation(toWebUrl(uri, ROOT), ctx)).toEqual({
      kind: 'app',
      uri,
      newTab: false,
      fragment: ''
    })
    expect(decideNavigation(`pch-web://${scopeId}/proto/`, ctx)).toEqual({
      kind: 'app',
      uri: `${ROOT}/proto`,
      newTab: false,
      fragment: ''
    })
    expect(decideNavigation(`pch-web://${scopeId}/`, ctx)).toEqual({
      kind: 'app',
      uri: ROOT,
      newTab: false,
      fragment: ''
    })
  })

  it('查询与片段不影响判定（资源 URI 不含它们），原样放在 fragment 中（pch-web 与 file:）', () => {
    expect(decideNavigation(`pch-web://${scopeId}/a.html?x=1#sec`, ctx)).toEqual({
      kind: 'app',
      uri: `${ROOT}/a.html`,
      newTab: false,
      fragment: '?x=1#sec'
    })
    expect(decideNavigation(`pch-web://${scopeId}/a.html#sec`, ctx)).toMatchObject({
      fragment: '#sec'
    })
    expect(decideNavigation('file:///C:/work/案件A/a.html?q#top', ctx)).toEqual({
      kind: 'app',
      uri: `${ROOT}/a.html`,
      newTab: false,
      fragment: '?q#top'
    })
  })

  it('newTab 原样透传', () => {
    const url = `pch-web://${scopeId}/b.html`
    expect(decideNavigation(url, { ...ctx, newTab: true })).toEqual({
      kind: 'app',
      uri: `${ROOT}/b.html`,
      newTab: true,
      fragment: ''
    })
    expect(decideNavigation(`${ROOT}/b.html`, { ...ctx, newTab: true })).toEqual({
      kind: 'app',
      uri: `${ROOT}/b.html`,
      newTab: true,
      fragment: ''
    })
  })

  it('其他范围 / 未登记范围的 pch-web → blocked outOfScope', () => {
    expect(decideNavigation(`pch-web://${otherId}/a.html`, ctx)).toEqual({
      kind: 'blocked',
      notice: 'outOfScope'
    })
    expect(decideNavigation('pch-web://s0000000000000000/a.html', ctx)).toEqual({
      kind: 'blocked',
      notice: 'outOfScope'
    })
  })

  it('pch-web 的非法路径（反斜杠段）→ blocked outOfScope', () => {
    expect(decideNavigation(`pch-web://${scopeId}/a%5c..%5c..%5cx.html`, ctx)).toEqual({
      kind: 'blocked',
      notice: 'outOfScope'
    })
  })

  it('范围内的 file: 绝对地址 → app（换算为工作区 URI 的写法）', () => {
    expect(decideNavigation('file:///C:/work/案件A/doc/a b.html', ctx)).toEqual({
      kind: 'app',
      uri: `${ROOT}/doc/a%20b.html`,
      newTab: false,
      fragment: ''
    })
  })

  it('范围外的 file:（含 file:///C:/Windows/win.ini、.. 越出根）→ blocked outOfScope', () => {
    for (const url of [
      'file:///C:/Windows/win.ini',
      'file:///C:/work/other/a.html',
      'file:///C:/work/%E6%A1%88%E4%BB%B6A/../other/a.html',
      'file:///C:/work/%E6%A1%88%E4%BB%B6AB/a.html'
    ]) {
      expect(decideNavigation(url, ctx), url).toEqual({ kind: 'blocked', notice: 'outOfScope' })
    }
  })

  it('UNC：范围内 → app，根之上 → outOfScope', () => {
    const unc = { scopeId: uncId, scopes, newTab: false }
    expect(decideNavigation('file://nas/share/proto/sub/x.html', unc)).toEqual({
      kind: 'app',
      uri: 'file://nas/share/proto/sub/x.html',
      newTab: false,
      fragment: ''
    })
    expect(decideNavigation(toWebUrl(`${UNC_ROOT}/i.html`, UNC_ROOT), unc)).toEqual({
      kind: 'app',
      uri: `${UNC_ROOT}/i.html`,
      newTab: false,
      fragment: ''
    })
    expect(decideNavigation('file://nas/share/secret.txt', unc)).toEqual({
      kind: 'blocked',
      notice: 'outOfScope'
    })
  })

  it('http / https / mailto → external（原样）', () => {
    for (const url of [
      'http://intranet.local/x?a=1',
      'https://example.com/',
      'mailto:someone@example.com'
    ]) {
      expect(decideNavigation(url, ctx)).toEqual({ kind: 'external', url })
    }
  })

  it('其他协议（javascript: / data: / about: / 自定义）与无法解析的地址 → blocked unsupported', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<p>x</p>',
      'about:blank',
      'ms-settings:display',
      'pch-asset://viewer/markdown.js',
      'not a url'
    ]) {
      expect(decideNavigation(url, ctx), url).toEqual({ kind: 'blocked', notice: 'unsupported' })
    }
  })
})
