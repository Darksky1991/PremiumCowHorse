import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type WorkspaceEntry } from '@pch/shared'
import { minimalScannerConfig, normalizeRootUri } from './scanner-config'

const entry = (
  id: string,
  workspaceId: string,
  kind: WorkspaceEntry['kind'],
  uri: string | null
): WorkspaceEntry => ({
  id,
  workspaceId,
  parentId: null,
  kind,
  label: id,
  uri,
  sortOrder: 0,
  meta: null,
  createdAt: 0,
  updatedAt: 0
})

describe('normalizeRootUri', () => {
  it.each([
    ['file:///C:/a/', 'file:///C:/a'],
    ['file:///C:/a//', 'file:///C:/a'],
    ['file:///C:/a', 'file:///C:/a'],
    ['file://srv/share/', 'file://srv/share'],
    ['file:///C:/', 'file:///C:/'],
    ['file:///C:', 'file:///C:/']
  ])('%s → %s', (input, expected) => {
    expect(normalizeRootUri(input)).toBe(expected)
  })
})

describe('minimalScannerConfig', () => {
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
      'refresh.defaultLevel.local': 'all' as const,
      'refresh.intervalSec.local': 2
    }
    const c = minimalScannerConfig({ activeWorkspaceIds: ['w1'], entries, settings, location })
    expect(c.roots).toEqual([
      { entryId: 'a', workspaceId: 'w1', uri: 'file:///C:/a', level: 'all', location: 'local' },
      {
        entryId: 'n',
        workspaceId: 'w1',
        uri: 'file://srv/share/x',
        level: 'default',
        location: 'network'
      }
    ])
    expect(c.allRootUris).toEqual(['file:///C:/a', 'file://srv/share/x', 'file:///D:/other'])
    expect(c.indexTargets).toEqual([])
    expect(c.settings).toEqual({
      intervalSec: { local: 2, network: 30 },
      backgroundIntervalMin: 10,
      timeoutSec: { local: 5, network: 10 },
      activeDepth: 3
    })
  })

  it('位置无法判断的条目不下发为根', () => {
    const c = minimalScannerConfig({
      activeWorkspaceIds: ['w1'],
      entries: [entry('a', 'w1', 'folder', 'file:///C:/a')],
      settings: DEFAULT_SETTINGS,
      location: () => {
        throw new Error('bad uri')
      }
    })
    expect(c.roots).toEqual([])
    expect(c.allRootUris).toEqual(['file:///C:/a'])
  })
})
