import { describe, expect, it } from 'vitest'
import { resolveSelection } from './selection'
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
