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
  it('空白处：新建分组、添加文件夹 / 文件 / 远程文件夹', () => {
    expect(menuItemsFor(null)).toEqual([
      'newGroup',
      'separator',
      'addFolder',
      'addFile',
      'addRemoteFolder'
    ])
  })

  it('远程（sftp）节点：没有「在资源管理器中显示」与「缓存策略」，复制与索引照常', () => {
    const remote = { uri: 'sftp://ID/home/pchuser' }
    expect(menuItemsFor(node({ ...remote, kind: 'folder' }))).toEqual([
      'openInNewTab',
      'separator',
      'copyPath',
      'copyUri',
      'separator',
      'buildIndex',
      'separator',
      'rename',
      'remove'
    ])
    const fs = { ...remote, source: 'fs' as const, id: 'fs:e1:a' }
    expect(menuItemsFor(node({ ...fs, kind: 'directory' }))).toEqual([
      'openInNewTab',
      'separator',
      'copyPath',
      'copyUri',
      'separator',
      'buildIndex',
      'separator',
      'pinToRoot'
    ])
    expect(menuItemsFor(node({ ...fs, kind: 'file' }))).toEqual([
      'openInNewTab',
      'separator',
      'copyPath',
      'copyUri',
      'separator',
      'pinToRoot'
    ])
    expect(menuItemsFor(node({ ...fs, kind: 'link-broken' }))).toEqual(['copyPath', 'copyUri'])
  })

  it('分组：新建子分组、重命名、移除', () => {
    expect(menuItemsFor(node({ kind: 'group', uri: null }))).toEqual([
      'newGroup',
      'separator',
      'rename',
      'remove'
    ])
  })

  it('folder 条目：缓存策略与建立索引；file 条目只有显示与复制', () => {
    expect(menuItemsFor(node({ kind: 'folder' }))).toEqual([
      'openInNewTab',
      'separator',
      'reveal',
      'copyPath',
      'copyUri',
      'separator',
      'cacheStrategy',
      'buildIndex',
      'separator',
      'rename',
      'remove'
    ])
    expect(menuItemsFor(node({ kind: 'file' }))).toEqual([
      'openInNewTab',
      'separator',
      'reveal',
      'copyPath',
      'copyUri',
      'separator',
      'rename',
      'remove'
    ])
  })

  it('可打开的节点（条目根、真实目录 / 文件、有效链接）以「在新标签页中打开」开头；分组没有', () => {
    const fs = { source: 'fs' as const, id: 'fs:e1:a' }
    for (const kind of ['folder', 'file'] as const) {
      expect(menuItemsFor(node({ kind }))[0]).toBe('openInNewTab')
    }
    for (const kind of ['directory', 'file', 'link-file', 'link-directory'] as const) {
      expect(menuItemsFor(node({ ...fs, kind })).slice(0, 2)).toEqual(['openInNewTab', 'separator'])
    }
    expect(menuItemsFor(node({ kind: 'group', uri: null }))).not.toContain('openInNewTab')
  })

  it('任何节点都没有「用系统应用打开」', () => {
    const fs = { source: 'fs' as const, id: 'fs:e1:a' }
    const kinds: NodeKind[] = [
      'group',
      'folder',
      'file',
      'directory',
      'link-file',
      'link-directory'
    ]
    for (const kind of kinds) {
      expect(menuItemsFor(node({ ...fs, kind }))).not.toContain('open')
      expect(menuItemsFor(node({ kind }))).not.toContain('open')
    }
  })

  it('真实子目录：可建立索引与固定到根部；文件只可固定；都不能重命名或移除', () => {
    const fs = { source: 'fs' as const, id: 'fs:e1:a' }
    expect(menuItemsFor(node({ ...fs, kind: 'directory' }))).toEqual([
      'openInNewTab',
      'separator',
      'reveal',
      'copyPath',
      'copyUri',
      'separator',
      'buildIndex',
      'separator',
      'pinToRoot'
    ])
    for (const kind of ['file', 'link-file'] as const) {
      expect(menuItemsFor(node({ ...fs, kind }))).toEqual([
        'openInNewTab',
        'separator',
        'reveal',
        'copyPath',
        'copyUri',
        'separator',
        'pinToRoot'
      ])
    }
    expect(menuItemsFor(node({ ...fs, kind: 'link-directory' }))).toContain('pinToRoot')
    expect(menuItemsFor(node({ ...fs, kind: 'link-directory' }))).not.toContain('buildIndex')
  })

  it('失效链接：只有显示与复制，没有「在新标签页中打开」和「固定」', () => {
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

  it('无权限的远程状态行可以「以属主身份添加为条目」时，菜单只有这一项（键盘可达）', () => {
    const denied = node({
      id: 'fs:e1:log#status',
      kind: 'directory',
      source: 'fs',
      uri: 'sftp://ID/opt/app1/log',
      status: 'error',
      errorCode: 'FS_PERMISSION_DENIED',
      owner: 'app1'
    })
    expect(menuItemsFor(denied, { canAddAsOwner: true })).toEqual(['addAsOwner'])
    expect(menuItemsFor(denied)).toEqual([])
    // 只作用于状态行：普通节点不受影响
    expect(menuItemsFor(node({ kind: 'folder' }), { canAddAsOwner: true })).not.toContain(
      'addAsOwner'
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
