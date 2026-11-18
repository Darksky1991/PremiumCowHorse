import { describe, expect, it } from 'vitest'
import { isEntryNode, menuItemsFor } from './menu-items'
import type { NodeKind, TreeNode } from './tree-model'

const node = (over: Partial<TreeNode> & { kind: NodeKind }): TreeNode => ({
  id: 'entry:e1',
  parentId: null,
  depth: 0,
  label: 'x',
  source: 'entry',
  entryId: 'e1',
  uri: 'file:///C:/x',
  expandable: false,
  expanded: false,
  ...over
})

describe('menuItemsFor', () => {
  it('空白处：新建分组、添加文件夹 / 文件', () => {
    expect(menuItemsFor(null)).toEqual(['newGroup', 'separator', 'addFolder', 'addFile'])
  })

  it('分组：新建子分组、重命名、移除', () => {
    expect(menuItemsFor(node({ kind: 'group', uri: null }))).toEqual([
      'newGroup',
      'separator',
      'rename',
      'remove'
    ])
  })

  it('folder 条目没有「用系统应用打开」，file 条目有', () => {
    expect(menuItemsFor(node({ kind: 'folder' }))).toEqual([
      'reveal',
      'copyPath',
      'copyUri',
      'separator',
      'rename',
      'remove'
    ])
    expect(menuItemsFor(node({ kind: 'file' }))).toEqual([
      'reveal',
      'open',
      'copyPath',
      'copyUri',
      'separator',
      'rename',
      'remove'
    ])
  })

  it('真实子项：目录无「打开」，文件有；都可固定到根部，不能重命名或移除', () => {
    const fs = { source: 'fs' as const, id: 'fs:e1:a' }
    expect(menuItemsFor(node({ ...fs, kind: 'directory' }))).toEqual([
      'reveal',
      'copyPath',
      'copyUri',
      'separator',
      'pinToRoot'
    ])
    for (const kind of ['file', 'link-file'] as const) {
      expect(menuItemsFor(node({ ...fs, kind }))).toEqual([
        'reveal',
        'open',
        'copyPath',
        'copyUri',
        'separator',
        'pinToRoot'
      ])
    }
    expect(menuItemsFor(node({ ...fs, kind: 'link-directory' }))).toContain('pinToRoot')
  })

  it('失效链接：只有显示与复制，没有「打开」和「固定」', () => {
    expect(menuItemsFor(node({ source: 'fs', id: 'fs:e1:a', kind: 'link-broken' }))).toEqual([
      'reveal',
      'copyPath',
      'copyUri'
    ])
  })

  it('状态行没有菜单', () => {
    expect(menuItemsFor(node({ id: 'entry:e1#status', kind: 'folder', status: 'empty' }))).toEqual(
      []
    )
  })
})

describe('isEntryNode', () => {
  it('只有条目节点（含分组）为真，状态行与真实子项为假', () => {
    expect(isEntryNode(node({ kind: 'group' }))).toBe(true)
    expect(isEntryNode(node({ id: 'entry:e1#status', kind: 'folder', status: 'loading' }))).toBe(
      false
    )
    expect(isEntryNode(node({ source: 'fs', id: 'fs:e1:a', kind: 'file' }))).toBe(false)
    expect(isEntryNode(undefined)).toBe(false)
  })
})
