import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type WorkspaceEntry } from '@pch/shared'
import { buildScannerConfig } from './scanner-config'

const entry = (
  id: string,
  workspaceId: string,
  kind: WorkspaceEntry['kind'],
  uri: string | null,
  cacheStrategy: WorkspaceEntry['cacheStrategy'] = null
): WorkspaceEntry => ({
  id,
  workspaceId,
  parentId: null,
  kind,
  label: id,
  uri,
  sortOrder: 0,
  meta: null,
  cacheStrategy,
  createdAt: 0,
  updatedAt: 0
})

describe('buildScannerConfig', () => {
  const entries = [
    entry('a', 'w1', 'folder', 'file:///C:/a/'),
    entry('n', 'w1', 'folder', 'file://srv/share/x'),
    entry('g', 'w1', 'group', null),
    entry('f', 'w1', 'file', 'file:///C:/a/x.txt'),
    entry('o', 'w2', 'folder', 'file:///D:/other')
  ]
  const location = (uri: string): 'local' | 'network' =>
    uri.startsWith('file:///') ? 'local' : 'network'

  it('当前工作区的 folder 条目为根（级别取按位置的全局默认），所有工作区的 folder 条目进入 allRootUris', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      'cache.strategy.local': 'all' as const,
      'cache.interval.focus.local': 3,
      'cache.interval.near.local': 20,
      'cache.interval.far.network': 600,
      'cache.backgroundGapMs.network': 4000
    }
    const c = buildScannerConfig({
      activeWorkspaceIds: ['w1'],
      allFolderEntries: entries,
      indexTargets: [],
      settings,
      location
    })
    expect(c.roots).toEqual([
      { entryId: 'a', workspaceId: 'w1', uri: 'file:///C:/a', strategy: 'all', location: 'local' },
      {
        entryId: 'n',
        workspaceId: 'w1',
        uri: 'file://srv/share/x',
        strategy: 'default',
        location: 'network'
      }
    ])
    expect(c.allRootUris).toEqual(['file:///C:/a', 'file://srv/share/x', 'file:///D:/other'])
    expect(c.settings).toEqual({
      interval: {
        focus: { local: 3, network: 10 },
        near: { local: 20, network: 60 },
        far: { local: 120, network: 600 }
      },
      backgroundGapMs: { local: 500, network: 4000 },
      timeoutSec: { local: 5, network: 10 },
      activeDepth: 3
    })
  })

  it('位置无法判断的条目不下发为根', () => {
    const c = buildScannerConfig({
      activeWorkspaceIds: ['w1'],
      allFolderEntries: [entry('a', 'w1', 'folder', 'file:///C:/a')],
      indexTargets: [],
      settings: DEFAULT_SETTINGS,
      location: () => {
        throw new Error('bad uri')
      }
    })
    expect(c.roots).toEqual([])
    expect(c.allRootUris).toEqual(['file:///C:/a'])
  })

  it('条目级缓存策略优先于按位置的全局默认；null 沿用全局默认', () => {
    const c = buildScannerConfig({
      activeWorkspaceIds: ['w1'],
      allFolderEntries: [
        entry('a', 'w1', 'folder', 'file:///C:/a', 'passive'),
        entry('b', 'w1', 'folder', 'file:///C:/b', null),
        entry('n', 'w1', 'folder', 'file://srv/share/x', 'all')
      ],
      indexTargets: [],
      settings: { ...DEFAULT_SETTINGS, 'cache.strategy.local': 'active' },
      location
    })
    expect(c.roots.map((r) => [r.entryId, r.strategy])).toEqual([
      ['a', 'passive'],
      ['b', 'active'],
      ['n', 'all']
    ])
  })

  it('indexTargets 只含活动工作区的目标（并规范化、去重）', () => {
    const c = buildScannerConfig({
      activeWorkspaceIds: ['w1'],
      allFolderEntries: entries,
      indexTargets: [
        { workspaceId: 'w1', uri: 'file:///C:/a/sub/' },
        { workspaceId: 'w1', uri: 'file:///C:/a/sub' },
        { workspaceId: 'w2', uri: 'file:///D:/other/x' }
      ],
      settings: DEFAULT_SETTINGS,
      location
    })
    expect(c.indexTargets).toEqual(['file:///C:/a/sub'])
  })

  it('没有活动工作区时 roots 为空，allRootUris 仍包含所有工作区', () => {
    const c = buildScannerConfig({
      activeWorkspaceIds: [],
      allFolderEntries: entries,
      indexTargets: [],
      settings: DEFAULT_SETTINGS,
      location
    })
    expect(c.roots).toEqual([])
    expect(c.allRootUris).toHaveLength(3)
  })
})
