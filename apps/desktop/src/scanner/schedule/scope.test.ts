import { describe, expect, it } from 'vitest'
import type { CacheStrategy, RootConfig } from '@pch/shared'
import { computeScope } from './scope'
import type { ScopeInput } from './scope'

const R = 'file:///C:/r'
const u = (p: string): string => `${R}/${p}`

/** 目录树：r 下 a{b{c{d}}, b2{x}, a2}, z */
const tree: Record<string, string[]> = {
  [R]: [u('a'), u('z')],
  [u('a')]: [u('a/b'), u('a/b2'), u('a/a2')],
  [u('a/b')]: [u('a/b/c')],
  [u('a/b/c')]: [u('a/b/c/d')],
  [u('a/b2')]: [u('a/b2/x')]
}
const children = (uri: string): string[] => tree[uri] ?? []

const root = (level: CacheStrategy, uri = R): RootConfig => ({
  entryId: `e-${uri}`,
  workspaceId: 'w',
  uri,
  strategy: level,
  location: 'local'
})

function input(level: CacheStrategy, over: Partial<ScopeInput> = {}): ScopeInput {
  return {
    roots: [root(level)],
    focus: u('a/b'),
    visible: [],
    offscreen: [],
    hot: [],
    indexTargets: [],
    activeDepth: 3,
    children,
    ...over
  }
}

const uris = (r: ReturnType<typeof computeScope>): string[] => r.items.map((i) => i.uri).sort()

describe('computeScope', () => {
  it('passive includes only the focus', () => {
    const r = computeScope(input('passive', { roots: [root('passive')] }))
    expect(r.items.filter((i) => i.uri === u('a/b'))).toEqual([
      { uri: u('a/b'), tier: 'P1', full: true }
    ])
    expect(uris(r)).toEqual([R, u('a/b')].sort())
    expect(r.frontier).toEqual([])
  })

  it('default adds ancestors children and siblings', () => {
    const r = computeScope(input('default'))
    expect(uris(r)).toEqual([R, u('a'), u('a/b'), u('a/b/c'), u('a/b2'), u('a/a2')].sort())
    const by = Object.fromEntries(r.items.map((i) => [i.uri, i]))
    expect(by[u('a/b')]).toEqual({ uri: u('a/b'), tier: 'P1', full: true })
    expect(by[u('a')]).toEqual({ uri: u('a'), tier: 'P1', full: false })
    expect(by[u('a/b2')]?.full).toBe(false)
    expect(r.frontier).toEqual([])
  })

  it('active reaches uncles and nephews within N levels (N=1)', () => {
    const r = computeScope(input('active', { activeDepth: 1 }))
    // focus a/b 深度 2；上 1 级祖先 A=a；a 之下深度 ≤ 1+1
    expect(r.frontier).toEqual([{ uri: u('a'), maxDepth: 2 }])
    expect(uris(r)).toEqual([R, u('a'), u('a/b'), u('a/b/c'), u('a/b2'), u('a/a2')].sort())
  })

  it('active reaches uncles and nephews within N levels (N=3)', () => {
    const r = computeScope(input('active', { activeDepth: 3 }))
    // 向上最多到根（只有 2 级）：A=根，相对深度 2，上限 2+3
    expect(r.frontier).toEqual([{ uri: R, maxDepth: 5 }])
  })

  it('active with focus at the root expands N levels below it', () => {
    const r = computeScope(input('active', { focus: R, activeDepth: 2 }))
    expect(r.frontier).toEqual([{ uri: R, maxDepth: 2 }])
    expect(uris(r)).toEqual([R, u('a'), u('z')].sort())
  })

  it('all puts the root on the frontier', () => {
    const r = computeScope(input('all'))
    expect(r.frontier).toEqual([{ uri: R, maxDepth: null }])
    expect(uris(r)).toContain(u('a/b2'))
  })

  it('overlapping roots use the higher level', () => {
    const inner = u('a')
    const r = computeScope(
      input('passive', { roots: [root('passive'), root('all', inner)], focus: u('a/b') })
    )
    expect(r.frontier).toEqual(expect.arrayContaining([{ uri: inner, maxDepth: null }]))
    // 范围按 URI 最长的根（a）计算：祖先链止于 a，不含 r 的其他部分
    expect(uris(r)).toContain(u('a/b2'))
  })

  it('visible beats offscreen and duplicates keep the strongest tier', () => {
    const r = computeScope(
      input('default', {
        visible: [u('z')],
        offscreen: [u('z'), u('a/b2'), u('a/b/c')],
        hot: [u('z')]
      })
    )
    const by = Object.fromEntries(r.items.map((i) => [i.uri, i]))
    expect(by[u('z')]).toEqual({ uri: u('z'), tier: 'P1', full: true })
    expect(by[u('a/b2')]).toEqual({ uri: u('a/b2'), tier: 'P1', full: false })
    expect(r.items.filter((i) => i.uri === u('z'))).toHaveLength(1)
  })

  it('hot directories bring their children but only inside a root', () => {
    const r = computeScope(input('passive', { hot: [u('a'), 'file:///D:/outside'], focus: null }))
    expect(uris(r)).toEqual([R, u('a'), u('a/b'), u('a/b2'), u('a/a2')].sort())
  })

  it('index targets go to the frontier', () => {
    const r = computeScope(input('passive', { indexTargets: [u('a')] }))
    expect(r.frontier).toEqual([{ uri: u('a'), maxDepth: null }])
  })

  it('merges duplicate frontier uris keeping the larger limit', () => {
    const r = computeScope(input('active', { activeDepth: 1, indexTargets: [u('a')] }))
    expect(r.frontier).toEqual([{ uri: u('a'), maxDepth: null }])
  })

  it('focus outside every root yields no focus items', () => {
    const r = computeScope(input('all', { focus: 'file:///D:/x', visible: [] }))
    expect(uris(r)).toEqual([R])
    expect(r.frontier).toEqual([{ uri: R, maxDepth: null }])
  })

  it('an all root is on the frontier even when the focus is in another root', () => {
    const other = 'file:///C:/other'
    const r = computeScope(
      input('passive', { roots: [root('all'), root('passive', other)], focus: `${other}/q` })
    )
    expect(r.frontier).toEqual([{ uri: R, maxDepth: null }])
  })

  it('nested roots: an outer all root stays on the frontier', () => {
    const r = computeScope(
      input('passive', { roots: [root('all'), root('passive', u('a'))], focus: u('a/b') })
    )
    expect(r.frontier).toEqual([{ uri: R, maxDepth: null }])
  })

  it('ancestors never cross a drive root', () => {
    const drive = 'file:///C:/'
    const r = computeScope(
      input('default', {
        roots: [root('default', drive)],
        focus: 'file:///C:/x/y',
        children: () => []
      })
    )
    expect(uris(r)).toEqual([drive, 'file:///C:/x', 'file:///C:/x/y'].sort())
  })

  it('ancestors never cross a UNC share root', () => {
    const share = 'file://server/share'
    const r = computeScope(
      input('default', {
        roots: [root('default', share)],
        focus: 'file://server/share/x/y',
        children: () => []
      })
    )
    expect(uris(r)).toEqual([share, 'file://server/share/x', 'file://server/share/x/y'].sort())
  })

  it('without a focus only roots visible hot and index remain', () => {
    const r = computeScope(input('all', { focus: null, visible: [u('a')], indexTargets: [u('z')] }))
    expect(uris(r)).toEqual([R, u('a')].sort())
    expect(r.frontier).toEqual(
      expect.arrayContaining([
        { uri: R, maxDepth: null },
        { uri: u('z'), maxDepth: null }
      ])
    )
  })
})
