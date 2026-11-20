import { describe, expect, it } from 'vitest'
import { VFS_INTEREST_OFFSCREEN_MAX, VFS_INTEREST_VISIBLE_MAX } from '@pch/shared'
import { interestFromTree } from './interest'
import type { TreeNode } from './tree-model'

const node = (p: Partial<TreeNode> & Pick<TreeNode, 'id' | 'kind'>): TreeNode => ({
  parentId: null,
  depth: 0,
  label: p.id,
  source: 'fs',
  entryId: 'e1',
  uri: null,
  expandable: false,
  expanded: false,
  ...p
})

const R = 'file:///C:/root'
/**
 * 0 group            （展开的分组）
 * 1   folder R       （展开的条目根）
 * 2     dir R/a      （展开）
 * 3       file R/a/x.txt
 * 4       link-file R/a/l
 * 5     dir R/b      （折叠）
 * 6     link-dir R/c （展开）
 * 7       status     （R/c 加载中）
 * 8   file entry     （文件条目）
 * 9   folder R2      （展开，出错）
 * 10    status error
 */
const nodes: TreeNode[] = [
  node({ id: 'entry:g', kind: 'group', source: 'entry', expandable: true, expanded: true }),
  node({
    id: 'entry:e1',
    parentId: 'entry:g',
    kind: 'folder',
    source: 'entry',
    uri: R,
    expandable: true,
    expanded: true
  }),
  node({
    id: 'fs:e1:a',
    parentId: 'entry:e1',
    kind: 'directory',
    uri: `${R}/a`,
    expandable: true,
    expanded: true
  }),
  node({ id: 'fs:e1:a/x.txt', parentId: 'fs:e1:a', kind: 'file', uri: `${R}/a/x.txt` }),
  node({ id: 'fs:e1:a/l', parentId: 'fs:e1:a', kind: 'link-file', uri: `${R}/a/l` }),
  node({
    id: 'fs:e1:b',
    parentId: 'entry:e1',
    kind: 'directory',
    uri: `${R}/b`,
    expandable: true
  }),
  node({
    id: 'fs:e1:c',
    parentId: 'entry:e1',
    kind: 'link-directory',
    uri: `${R}/c`,
    expandable: true,
    expanded: true
  }),
  node({
    id: 'fs:e1:c#status',
    parentId: 'fs:e1:c',
    kind: 'link-directory',
    uri: `${R}/c`,
    status: 'loading'
  }),
  node({
    id: 'entry:f',
    parentId: 'entry:g',
    kind: 'file',
    source: 'entry',
    entryId: 'f',
    uri: 'file:///C:/memo.txt'
  }),
  node({
    id: 'entry:e2',
    parentId: 'entry:g',
    kind: 'folder',
    source: 'entry',
    entryId: 'e2',
    uri: 'file:///C:/gone',
    expandable: true,
    expanded: true
  }),
  node({
    id: 'entry:e2#status',
    parentId: 'entry:e2',
    kind: 'folder',
    source: 'entry',
    entryId: 'e2',
    uri: 'file:///C:/gone',
    status: 'error',
    errorCode: 'FS_NOT_FOUND'
  })
]
const all = { start: 0, end: nodes.length - 1 }

describe('interestFromTree：关注点', () => {
  it.each<[string | null, string | null, string]>([
    ['entry:e1', R, '条目根 → 条目 URI'],
    ['fs:e1:a', `${R}/a`, '目录 → 自身'],
    ['fs:e1:b', `${R}/b`, '折叠的目录 → 自身'],
    ['fs:e1:c', `${R}/c`, '链接目录 → 自身'],
    ['fs:e1:a/x.txt', `${R}/a`, '文件 → 父目录'],
    ['fs:e1:a/l', `${R}/a`, '链接文件 → 父目录'],
    ['entry:g', null, '分组 → null'],
    ['fs:e1:c#status', null, '状态行 → null'],
    ['entry:f', null, '文件条目（父目录不在树中）→ null'],
    [null, null, '没有选中 → null'],
    ['missing', null, '选中的节点已不在 → null']
  ])('%s → %s（%s）', (selectedId, focus) => {
    expect(interestFromTree(nodes, all, selectedId).focus).toBe(focus)
  })
})

describe('interestFromTree：视口内外', () => {
  it('全部在视口内：所有已展开目录都在 visible（树中自上而下的顺序），offscreen 为空', () => {
    const i = interestFromTree(nodes, all, null)
    expect(i.visible).toEqual([R, `${R}/a`, `${R}/c`, 'file:///C:/gone'])
    expect(i.offscreen).toEqual([])
  })

  it('范围内的行所属的已展开目录算在视口内，即使目录自身的行在范围之外', () => {
    // 只有第 3–4 行（R/a 下的文件）在视口内
    const i = interestFromTree(nodes, { start: 3, end: 4 }, null)
    expect(i.visible).toEqual([`${R}/a`])
    expect(i.offscreen).toEqual([R, `${R}/c`, 'file:///C:/gone'])
  })

  it('行本身是已展开目录时算在视口内；折叠的目录与文件不算目录', () => {
    const i = interestFromTree(nodes, { start: 5, end: 6 }, null)
    // 第 5 行 R/b 折叠（不算），其父 R 在视口内；第 6 行 R/c 展开
    expect(i.visible).toEqual([R, `${R}/c`])
    expect(i.offscreen).toEqual([`${R}/a`, 'file:///C:/gone'])
  })

  it('出错 / 加载中的目录（状态行所属的目录）仍算已展开目录', () => {
    const i = interestFromTree(nodes, { start: 10, end: 10 }, null)
    expect(i.visible).toEqual(['file:///C:/gone'])
  })

  it('没有渲染任何行时全部为 offscreen', () => {
    const i = interestFromTree(nodes, null, null)
    expect(i.visible).toEqual([])
    expect(i.offscreen).toEqual([R, `${R}/a`, `${R}/c`, 'file:///C:/gone'])
  })

  it('同一目录在树中出现多次（两个条目指向同一位置）时去重；在视口内的不再列入 offscreen', () => {
    const dup = [
      ...nodes,
      node({
        id: 'entry:e3',
        kind: 'folder',
        source: 'entry',
        entryId: 'e3',
        uri: R,
        expandable: true,
        expanded: true
      })
    ]
    const i = interestFromTree(dup, { start: 11, end: 11 }, null)
    expect(i.visible).toEqual([R])
    expect(i.offscreen).not.toContain(R)
  })

  it('超过 IPC 上限时按树中顺序截断（visible ≤ 2000，offscreen ≤ 5000）', () => {
    const many: TreeNode[] = Array.from({ length: VFS_INTEREST_OFFSCREEN_MAX + 10 }, (_, k) =>
      node({
        id: `fs:e1:d${k}`,
        kind: 'directory',
        uri: `${R}/d${k}`,
        expandable: true,
        expanded: true
      })
    )
    const visible = interestFromTree(many, { start: 0, end: many.length - 1 }, null).visible
    expect(visible).toHaveLength(VFS_INTEREST_VISIBLE_MAX)
    expect(visible[0]).toBe(`${R}/d0`)
    const offscreen = interestFromTree(many, null, null).offscreen
    expect(offscreen).toHaveLength(VFS_INTEREST_OFFSCREEN_MAX)
    expect(offscreen.at(-1)).toBe(`${R}/d${VFS_INTEREST_OFFSCREEN_MAX - 1}`)
  })
})
