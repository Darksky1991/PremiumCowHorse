import { describe, expect, it } from 'vitest'
import { MainToScanner, ScannerToMain, type ScannerConfig } from './protocol'

const config: ScannerConfig = {
  roots: [
    {
      entryId: 'e1',
      workspaceId: 'default',
      uri: 'file:///C:/a',
      level: 'default',
      location: 'local'
    }
  ],
  allRootUris: ['file:///C:/a', 'file:///D:/b'],
  indexTargets: [],
  settings: {
    intervalSec: { local: 5, network: 30 },
    backgroundIntervalMin: 10,
    timeoutSec: { local: 5, network: 10 },
    activeDepth: 3
  }
}

/** 每种消息一个合法样例、一个非法样例 */
const mainToScanner: Array<[string, unknown, unknown]> = [
  ['init', { type: 'init', cacheFile: 'C:\\x\\index.db' }, { type: 'init', cacheFile: '' }],
  [
    'configure',
    { type: 'configure', config },
    { type: 'configure', config: { ...config, roots: [{ ...config.roots[0], level: 'max' }] } }
  ],
  ['list', { type: 'list', id: 1, uri: 'file:///C:/a' }, { type: 'list', id: -1, uri: 'x' }],
  [
    'interest',
    { type: 'interest', ownerId: 3, focus: null, visible: ['file:///C:/a'], offscreen: [] },
    { type: 'interest', ownerId: 3, focus: null, visible: ['file:///C:/a'] }
  ],
  [
    'windowFocus',
    { type: 'windowFocus', ownerId: 3, focused: false },
    { type: 'windowFocus', ownerId: 3, focused: 'no' }
  ],
  ['releaseOwner', { type: 'releaseOwner', ownerId: 3 }, { type: 'releaseOwner', ownerId: 1.5 }],
  [
    'refresh',
    { type: 'refresh', uris: ['file:///C:/a'] },
    { type: 'refresh', uris: 'file:///C:/a' }
  ],
  ['cacheInfo', { type: 'cacheInfo', id: 2 }, { type: 'cacheInfo' }],
  ['clearCache', { type: 'clearCache', id: 2 }, { type: 'clearCache', id: '2' }],
  ['cancel', { type: 'cancel', id: 2 }, { type: 'cancel', id: null }],
  ['shutdown', { type: 'shutdown' }, { type: 'shutdown', now: true }]
]

const scannerToMain: Array<[string, unknown, unknown]> = [
  [
    'result ok',
    { type: 'result', id: 1, ok: true, value: { items: [], state: 'fresh', checkedAt: 1 } },
    { type: 'result', id: 1, ok: true, error: { code: 'UNKNOWN' } }
  ],
  [
    'result error',
    { type: 'result', id: 1, ok: false, error: { code: 'INDEX_UNAVAILABLE', detail: 'x' } },
    { type: 'result', id: 1, ok: false, error: { code: 'NOT_A_CODE' } }
  ],
  ['changed', { type: 'changed', uri: 'file:///C:/a' }, { type: 'changed' }],
  [
    'reachability',
    { type: 'reachability', share: '\\\\srv\\share', state: 'offline', since: 1 },
    { type: 'reachability', share: '\\\\srv\\share', state: 'down', since: 1 }
  ],
  [
    'log',
    { type: 'log', level: 'warn', message: 'hello' },
    { type: 'log', level: 'debug', message: 'hello' }
  ],
  ['ready', { type: 'ready' }, { type: 'ready', extra: 1 }]
]

describe('MainToScanner', () => {
  it.each(mainToScanner)('%s: accepts a valid message and rejects an invalid one', (_, ok, bad) => {
    expect(MainToScanner.safeParse(ok).success).toBe(true)
    expect(MainToScanner.safeParse(bad).success).toBe(false)
  })

  it('rejects an unknown message type', () => {
    expect(MainToScanner.safeParse({ type: 'explode' }).success).toBe(false)
  })
})

describe('ScannerToMain', () => {
  it.each(scannerToMain)('%s: accepts a valid message and rejects an invalid one', (_, ok, bad) => {
    expect(ScannerToMain.safeParse(ok).success).toBe(true)
    expect(ScannerToMain.safeParse(bad).success).toBe(false)
  })

  it('rejects a non-object', () => {
    expect(ScannerToMain.safeParse('ready').success).toBe(false)
  })
})
