import { describe, expect, it } from 'vitest'
import type { WorkspaceEntry } from '@pch/shared'
import { hiddenSelectionIndex, resolveSelection } from './selection'
import type { TreeNode } from './tree-model'

function node(id: string, parentId: string | null): TreeNode {
  return {
    id,
    parentId,
    depth: 0,
    label: id,
    kind: 'directory',
    source: 'fs',
    entryId: 'f',
    uri: null,
    expandable: false,
    expanded: false
  }
}

const nodes = [
  node('entry:f', null),
  node('fs:f:a', 'entry:f'),
  node('fs:f:b', 'entry:f'),
  node('fs:f:c', 'entry:f')
]

describe('resolveSelection', () => {
  it('returns -1 when nothing is selected', () => {
    expect(resolveSelection(nodes, null, 2)).toBe(-1)
  })

  it('returns the index of a selected node that is still visible', () => {
    expect(resolveSelection(nodes, 'fs:f:b', 0)).toBe(2)
  })

  it('falls back to the parent when the selected status row has disappeared', () => {
    // 加载中 / 出错的状态行被真实子项取代：选择回到所属目录
    expect(resolveSelection(nodes, 'fs:f:a#status', 3)).toBe(1)
    expect(resolveSelection(nodes, 'entry:f#status', 3)).toBe(0)
  })

  it('keeps the previous position (clamped) when the selected node was removed', () => {
    // 被删除的 b 原来在第 2 行：停在同一位置（现在是 c），而不是跳回第 0 行
    const withoutB = nodes.filter((n) => n.id !== 'fs:f:b')
    expect(resolveSelection(withoutB, 'fs:f:b', 2)).toBe(2)
    // 原位置超出末尾：钳制到最后一行
    expect(resolveSelection(withoutB, 'fs:f:b', 9)).toBe(2)
    // 状态行的父节点也不在了：同样按位置回退
    expect(resolveSelection(withoutB, 'fs:f:x#status', 1)).toBe(1)
  })

  it('returns -1 when the selection is gone and there is no previous position', () => {
    expect(resolveSelection(nodes, 'fs:f:gone', -1)).toBe(-1)
    expect(resolveSelection([], 'fs:f:gone', 3)).toBe(-1)
  })
})

describe('hiddenSelectionIndex：选中项被折叠的祖先挡住（Review Focus 5）', () => {
  const groupEntry = (
    id: string,
    kind: WorkspaceEntry['kind'],
    parentId: string | null
  ): WorkspaceEntry => ({ id, kind, parentId }) as WorkspaceEntry
  // 顶层分组 A ⊃ folder 条目 f（真实目录 sub/x）；未分组的 folder 条目 r
  const entries = [
    groupEntry('A', 'group', null),
    groupEntry('f', 'folder', 'A'),
    groupEntry('r', 'folder', null)
  ]
  const at = (id: string, expanded: boolean): TreeNode => ({
    ...node(id, null),
    expandable: true,
    expanded
  })

  it('选中项还在列表中、或是状态行：-1（按原规则处理）', () => {
    const nodes = [at('entry:r', false), at('entry:A', true), at('entry:f', false)]
    expect(hiddenSelectionIndex(nodes, entries, 'entry:f')).toBe(-1)
    expect(hiddenSelectionIndex(nodes, entries, 'entry:f#status')).toBe(-1)
    expect(hiddenSelectionIndex(nodes, entries, null)).toBe(-1)
  })

  it('所在的顶层分组被收起：返回该分组的位置（store 中的选中不改写）', () => {
    const nodes = [at('entry:r', false), at('entry:A', false)]
    expect(hiddenSelectionIndex(nodes, entries, 'fs:f:sub/x')).toBe(1)
    expect(hiddenSelectionIndex(nodes, entries, 'entry:f')).toBe(1)
  })

  it('全部折叠后：返回最近的可见祖先（折叠的目录或条目）', () => {
    const nodes = [
      at('entry:r', false),
      at('entry:A', true),
      at('entry:f', true),
      at('fs:f:sub', false)
    ]
    expect(hiddenSelectionIndex(nodes, entries, 'fs:f:sub/x')).toBe(3)
    expect(hiddenSelectionIndex(nodes, entries, 'fs:r:y')).toBe(0)
  })

  it('最近的可见祖先是展开的（节点已被删除）：-1（按原规则停在原位置）', () => {
    const nodes = [
      at('entry:r', false),
      at('entry:A', true),
      at('entry:f', true),
      at('fs:f:sub', true)
    ]
    expect(hiddenSelectionIndex(nodes, entries, 'fs:f:sub/x')).toBe(-1)
    // 条目已被移除、祖先都不在：-1
    expect(hiddenSelectionIndex(nodes, entries, 'entry:gone')).toBe(-1)
  })

  it('最近的可见祖先已展开但子项尚未加载（加载中 / 出错）：视为被挡住，返回该祖先', () => {
    // 抽屉重新展开时，收起期间被回收的目录缓存重新加载：只有状态行，选中项暂时不在列表中
    const status = (parentId: string, s: 'loading' | 'error' | 'empty'): TreeNode => ({
      ...node(`${parentId}#status`, parentId),
      status: s
    })
    const loading = [
      at('entry:r', false),
      at('entry:A', true),
      at('entry:f', true),
      status('entry:f', 'loading')
    ]
    expect(hiddenSelectionIndex(loading, entries, 'fs:f:sub/x')).toBe(2)
    expect(hiddenSelectionIndex(loading, entries, 'fs:f:sub')).toBe(2)
    const failed = [at('entry:r', true), status('entry:r', 'error')]
    expect(hiddenSelectionIndex(failed, entries, 'fs:r:y')).toBe(0)
    // 已加载且为空：选中项确实不在了，按原规则回退
    const empty = [at('entry:r', true), status('entry:r', 'empty')]
    expect(hiddenSelectionIndex(empty, entries, 'fs:r:y')).toBe(-1)
  })
})
