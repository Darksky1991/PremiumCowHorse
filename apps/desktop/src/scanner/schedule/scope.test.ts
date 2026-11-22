import { describe, expect, it } from 'vitest'
import type { CacheStrategy, RootConfig } from '@pch/shared'
import { computeScope, parentUri, TIER_LIMIT } from './scope'
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
    tabs: [],
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

  it('directories shown in tabs are focus: fully read, without their surroundings', () => {
    const r = computeScope(
      input('default', { focus: null, tabs: [u('a/b2'), u('a/b/c')], visible: [u('a/b2')] })
    )
    expect(tiers(r)).toEqual({ [u('a/b2')]: 'focus', [u('a/b/c')]: 'focus', [R]: 'far' })
    for (const i of r.periodic) expect(i.full).toBe(i.tier === 'focus')
  })

  it('tabs are focus under a passive root too, but not outside every root', () => {
    const r = computeScope(
      input('passive', { focus: u('a'), tabs: [u('a/b'), u('a'), 'file:///D:/x'] })
    )
    expect(r.periodic).toEqual([
      { uri: u('a'), tier: 'focus', full: true },
      { uri: u('a/b'), tier: 'focus', full: true }
    ])
  })

  it('a tab that is also near the selected focus becomes focus', () => {
    const r = computeScope(input('default', { tabs: [u('a')] }))
    expect(tiers(r)[u('a')]).toBe('focus')
    expect(tiers(r)[u('a/b')]).toBe('focus')
    // 关注点的周边只按选中的关注点计算（标签不扩展近 / 远层）
    expect(tiers(r)[u('z')]).toBe('far')
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

describe('computeScope: tier limits', () => {
  const P = u('p')
  const F = u('p/f')
  const pad = (i: number): string => String(i).padStart(3, '0')
  /** p 下有 300 个兄弟目录与关注点 f；f 下 50 个子目录；r 下有 300 个叔伯目录 */
  const big: Record<string, string[]> = {
    [R]: [P, ...Array.from({ length: 300 }, (_, i) => u(`q${pad(i)}`))],
    [P]: [F, ...Array.from({ length: 300 }, (_, i) => u(`p/s${pad(i)}`))],
    [F]: Array.from({ length: 50 }, (_, i) => u(`p/f/c${pad(i)}`))
  }
  const bigChildren = (uri: string): string[] => big[uri] ?? []
  const byTier = (r: Result, tier: Tier): string[] =>
    r.periodic.filter((i) => i.tier === tier).map((i) => i.uri)

  it('near keeps visible directories first, then the nearest, hot first at equal distance', () => {
    const visible = [u('z/v1'), u('z/v2')]
    const hot = [u('p/s299'), u('p/s250')]
    const r = computeScope(input('default', { focus: F, visible, hot, children: bigChildren }))
    const near = byTier(r, 'near')
    expect(near).toHaveLength(TIER_LIMIT)
    // 可见的已展开目录、父目录与 50 个子目录（距离 1）都保留
    for (const v of visible) expect(near).toContain(v)
    expect(near).toContain(P)
    for (const c of bigChildren(F)) expect(near).toContain(c)
    // 剩下的名额给兄弟目录（距离 2）：热点优先，再按 URI
    const siblings = near.filter((x) => x.startsWith(`${u('p/s')}`))
    expect(siblings).toHaveLength(TIER_LIMIT - visible.length - 1 - 50)
    expect(siblings.slice(0, 2).sort()).toEqual([...hot].sort())
    expect(siblings.slice(2)).toEqual(
      Array.from({ length: siblings.length - 2 }, (_, i) => u(`p/s${pad(i)}`))
    )
    expect(byTier(r, 'focus')).toEqual([F])
  })

  it('far keeps the nearest, hot first at equal distance, then by URI', () => {
    const offscreen = [u('p/f/c000/a/b/c')]
    const r = computeScope(
      input('default', { focus: F, offscreen, hot: [u('q200')], children: bigChildren })
    )
    const far = byTier(r, 'far')
    expect(far).toHaveLength(TIER_LIMIT)
    // 祖父（根，距离 2）最先；叔伯（距离 3）中热点优先，再按 URI；更远的滚出视口目录（距离 4）不保留
    expect(far[0]).toBe(R)
    expect(far[1]).toBe(u('q200'))
    expect(far.slice(2)).toEqual(Array.from({ length: TIER_LIMIT - 2 }, (_, i) => u(`q${pad(i)}`)))
    expect(far).not.toContain(offscreen[0])
  })

  it('without a focus the tiers are limited by hot directories, then by URI', () => {
    const visible = Array.from({ length: 150 }, (_, i) => u(`v${pad(i)}`))
    const r = computeScope(input('default', { focus: null, visible, hot: [u('v149')] }))
    const near = byTier(r, 'near')
    expect(near).toEqual([u('v149'), ...visible.slice(0, TIER_LIMIT - 1)])
  })
})

describe('parentUri: sftp', () => {
  it('uses sftp parent semantics', () => {
    expect(parentUri('sftp://ID/a/b')).toBe('sftp://ID/a')
    expect(parentUri('sftp://ID')).toBeNull()
  })
})
