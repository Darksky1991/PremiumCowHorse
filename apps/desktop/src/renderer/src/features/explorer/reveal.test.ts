import { describe, expect, it } from 'vitest'
import type { FileEntry, WorkspaceEntry } from '@pch/shared'
import type { DirectoryState } from '@renderer/data/vfs'
import { revealNodeIds, revealPath, revealProgress } from './reveal'
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
