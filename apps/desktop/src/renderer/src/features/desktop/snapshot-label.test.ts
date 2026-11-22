import { describe, expect, it } from 'vitest'
import type { DesktopSnapshotSummary } from '@pch/shared'
import { isBeforeRestart, kindKey, skippedByReason } from './snapshot-label'

function snap(id: number, logonAt: number): DesktopSnapshotSummary {
  return { id, kind: 'auto', createdAt: logonAt + 1, logonAt, name: null, itemCount: 1 }
}

describe('kindKey', () => {
  it('exit-none 转为驼峰键', () => {
    expect(kindKey('exit-none')).toBe('kind.exitNone')
    expect(kindKey('manual')).toBe('kind.manual')
  })
})

describe('「重启前」', () => {
  it('logonAt 与本次登录不同的快照带标记', () => {
    const list = [snap(3, 300), snap(2, 300), snap(1, 100)]
    expect(list.map((s) => isBeforeRestart(s, 300))).toEqual([false, false, true])
  })

  it('尚未取得本次登录时刻时没有标记', () => {
    expect(isBeforeRestart(snap(1, 100), null)).toBe(false)
  })
})

describe('skippedByReason', () => {
  it('按原因计数，只含出现过的原因，顺序固定', () => {
    const result = {
      launched: 2,
      skipped: [
        { itemId: 1, reason: 'failed' as const },
        { itemId: 2, reason: 'open' as const },
        { itemId: 3, reason: 'failed' as const }
      ]
    }
    expect(skippedByReason(result)).toEqual([
      { reason: 'open', count: 1 },
      { reason: 'failed', count: 2 }
    ])
    expect(skippedByReason({ launched: 1, skipped: [] })).toEqual([])
  })
})
