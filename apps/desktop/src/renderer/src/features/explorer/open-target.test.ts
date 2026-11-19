import { describe, expect, it } from 'vitest'
import { openTarget } from './open-target'
import type { NodeKind, TreeNode } from './tree-model'

const node = (kind: NodeKind, extra: Partial<TreeNode> = {}): TreeNode => ({
  id: `n-${kind}`,
  parentId: null,
  depth: 0,
  label: `label-${kind}`,
  kind,
  source: 'fs',
  entryId: 'e1',
  uri: `file:///C:/x/${kind}`,
  expandable: false,
  expanded: false,
  ...extra
})

describe('openTarget', () => {
  it.each<[NodeKind, 'file' | 'directory']>([
    ['folder', 'directory'],
    ['directory', 'directory'],
    ['link-directory', 'directory'],
    ['file', 'file'],
    ['link-file', 'file']
  ])('%s 打开为 %s，标题为节点显示名', (kind, expected) => {
    expect(openTarget(node(kind))).toEqual({
      uri: `file:///C:/x/${kind}`,
      kind: expected,
      title: `label-${kind}`
    })
  })

  it('分组、失效链接不可打开', () => {
    expect(openTarget(node('group', { uri: null }))).toBeNull()
    expect(openTarget(node('link-broken'))).toBeNull()
  })

  it('状态行（沿用父节点的 kind / uri）不可打开', () => {
    for (const status of ['loading', 'error', 'empty'] as const) {
      expect(openTarget(node('folder', { status, label: '' }))).toBeNull()
    }
  })

  it('没有 URI 的节点不可打开', () => {
    expect(openTarget(node('folder', { uri: null }))).toBeNull()
  })

  it('null（没有选中）不可打开', () => {
    expect(openTarget(null)).toBeNull()
  })
})
