import { describe, expect, it } from 'vitest'
import type { CacheStrategy, RootConfig } from '@pch/shared'
import { computeScope } from './scope'
import type { ScopeInput, Tier } from './scope'

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

const root = (strategy: CacheStrategy, uri = R): RootConfig => ({
  entryId: `e-${uri}`,
  workspaceId: 'w',
  uri,
  strategy,
  location: 'local'
})

function input(strategy: CacheStrategy, over: Partial<ScopeInput> = {}): ScopeInput {
  return {
    roots: [root(strategy)],
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

type Result = ReturnType<typeof computeScope>

/** 定期确认对象：uri → 层 */
const tiers = (r: Result): Record<string, Tier> =>
  Object.fromEntries(r.periodic.map((i) => [i.uri, i.tier]))

describe('computeScope', () => {
  it('passive only checks the focus, fully', () => {
    const r = computeScope(input('passive', { visible: [u('z')], offscreen: [u('a')] }))
    expect(r.periodic).toEqual([{ uri: u('a/b'), tier: 'focus', full: true }])
    expect(r.background).toEqual({ indexTargets: [], hot: [], ranges: [] })
  })

  it('default splits the surroundings into near and far tiers', () => {
    const r = computeScope(input('default'))
    expect(tiers(r)).toEqual({
      [u('a/b')]: 'focus',
      // 父、子、兄弟
      [u('a')]: 'near',
      [u('a/b/c')]: 'near',
      [u('a/b2')]: 'near',
      [u('a/a2')]: 'near',
      // 祖父（同时是根）、叔伯
      [R]: 'far',
      [u('z')]: 'far'
    })
    // 只有关注点每次完整读取，其余比较修改时间
    for (const i of r.periodic) expect(i.full).toBe(i.tier === 'focus')
    expect(r.background.ranges).toEqual([])
  })

  it('ancestors above the parent and uncles are far', () => {
    const r = computeScope(input('default', { focus: u('a/b/c') }))
    expect(tiers(r)).toEqual({
      [u('a/b/c')]: 'focus',
      [u('a/b')]: 'near',
      [u('a/b/c/d')]: 'near',
      [u('a')]: 'far',
      [R]: 'far',
      [u('a/b2')]: 'far',
      [u('a/a2')]: 'far'
    })
  })

  it('visible directories are near, offscreen ones far, and a uri keeps its nearest tier', () => {
    const r = computeScope(
      input('default', {
        focus: null,
        visible: [u('z'), u('a/b2/x')],
        offscreen: [u('z'), u('a/b/c/d'), R]
      })
    )
    expect(tiers(r)).toEqual({
      [R]: 'far',
      [u('z')]: 'near',
      [u('a/b2/x')]: 'near',
      [u('a/b/c/d')]: 'far'
    })
    expect(r.periodic.filter((i) => i.uri === u('z'))).toHaveLength(1)
  })

  it('every root of the workspace is far unless its strategy is passive', () => {
    const other = 'file:///C:/other'
    const quiet = 'file:///C:/quiet'
    const r = computeScope(
      input('default', {
        roots: [root('default'), root('all', other), root('passive', quiet)],
        focus: null
      })
    )
    expect(tiers(r)).toEqual({ [R]: 'far', [other]: 'far' })
  })

  it('directories under a passive root are not checked unless they are the focus', () => {
    const r = computeScope(
      input('passive', { focus: null, visible: [u('a')], offscreen: [u('z')] })
    )
    expect(r.periodic).toEqual([])
  })

  it('active adds the range N levels above and below the focus (N=1)', () => {
    const r = computeScope(input('active', { activeDepth: 1 }))
    // focus a/b 深度 2；上 1 层的祖先 a；a 之下深度 ≤ 1+1
    expect(r.background.ranges).toEqual([{ uri: u('a'), maxDepth: 2 }])
    expect(tiers(r)[u('a/b')]).toBe('focus')
  })

  it('active stops at the root when going up (N=3)', () => {
    const r = computeScope(input('active', { activeDepth: 3 }))
    // 向上最多到根（只有 2 层）：根之下相对深度 2 + 3
    expect(r.background.ranges).toEqual([{ uri: R, maxDepth: 5 }])
  })

  it('active with the focus at the root covers N levels below it', () => {
    const r = computeScope(input('active', { focus: R, activeDepth: 2 }))
    expect(r.background.ranges).toEqual([{ uri: R, maxDepth: 2 }])
    expect(tiers(r)).toEqual({ [R]: 'focus', [u('a')]: 'near', [u('z')]: 'near' })
  })

  it('an all root is a whole range, with or without a focus in it', () => {
    expect(computeScope(input('all')).background.ranges).toEqual([{ uri: R, maxDepth: null }])
    const other = 'file:///C:/other'
    const r = computeScope(
      input('passive', { roots: [root('all'), root('passive', other)], focus: `${other}/q` })
    )
    expect(r.background.ranges).toEqual([{ uri: R, maxDepth: null }])
  })

  it('overlapping roots use the highest strategy and the innermost root for the ancestors', () => {
    const inner = u('a')
    const r = computeScope(input('passive', { roots: [root('passive'), root('all', inner)] }))
    expect(r.background.ranges).toEqual([{ uri: inner, maxDepth: null }])
    // 祖先链止于最内层的根 a：不含 r；r 是消极的根，不进入远层
    expect(tiers(r)).toEqual({
      [u('a/b')]: 'focus',
      [inner]: 'near',
      [u('a/b/c')]: 'near',
      [u('a/b2')]: 'near',
      [u('a/a2')]: 'near'
    })
  })

  it('hot directories join the background only under a default or higher root', () => {
    const quiet = 'file:///C:/quiet'
    const r = computeScope(
      input('default', {
        roots: [root('default'), root('passive', quiet)],
        focus: null,
        hot: [u('a'), `${quiet}/x`, 'file:///D:/outside']
      })
    )
    expect(r.background.hot).toEqual([u('a')])
  })

  it('index targets join the background even under a passive root', () => {
    const r = computeScope(input('passive', { indexTargets: [u('a')] }))
    expect(r.background.indexTargets).toEqual([{ uri: u('a'), maxDepth: null }])
  })

  it('a focus outside every root yields no focus tier', () => {
    const r = computeScope(input('all', { focus: 'file:///D:/x' }))
    expect(tiers(r)).toEqual({ [R]: 'far' })
    expect(r.background.ranges).toEqual([{ uri: R, maxDepth: null }])
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
    expect(tiers(r)).toEqual({
      'file:///C:/x/y': 'focus',
      'file:///C:/x': 'near',
      [drive]: 'far'
    })
  })

  it('ancestors never cross a UNC share root', () => {
    const share = 'file://server/share'
    const r = computeScope(
      input('default', {
        roots: [{ ...root('default', share), location: 'network' }],
        focus: 'file://server/share/x/y',
        children: () => []
      })
    )
    expect(tiers(r)).toEqual({
      'file://server/share/x/y': 'focus',
      'file://server/share/x': 'near',
      [share]: 'far'
    })
  })
})
