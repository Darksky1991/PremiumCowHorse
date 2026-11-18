import { describe, expect, it } from 'vitest'
import {
  fsEntryKind,
  isDraggableNode,
  isStatusNode,
  osDropEffect,
  resolveDrop,
  type DragSource
} from './drag-drop'
import type { NodeKind, TreeNode } from './tree-model'

/** 条目节点：id = entry:<id>，父节点为分组时 parent 传分组的条目 id */
function entryNode(id: string, kind: 'group' | 'folder' | 'file', parent?: string): TreeNode {
  return {
    id: `entry:${id}`,
    parentId: parent === undefined ? null : `entry:${parent}`,
    depth: parent === undefined ? 0 : 1,
    label: id,
    kind,
    source: 'entry',
    entryId: id,
    uri: kind === 'group' ? null : `file:///C:/${id}`,
    expandable: true,
    expanded: true
  }
}

function fsNode(name: string, kind: NodeKind, parent: string): TreeNode {
  return {
    id: `fs:${parent}:${name}`,
    parentId: `entry:${parent}`,
    depth: 1,
    label: name,
    kind,
    source: 'fs',
    entryId: parent,
    uri: `file:///C:/${parent}/${name}`,
    expandable: kind === 'directory',
    expanded: false
  }
}

function statusNode(parent: TreeNode): TreeNode {
  return {
    ...parent,
    id: `${parent.id}#status`,
    parentId: parent.id,
    depth: parent.depth + 1,
    label: '',
    expandable: false,
    expanded: false,
    status: 'empty'
  }
}

// 根：a、g（分组，含 c、d）、b、f（folder，已展开，含真实子目录 sub 与文件 x.txt）
const a = entryNode('a', 'file')
const g = entryNode('g', 'group')
const c = entryNode('c', 'file', 'g')
const d = entryNode('d', 'file', 'g')
const b = entryNode('b', 'file')
const f = entryNode('f', 'folder')
const sub = fsNode('sub', 'directory', 'f')
const txt = fsNode('x.txt', 'file', 'f')
const nodes = [a, g, c, d, b, f, sub, txt]

const END = Number.MAX_SAFE_INTEGER
const POSITIONS = ['before', 'after', 'inside'] as const

describe('resolveDrop：条目 → 条目', () => {
  it('同级向后拖到某条目之前：index 按「移除自身后」的位置计算', () => {
    // 根下顺序 a g b f：把 a 拖到 b 之前 → 移除 a 后为 g b f，b 在 1
    expect(resolveDrop({ type: 'entry', entryId: 'a' }, b, 'before', nodes)).toEqual({
      type: 'move',
      entryId: 'a',
      parentId: null,
      index: 1
    })
  })

  it('同级向后拖到某条目之后', () => {
    expect(resolveDrop({ type: 'entry', entryId: 'a' }, b, 'after', nodes)).toEqual({
      type: 'move',
      entryId: 'a',
      parentId: null,
      index: 2
    })
  })

  it('同级向前拖：b 拖到 a 之前 → index 0', () => {
    expect(resolveDrop({ type: 'entry', entryId: 'b' }, a, 'before', nodes)).toEqual({
      type: 'move',
      entryId: 'b',
      parentId: null,
      index: 0
    })
  })

  it('跨父节点：根下的 a 拖到分组内 d 之前 → 分组内 index 1', () => {
    expect(resolveDrop({ type: 'entry', entryId: 'a' }, d, 'before', nodes)).toEqual({
      type: 'move',
      entryId: 'a',
      parentId: 'g',
      index: 1
    })
  })

  it('拖进分组（inside）：追加到分组末尾', () => {
    expect(resolveDrop({ type: 'entry', entryId: 'a' }, g, 'inside', nodes)).toEqual({
      type: 'move',
      entryId: 'a',
      parentId: 'g',
      index: END
    })
  })

  it('inside 只允许分组：folder 与 file 条目上为 null', () => {
    expect(resolveDrop({ type: 'entry', entryId: 'a' }, f, 'inside', nodes)).toBeNull()
    expect(resolveDrop({ type: 'entry', entryId: 'g' }, b, 'inside', nodes)).toBeNull()
  })

  it('拖到自身或自己的后代 → null', () => {
    const outer = entryNode('outer', 'group')
    const inner = entryNode('inner', 'group', 'outer')
    const leaf = { ...entryNode('leaf', 'file', 'inner'), depth: 2 }
    const tree = [outer, inner, leaf]
    const src: DragSource = { type: 'entry', entryId: 'outer' }
    expect(resolveDrop(src, outer, 'inside', tree)).toBeNull()
    expect(resolveDrop(src, outer, 'before', tree)).toBeNull()
    expect(resolveDrop(src, inner, 'inside', tree)).toBeNull()
    expect(resolveDrop(src, inner, 'before', tree)).toBeNull()
    expect(resolveDrop(src, leaf, 'after', tree)).toBeNull()
  })

  it('拖到空白处 → 根末尾（index 为移除自身后的根条目数）', () => {
    // 根条目 a g b f，拖动 a → 其余 3 个
    expect(resolveDrop({ type: 'entry', entryId: 'a' }, null, 'after', nodes)).toEqual({
      type: 'move',
      entryId: 'a',
      parentId: null,
      index: 3
    })
    // 拖动分组内的 c → 根下现有 4 个
    expect(resolveDrop({ type: 'entry', entryId: 'c' }, null, 'after', nodes)).toEqual({
      type: 'move',
      entryId: 'c',
      parentId: null,
      index: 4
    })
  })
})

describe('resolveDrop：真实节点不接受放置（Review Focus 1）', () => {
  const sources: DragSource[] = [
    { type: 'entry', entryId: 'a' },
    { type: 'fs', uri: 'file:///C:/f/sub' },
    { type: 'os', paths: ['C:\\x.txt'] }
  ]

  it('任意来源、任意位置拖到真实节点上 → null', () => {
    for (const source of sources) {
      for (const position of POSITIONS) {
        expect(resolveDrop(source, sub, position, nodes)).toBeNull()
        expect(resolveDrop(source, txt, position, nodes)).toBeNull()
      }
    }
  })
})

describe('resolveDrop：真实子目录 / 系统文件 → add', () => {
  it('真实子目录拖到根（空白处）→ add，items 为 uri', () => {
    expect(resolveDrop({ type: 'fs', uri: sub.uri as string }, null, 'after', nodes)).toEqual({
      type: 'add',
      parentId: null,
      items: [{ uri: sub.uri }]
    })
  })

  it('真实子目录拖到分组上（inside）→ add 到该分组', () => {
    expect(resolveDrop({ type: 'fs', uri: sub.uri as string }, g, 'inside', nodes)).toEqual({
      type: 'add',
      parentId: 'g',
      items: [{ uri: sub.uri }]
    })
  })

  it('系统文件拖到分组内的条目之前 → add 到该分组，items 为 path', () => {
    expect(resolveDrop({ type: 'os', paths: ['C:\\a.txt', 'C:\\b'] }, c, 'before', nodes)).toEqual({
      type: 'add',
      parentId: 'g',
      items: [{ path: 'C:\\a.txt' }, { path: 'C:\\b' }]
    })
  })

  it('系统文件拖到根条目之后 → add 到根', () => {
    expect(resolveDrop({ type: 'os', paths: ['C:\\a.txt'] }, b, 'after', nodes)).toEqual({
      type: 'add',
      parentId: null,
      items: [{ path: 'C:\\a.txt' }]
    })
  })

  it('inside 到 folder / file 条目 → null', () => {
    expect(resolveDrop({ type: 'os', paths: ['C:\\a'] }, f, 'inside', nodes)).toBeNull()
    expect(resolveDrop({ type: 'fs', uri: 'file:///x' }, a, 'inside', nodes)).toBeNull()
  })
})

describe('状态行（决定 B）', () => {
  it('isStatusNode 识别状态行', () => {
    expect(isStatusNode(statusNode(f))).toBe(true)
    expect(isStatusNode(f)).toBe(false)
    expect(isStatusNode(sub)).toBe(false)
  })

  it('状态行不能作为放置目标：沿用父节点的 kind/uri 也不行', () => {
    // 分组的「空」状态行：kind 为 group，若不排除会被当成可 inside 的分组
    const status = statusNode(g)
    const sources: DragSource[] = [
      { type: 'entry', entryId: 'a' },
      { type: 'fs', uri: 'file:///x' },
      { type: 'os', paths: ['C:\\x'] }
    ]
    for (const source of sources) {
      for (const position of POSITIONS) {
        expect(resolveDrop(source, status, position, nodes)).toBeNull()
      }
    }
  })
})

describe('可拖动性与固定类型', () => {
  it('状态行与失效链接不可拖动，条目与真实子项可以', () => {
    expect(isDraggableNode(statusNode(f))).toBe(false)
    expect(isDraggableNode(fsNode('dead', 'link-broken', 'f'))).toBe(false)
    expect(isDraggableNode(sub)).toBe(true)
    expect(isDraggableNode(a)).toBe(true)
  })

  it('fsEntryKind：目录与目录链接 → folder，文件与文件链接 → file', () => {
    expect(fsEntryKind('directory')).toBe('folder')
    expect(fsEntryKind('link-directory')).toBe('folder')
    expect(fsEntryKind('file')).toBe('file')
    expect(fsEntryKind('link-file')).toBe('file')
  })
})

describe('空树 / 空状态', () => {
  it('空树上系统文件拖到空白处 → 根末尾 add', () => {
    expect(resolveDrop({ type: 'os', paths: ['C:\\a.txt'] }, null, 'after', [])).toEqual({
      type: 'add',
      parentId: null,
      items: [{ path: 'C:\\a.txt' }]
    })
  })

  it('osDropEffect：只用 copy / link，不接受仅允许 move 的来源', () => {
    expect(osDropEffect('uninitialized')).toBe('copy')
    expect(osDropEffect('all')).toBe('copy')
    expect(osDropEffect('copyMove')).toBe('copy')
    expect(osDropEffect('linkMove')).toBe('link')
    expect(osDropEffect('move')).toBeNull()
    expect(osDropEffect('none')).toBeNull()
  })
})
