import { describe, expect, it } from 'vitest'
import type { FileEntry, WorkspaceEntry } from '@pch/shared'
import type { DirectoryState } from '@renderer/data/vfs'
import {
  buildVisibleNodes,
  requiredDirectoryUris,
  resolveDirectoryUris,
  type TreeNode
} from './tree-model'

const ROOT = 'file:///C:/work'

function entry(
  id: string,
  kind: WorkspaceEntry['kind'],
  opts: { parentId?: string | null; sortOrder?: number; label?: string; uri?: string | null } = {}
): WorkspaceEntry {
  return {
    id,
    workspaceId: 'ws',
    parentId: opts.parentId ?? null,
    kind,
    label: opts.label ?? id,
    uri: opts.uri ?? (kind === 'group' ? null : `${ROOT}/${id}`),
    sortOrder: opts.sortOrder ?? 0,
    meta: null,
    refreshLevel: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function item(
  parentUri: string,
  name: string,
  kind: FileEntry['kind'],
  extra: Partial<FileEntry> = {}
): FileEntry {
  return {
    uri: `${parentUri}/${encodeURIComponent(name)}`,
    name,
    kind,
    size: 0,
    mtime: 0,
    hidden: name.startsWith('.'),
    ...extra
  }
}

const ready = (items: FileEntry[]): DirectoryState => ({
  status: 'ready',
  items,
  state: 'fresh',
  checkedAt: 0
})

function build(
  entries: WorkspaceEntry[],
  expanded: string[],
  directories: [string, DirectoryState][] = [],
  showHidden = false
): TreeNode[] {
  return buildVisibleNodes({
    entries,
    expanded: new Set(expanded),
    directories: new Map(directories),
    showHidden
  })
}

const ids = (nodes: TreeNode[]): string[] => nodes.map((n) => n.id)

describe('buildVisibleNodes', () => {
  it('nests groups inside groups and orders siblings by sortOrder', () => {
    const entries = [
      entry('logs', 'group', { sortOrder: 1 }),
      entry('docs', 'group', { sortOrder: 0 }),
      entry('inner', 'group', { parentId: 'docs', sortOrder: 0 }),
      entry('spec', 'file', { parentId: 'inner', sortOrder: 0 }),
      entry('readme', 'file', { parentId: 'docs', sortOrder: 1 })
    ]

    // 未展开：只有根级条目
    expect(ids(build(entries, []))).toEqual(['entry:docs', 'entry:logs'])

    const nodes = build(entries, ['entry:docs', 'entry:inner'])
    expect(ids(nodes)).toEqual([
      'entry:docs',
      'entry:inner',
      'entry:spec',
      'entry:readme',
      'entry:logs'
    ])
    expect(nodes.map((n) => n.depth)).toEqual([0, 1, 2, 1, 0])
    expect(nodes[1]).toMatchObject({
      parentId: 'entry:docs',
      kind: 'group',
      source: 'entry',
      entryId: 'inner',
      uri: null,
      expandable: true,
      expanded: true
    })
    expect(nodes[2]).toMatchObject({ kind: 'file', expandable: false, expanded: false })
  })

  it('lists real children of an expanded folder, directories first, with Japanese numeric order', () => {
    const f = entry('f', 'folder', { label: '設計書' })
    const uri = f.uri as string
    const chapter2 = item(uri, '第2章', 'directory')
    const nodes = build(
      [f],
      ['entry:f', 'fs:f:第2章'],
      [
        [
          uri,
          ready([
            item(uri, 'b.txt', 'file'),
            item(uri, '第10章', 'directory'),
            chapter2,
            item(uri, 'a.txt', 'file')
          ])
        ],
        [chapter2.uri, ready([item(chapter2.uri, '図1.png', 'file')])]
      ]
    )

    expect(ids(nodes)).toEqual([
      'entry:f',
      'fs:f:第2章',
      'fs:f:第2章/図1.png',
      'fs:f:第10章',
      'fs:f:a.txt',
      'fs:f:b.txt'
    ])
    expect(nodes[0]).toMatchObject({ kind: 'folder', label: '設計書', uri, expanded: true })
    expect(nodes[1]).toMatchObject({
      parentId: 'entry:f',
      depth: 1,
      kind: 'directory',
      source: 'fs',
      entryId: 'f',
      uri: chapter2.uri,
      expandable: true,
      expanded: true
    })
    expect(nodes[2]).toMatchObject({ parentId: 'fs:f:第2章', depth: 2, kind: 'file' })
    expect(nodes[3]).toMatchObject({ kind: 'directory', expanded: false })
  })

  it('hides dot-prefixed items unless showHidden is on', () => {
    const f = entry('f', 'folder')
    const uri = f.uri as string
    const dirs: [string, DirectoryState][] = [
      [uri, ready([item(uri, '.git', 'directory'), item(uri, 'src', 'directory')])]
    ]
    expect(ids(build([f], ['entry:f'], dirs, false))).toEqual(['entry:f', 'fs:f:src'])
    expect(ids(build([f], ['entry:f'], dirs, true))).toEqual(['entry:f', 'fs:f:.git', 'fs:f:src'])
  })

  it('classifies symlinks by their resolved target', () => {
    const f = entry('f', 'folder')
    const uri = f.uri as string
    const nodes = build(
      [f],
      ['entry:f', 'fs:f:d', 'fs:f:x', 'fs:f:u'],
      [
        [
          uri,
          ready([
            item(uri, 'd', 'symlink', { target: 'directory' }),
            item(uri, 'l', 'symlink', { target: 'file' }),
            item(uri, 'x', 'symlink', { target: null }),
            // 读取失败的降级 symlink 项：没有 target 字段
            item(uri, 'u', 'symlink')
          ])
        ]
      ]
    )
    const byLabel = new Map(nodes.map((n) => [n.label, n]))

    expect(byLabel.get('d')).toMatchObject({ kind: 'link-directory', expandable: true })
    expect(byLabel.get('l')).toMatchObject({ kind: 'link-file', expandable: false })
    expect(byLabel.get('x')).toMatchObject({
      kind: 'link-broken',
      expandable: false,
      expanded: false
    })
    expect(byLabel.get('u')).toMatchObject({
      kind: 'link-broken',
      expandable: false,
      expanded: false
    })
    // 链接目录可展开，排在其他项之前
    expect(nodes[1]?.label).toBe('d')
  })

  it('emits a single status row for an expanded directory that is loading, failed or empty', () => {
    const f = entry('f', 'folder')
    const uri = f.uri as string

    const loading = build([f], ['entry:f'], [[uri, { status: 'loading' }]])
    expect(loading).toHaveLength(2)
    expect(loading[1]).toMatchObject({
      id: 'entry:f#status',
      parentId: 'entry:f',
      depth: 1,
      status: 'loading',
      expandable: false
    })

    // 尚未开始加载（Map 中没有该 URI）也视为加载中
    expect(build([f], ['entry:f'])[1]).toMatchObject({ status: 'loading' })

    const failed = build([f], ['entry:f'], [[uri, { status: 'error', code: 'FS_UNAVAILABLE' }]])
    expect(failed).toHaveLength(2)
    expect(failed[1]).toMatchObject({
      id: 'entry:f#status',
      status: 'error',
      errorCode: 'FS_UNAVAILABLE',
      // 「重试」据此让该目录重新获取
      uri
    })

    const empty = build([f], ['entry:f'], [[uri, ready([])]])
    expect(empty).toHaveLength(2)
    expect(empty[1]).toMatchObject({ id: 'entry:f#status', status: 'empty' })

    // 只有隐藏项且不显示隐藏项时也为空
    const onlyHidden = build([f], ['entry:f'], [[uri, ready([item(uri, '.env', 'file')])]])
    expect(onlyHidden[1]).toMatchObject({ status: 'empty' })

    // 展开的空分组同样给出「空」提示
    const group = build([entry('g', 'group')], ['entry:g'])
    expect(group).toHaveLength(2)
    expect(group[1]).toMatchObject({ id: 'entry:g#status', status: 'empty', uri: null })
  })

  it('handles a directory with 10,000 items: one row each plus ancestors, all ids unique', () => {
    const g = entry('g', 'group')
    const f = entry('f', 'folder', { parentId: 'g' })
    const uri = f.uri as string
    const items = Array.from({ length: 10_000 }, (_, i) => item(uri, `file${i}.log`, 'file'))
    const nodes = build([g, f], ['entry:g', 'entry:f'], [[uri, ready(items)]])

    expect(nodes).toHaveLength(10_000 + 2)
    expect(new Set(ids(nodes)).size).toBe(nodes.length)
    // 数字按数值排序
    expect(nodes[2]?.label).toBe('file0.log')
    expect(nodes[3]?.label).toBe('file1.log')
    expect(nodes[12]?.label).toBe('file10.log')
  })
})

describe('requiredDirectoryUris', () => {
  it('contains only expanded expandable nodes and drops descendants of collapsed ones', () => {
    const g = entry('g', 'group')
    const f = entry('f', 'folder', { parentId: 'g' })
    const other = entry('other', 'folder')
    const uri = f.uri as string
    const sub = item(uri, 'sub', 'directory')
    const link = item(uri, 'link', 'symlink', { target: 'directory' })
    const broken = item(uri, 'broken', 'symlink')
    const dirs: [string, DirectoryState][] = [[uri, ready([sub, link, broken])]]
    const input = (expanded: string[]): Parameters<typeof requiredDirectoryUris>[0] => ({
      entries: [g, f, other],
      expanded: new Set(expanded),
      directories: new Map(dirs),
      showHidden: false
    })

    const all = ['entry:g', 'entry:f', 'fs:f:sub', 'fs:f:link', 'fs:f:broken']
    expect(requiredDirectoryUris(input(all)).sort()).toEqual([link.uri, uri, sub.uri].sort())

    // 折叠分组：其下的 folder 与子目录都不再需要
    expect(requiredDirectoryUris(input(all.slice(1)))).toEqual([])

    // 折叠 folder：子目录虽仍记录为展开，但不可见，不再需要
    expect(requiredDirectoryUris(input(['entry:g', 'fs:f:sub']))).toEqual([])
  })

  it('resolveDirectoryUris follows already-listed directories down to the deepest expanded level', () => {
    const f = entry('f', 'folder')
    const uri = f.uri as string
    const a = item(uri, 'a', 'directory')
    const b = item(a.uri, 'b', 'directory')
    const c = item(b.uri, 'c', 'directory')
    const listed = new Map<string, DirectoryState>([
      [uri, ready([a])],
      [a.uri, ready([b])],
      [b.uri, ready([c])]
    ])
    const lookups: string[] = []
    const uris = resolveDirectoryUris(
      {
        entries: [f],
        expanded: new Set(['entry:f', 'fs:f:a', 'fs:f:a/b', 'fs:f:a/b/c']),
        showHidden: false
      },
      (u) => {
        lookups.push(u)
        return listed.get(u)
      }
    )

    // c 尚未列出也需要（展开中，待加载）
    expect(uris.sort()).toEqual([uri, a.uri, b.uri, c.uri].sort())
    // 每个目录只查一次
    expect(lookups.sort()).toEqual([uri, a.uri, b.uri, c.uri].sort())
  })

  it('deduplicates the same directory reached from two entries', () => {
    const a = entry('a', 'folder', { uri: `${ROOT}/shared` })
    const b = entry('b', 'folder', { uri: `${ROOT}/shared`, sortOrder: 1 })
    expect(
      requiredDirectoryUris({
        entries: [a, b],
        expanded: new Set(['entry:a', 'entry:b']),
        directories: new Map(),
        showHidden: false
      })
    ).toEqual([`${ROOT}/shared`])
  })
})

describe('offline roots and cached listings', () => {
  const NET = 'file://srv/share/案件'

  it('marks the root entry on an offline share and dims everything below it', () => {
    const offlineRoot = entry('n', 'folder', { uri: NET })
    const localRoot = entry('l', 'folder', { uri: `${ROOT}/l`, sortOrder: 1 })
    const sub = item(NET, 'sub', 'directory')
    const nodes = buildVisibleNodes({
      entries: [offlineRoot, localRoot],
      expanded: new Set(['entry:n', 'entry:l', 'fs:n:sub']),
      directories: new Map<string, DirectoryState>([
        [NET, ready([sub])],
        [sub.uri, ready([item(sub.uri, 'a.txt', 'file')])],
        [`${ROOT}/l`, ready([item(`${ROOT}/l`, 'b.txt', 'file')])]
      ]),
      showHidden: false,
      offlineShares: { '\\\\srv\\share': 1 }
    })
    const byId = new Map(nodes.map((n) => [n.id, n]))
    expect(byId.get('entry:n')?.offline).toBe(true)
    expect(byId.get('entry:n')?.dimmed).toBeUndefined()
    expect(byId.get('fs:n:sub')?.dimmed).toBe(true)
    expect(byId.get('fs:n:sub/a.txt')?.dimmed).toBe(true)
    expect(byId.get('entry:l')?.offline).toBeUndefined()
    expect(byId.get('fs:l:b.txt')?.dimmed).toBeUndefined()
  })

  it('carries the last-checked time on directories showing cached or offline listings', () => {
    const f = entry('f', 'folder')
    const uri = f.uri as string
    const sub = item(uri, 'sub', 'directory')
    const nodes = buildVisibleNodes({
      entries: [f],
      expanded: new Set(['entry:f', 'fs:f:sub']),
      directories: new Map<string, DirectoryState>([
        [uri, { status: 'ready', items: [sub], state: 'cached', checkedAt: 1234 }],
        [sub.uri, { status: 'ready', items: [], state: 'fresh', checkedAt: 5678 }]
      ]),
      showHidden: false
    })
    expect(nodes.find((n) => n.id === 'entry:f')?.checkedAt).toBe(1234)
    // fresh 的目录与未展开的目录没有标注
    expect(nodes.find((n) => n.id === 'fs:f:sub')?.checkedAt).toBeUndefined()
  })
})
