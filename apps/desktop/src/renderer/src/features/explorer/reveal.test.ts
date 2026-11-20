import { describe, expect, it, vi } from 'vitest'
import type { FileEntry, WorkspaceEntry } from '@pch/shared'
import type { DirectoryState } from '@renderer/data/vfs'
import {
  revealNodeIds,
  revealPath,
  revealProgress,
  revealRecheckUri,
  settleReveal,
  settleRevealTimeout
} from './reveal'
import { buildVisibleNodes, type TreeNode } from './tree-model'

const ROOT = 'file:///C:/work'

function entry(
  id: string,
  kind: WorkspaceEntry['kind'],
  opts: { parentId?: string | null; uri?: string | null } = {}
): WorkspaceEntry {
  return {
    id,
    workspaceId: 'ws',
    parentId: opts.parentId ?? null,
    kind,
    label: id,
    uri: opts.uri === undefined ? (kind === 'group' ? null : `${ROOT}/${id}`) : opts.uri,
    sortOrder: 0,
    meta: null,
    cacheStrategy: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function dir(parentUri: string, name: string, kind: FileEntry['kind'] = 'directory'): FileEntry {
  return {
    uri: `${parentUri}/${encodeURIComponent(name)}`,
    name,
    kind,
    size: 0,
    mtime: 0,
    hidden: false
  }
}

const ready = (items: FileEntry[]): DirectoryState => ({
  status: 'ready',
  items,
  state: 'fresh',
  checkedAt: null
})

describe('revealPath', () => {
  const entries = [
    entry('g', 'group'),
    entry('proj', 'folder', { parentId: 'g' }),
    entry('sub', 'folder', { uri: `${ROOT}/proj/a%20b` }),
    entry('pinned', 'file', { uri: `${ROOT}/proj/x.txt` })
  ]

  it('取 URI 前缀最长的 folder 条目，相对路径按段解码', () => {
    expect(revealPath(entries, `${ROOT}/proj/docs/%E4%BB%95%E6%A7%98.xlsx`)).toEqual({
      entryId: 'proj',
      segments: ['docs', '仕様.xlsx']
    })
    expect(revealPath(entries, `${ROOT}/proj/a%20b/c%25d`)).toEqual({
      entryId: 'sub',
      segments: ['c%d']
    })
  })

  it('URI 等于条目本身时没有相对路径段', () => {
    expect(revealPath(entries, `${ROOT}/proj`)).toEqual({ entryId: 'proj', segments: [] })
  })

  it('固定的单个文件条目直接对应该条目', () => {
    expect(revealPath(entries, `${ROOT}/proj/x.txt`)).toEqual({
      entryId: 'pinned',
      segments: []
    })
  })

  it('不在任何条目之下时为 null（前缀必须在路径段边界上）', () => {
    expect(revealPath(entries, 'file:///C:/other/a.txt')).toBeNull()
    expect(revealPath(entries, `${ROOT}/project/a.txt`)).toBeNull()
  })

  it('驱动器根条目（以 / 结尾）', () => {
    const drive = [entry('c', 'folder', { uri: 'file:///C:/' })]
    expect(revealPath(drive, 'file:///C:/work/a.txt')).toEqual({
      entryId: 'c',
      segments: ['work', 'a.txt']
    })
  })
})

describe('revealNodeIds', () => {
  const entries = [
    entry('g1', 'group'),
    entry('g2', 'group', { parentId: 'g1' }),
    entry('proj', 'folder', { parentId: 'g2' })
  ]

  it('依次为祖先分组、条目、中间目录；目标为最后一段', () => {
    expect(revealNodeIds(entries, { entryId: 'proj', segments: ['a', 'b', 'c.txt'] })).toEqual({
      chain: ['entry:g1', 'entry:g2', 'entry:proj', 'fs:proj:a', 'fs:proj:a/b'],
      target: 'fs:proj:a/b/c.txt'
    })
  })

  it('没有相对路径段时目标就是条目节点', () => {
    expect(revealNodeIds(entries, { entryId: 'proj', segments: [] })).toEqual({
      chain: ['entry:g1', 'entry:g2'],
      target: 'entry:proj'
    })
  })
})

describe('revealProgress', () => {
  const proj = entry('proj', 'folder')
  const projUri = `${ROOT}/proj`
  const aUri = `${projUri}/a`
  const path = revealNodeIds([proj], { entryId: 'proj', segments: ['a', 'b.txt'] })
  const nodesWith = (directories: Map<string, DirectoryState>, expanded: string[]): TreeNode[] =>
    buildVisibleNodes({
      entries: [proj],
      expanded: new Set(expanded),
      directories,
      showHidden: false
    })

  it('目标节点出现时为 done，并给出其序号', () => {
    const nodes = nodesWith(
      new Map([
        [projUri, ready([dir(projUri, 'a')])],
        [aUri, ready([dir(aUri, 'b.txt', 'file')])]
      ]),
      path.chain
    )
    const p = revealProgress(nodes, path.chain, path.target)
    expect(p).toEqual({
      state: 'done',
      index: nodes.findIndex((n) => n.id === path.target),
      depth: path.chain.length
    })
  })

  it('最深的已出现祖先仍在加载时为 waiting，序号指向该祖先', () => {
    const nodes = nodesWith(new Map([[projUri, ready([dir(projUri, 'a')])]]), path.chain)
    expect(revealProgress(nodes, path.chain, path.target)).toEqual({
      state: 'waiting',
      index: nodes.findIndex((n) => n.id === 'fs:proj:a'),
      depth: 1
    })
  })

  it('列表已就绪但没有下一段（缓存过期）、或该层出错时为 failed', () => {
    const missing = nodesWith(new Map([[projUri, ready([dir(projUri, 'other')])]]), path.chain)
    expect(revealProgress(missing, path.chain, path.target)).toEqual({
      state: 'failed',
      index: 0,
      depth: 0
    })
    const error = nodesWith(
      new Map<string, DirectoryState>([
        [projUri, ready([dir(projUri, 'a')])],
        [aUri, { status: 'error', code: 'FS_NOT_FOUND' }]
      ]),
      path.chain
    )
    expect(revealProgress(error, path.chain, path.target)).toMatchObject({
      state: 'failed',
      depth: 1
    })
  })

  it('中间段不是可展开的目录时为 failed', () => {
    const nodes = nodesWith(new Map([[projUri, ready([dir(projUri, 'a', 'file')])]]), path.chain)
    expect(revealProgress(nodes, path.chain, path.target)).toMatchObject({
      state: 'failed',
      depth: 1
    })
  })

  it('祖先尚未展开（store 更新还没反映到节点）时为 waiting', () => {
    const nodes = nodesWith(new Map(), [])
    expect(revealProgress(nodes, path.chain, path.target)).toEqual({
      state: 'waiting',
      index: 0,
      depth: 0
    })
  })

  it('连条目节点都不在树中时为 failed（序号 -1）', () => {
    expect(revealProgress([], path.chain, path.target)).toEqual({
      state: 'failed',
      index: -1,
      depth: -1
    })
  })
})

describe('revealRecheckUri', () => {
  const group = entry('g', 'group')
  const proj = entry('proj', 'folder', { parentId: 'g' })
  const projUri = `${ROOT}/proj`
  const aUri = `${projUri}/a`
  const path = revealNodeIds([group, proj], { entryId: 'proj', segments: ['a', 'b.txt'] })
  const nodesWith = (directories: Map<string, DirectoryState>): TreeNode[] =>
    buildVisibleNodes({
      entries: [group, proj],
      expanded: new Set(path.chain),
      directories,
      showHidden: false
    })
  const recheck = (nodes: TreeNode[]): string | null =>
    revealRecheckUri(nodes, revealProgress(nodes, path.chain, path.target).index)

  it('列表已就绪但没有下一段：确认该层目录', () => {
    const nodes = nodesWith(
      new Map([
        [projUri, ready([dir(projUri, 'a')])],
        [aUri, ready([dir(aUri, 'other.txt', 'file')])]
      ])
    )
    expect(recheck(nodes)).toBe(aUri)
  })

  it('该层出错（目录已不在等）：确认该层目录', () => {
    const nodes = nodesWith(
      new Map<string, DirectoryState>([
        [projUri, ready([dir(projUri, 'a')])],
        [aUri, { status: 'error', code: 'FS_NOT_FOUND' }]
      ])
    )
    expect(recheck(nodes)).toBe(aUri)
  })

  it('中间段已变成文件：确认它所在的目录', () => {
    const nodes = nodesWith(new Map([[projUri, ready([dir(projUri, 'a', 'file')])]]))
    expect(recheck(nodes)).toBe(projUri)
  })

  it('分组节点或没有节点时不确认', () => {
    const nodes = nodesWith(new Map())
    expect(
      revealRecheckUri(
        nodes,
        nodes.findIndex((n) => n.id === 'entry:g')
      )
    ).toBeNull()
    expect(revealRecheckUri(nodes, -1)).toBeNull()
  })
})

describe('settleReveal', () => {
  const proj = entry('proj', 'folder')
  const projUri = `${ROOT}/proj`
  const aUri = `${projUri}/a`
  const path = revealNodeIds([proj], { entryId: 'proj', segments: ['a', 'b.txt'] })
  const nodesWith = (directories: Map<string, DirectoryState>): TreeNode[] =>
    buildVisibleNodes({
      entries: [proj],
      expanded: new Set(path.chain),
      directories,
      showHidden: false
    })
  type Spy = ReturnType<typeof vi.fn>
  const settle = (
    nodes: TreeNode[],
    mode: 'locate' | 'sync' = 'locate'
  ): { settled: boolean; select: Spy; confirm: Spy; warn: Spy } => {
    const effects = { select: vi.fn(), confirm: vi.fn(), warn: vi.fn() }
    const progress = revealProgress(nodes, path.chain, path.target)
    const settled = settleReveal(nodes, progress, effects, mode)
    return { settled, ...effects }
  }

  it('定位失败：选中最深的一层、确认出错的那一层目录一次、提示', () => {
    const nodes = nodesWith(
      new Map([
        [projUri, ready([dir(projUri, 'a')])],
        [aUri, ready([dir(aUri, 'other.txt', 'file')])]
      ])
    )
    const r = settle(nodes)
    expect(r.settled).toBe(true)
    expect(r.select).toHaveBeenCalledWith(nodes.findIndex((n) => n.id === 'fs:proj:a'))
    expect(r.confirm).toHaveBeenCalledTimes(1)
    expect(r.confirm).toHaveBeenCalledWith(aUri)
    expect(r.warn).toHaveBeenCalledTimes(1)
  })

  it('定位成功：选中目标，不确认、不提示', () => {
    const nodes = nodesWith(
      new Map([
        [projUri, ready([dir(projUri, 'a')])],
        [aUri, ready([dir(aUri, 'b.txt', 'file')])]
      ])
    )
    const r = settle(nodes)
    expect(r.settled).toBe(true)
    expect(r.select).toHaveBeenCalledWith(nodes.findIndex((n) => n.id === path.target))
    expect(r.confirm).not.toHaveBeenCalled()
    expect(r.warn).not.toHaveBeenCalled()
  })

  it('仍在等待：什么都不做', () => {
    const r = settle(nodesWith(new Map([[projUri, ready([dir(projUri, 'a')])]])))
    expect(r.settled).toBe(false)
    expect(r.select).not.toHaveBeenCalled()
    expect(r.confirm).not.toHaveBeenCalled()
    expect(r.warn).not.toHaveBeenCalled()
  })

  it('同步（sync）找不到目标：什么都不做——树保持原选中（设计 2.4），不确认、不提示', () => {
    const nodes = nodesWith(
      new Map([
        [projUri, ready([dir(projUri, 'a')])],
        [aUri, ready([dir(aUri, 'other.txt', 'file')])]
      ])
    )
    const r = settle(nodes, 'sync')
    expect(r.settled).toBe(true)
    expect(r.select).not.toHaveBeenCalled()
    expect(r.confirm).not.toHaveBeenCalled()
    expect(r.warn).not.toHaveBeenCalled()
  })

  it('同步（sync）找到目标：选中目标', () => {
    const nodes = nodesWith(
      new Map([
        [projUri, ready([dir(projUri, 'a')])],
        [aUri, ready([dir(aUri, 'b.txt', 'file')])]
      ])
    )
    const r = settle(nodes, 'sync')
    expect(r.settled).toBe(true)
    expect(r.select).toHaveBeenCalledWith(nodes.findIndex((n) => n.id === path.target))
  })

  it('连条目都不在树中：只提示（没有可选中、可确认的节点）', () => {
    const r = settle([])
    expect(r.settled).toBe(true)
    expect(r.select).not.toHaveBeenCalled()
    expect(r.confirm).not.toHaveBeenCalled()
    expect(r.warn).toHaveBeenCalledTimes(1)
  })
})

describe('settleRevealTimeout', () => {
  it('定位（locate）超时：选中已到达的最深一层并提示', () => {
    const effects = { select: vi.fn(), warn: vi.fn() }
    settleRevealTimeout({ index: 3 }, 'locate', effects)
    expect(effects.select).toHaveBeenCalledWith(3)
    expect(effects.warn).toHaveBeenCalledTimes(1)
  })

  it('定位（locate）超时且没有已出现的祖先：只提示', () => {
    const effects = { select: vi.fn(), warn: vi.fn() }
    settleRevealTimeout({ index: -1 }, 'locate', effects)
    expect(effects.select).not.toHaveBeenCalled()
    expect(effects.warn).toHaveBeenCalledTimes(1)
  })

  it('同步（sync）超时：什么都不做——树保持原选中（设计 2.4）', () => {
    const effects = { select: vi.fn(), warn: vi.fn() }
    settleRevealTimeout({ index: 3 }, 'sync', effects)
    expect(effects.select).not.toHaveBeenCalled()
    expect(effects.warn).not.toHaveBeenCalled()
  })
})
