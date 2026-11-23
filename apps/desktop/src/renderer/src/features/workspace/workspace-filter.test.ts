import { describe, expect, it } from 'vitest'
import { filterWorkspaces } from './workspace-filter'

const items = [
  { id: 'a', name: '物流WMS', description: null },
  { id: 'b', name: '夜間ばっち監視', description: null },
  { id: 'c', name: 'バッチ移行', description: null },
  { id: 'd', name: '共通', description: 'バッチ以外' }
]

describe('filterWorkspaces', () => {
  it('keeps the original order and points at the best match (prefix > contains > description)', () => {
    const r = filterWorkspaces(items, 'バッチ')
    expect(r.matches.map((w) => w.id)).toEqual(['b', 'c', 'd'])
    expect(r.matches[r.best]?.id).toBe('c')
    // 同分取靠前者
    const tie = filterWorkspaces(items, '監視')
    expect(tie.matches[tie.best]?.id).toBe('b')
  })

  it('has no best match for an empty or blank query (everything matches)', () => {
    for (const q of ['', '   ']) {
      const r = filterWorkspaces(items, q)
      expect(r.matches).toHaveLength(4)
      expect(r.best).toBe(-1)
    }
  })

  it('returns no matches and best -1 when nothing matches', () => {
    expect(filterWorkspaces(items, 'xyz')).toEqual({ matches: [], best: -1 })
  })
})
