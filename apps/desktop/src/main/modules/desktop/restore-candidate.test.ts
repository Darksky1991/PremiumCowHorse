import { describe, expect, it } from 'vitest'
import type {
  DesktopItem,
  DesktopSnapshot,
  DesktopSnapshotKind,
  DesktopSnapshotSummary
} from '@pch/shared'
import { itemsToOffer, pickRestoreCandidate } from './restore-candidate'

const snap = (
  id: number,
  kind: DesktopSnapshotKind,
  logonAt: number,
  createdAt: number
): DesktopSnapshotSummary => ({ id, kind, createdAt, logonAt, name: null, itemCount: 0 })

describe('pickRestoreCandidate', () => {
  it('上次登录以 exit 结束 → exit', () => {
    const list = [snap(1, 'auto', 100, 110), snap(2, 'exit', 100, 200)]
    expect(pickRestoreCandidate(list, 300)).toEqual({ snapshotId: 2 })
  })
  it('以 exit-none 结束 → null', () => {
    const list = [snap(1, 'auto', 100, 110), snap(2, 'exit-none', 100, 200)]
    expect(pickRestoreCandidate(list, 300)).toBeNull()
  })
  it('exit 之后同一登录又有 auto → auto', () => {
    const list = [snap(1, 'exit', 100, 200), snap(2, 'auto', 100, 250)]
    expect(pickRestoreCandidate(list, 300)).toEqual({ snapshotId: 2 })
  })
  it('只有 manual → null；manual 不影响判断', () => {
    expect(pickRestoreCandidate([snap(1, 'manual', 100, 200)], 300)).toBeNull()
    const list = [snap(1, 'exit', 100, 200), snap(2, 'manual', 100, 250)]
    expect(pickRestoreCandidate(list, 300)).toEqual({ snapshotId: 1 })
  })
  it('当前登录已有快照 → null', () => {
    const list = [snap(1, 'exit', 100, 200), snap(2, 'auto', 300, 310)]
    expect(pickRestoreCandidate(list, 300)).toBeNull()
  })
  it('没有更早的登录 → null', () => {
    expect(pickRestoreCandidate([], 300)).toBeNull()
    expect(pickRestoreCandidate([snap(1, 'auto', 400, 410)], 300)).toBeNull()
  })
  it('取 logon_at 小于当前的最大一次登录', () => {
    const list = [snap(1, 'exit', 50, 60), snap(2, 'auto', 100, 110)]
    expect(pickRestoreCandidate(list, 300)).toEqual({ snapshotId: 2 })
  })
  it('createdAt 相同时取 id 较大者', () => {
    const list = [snap(5, 'auto', 100, 200), snap(7, 'exit', 100, 200), snap(6, 'auto', 100, 200)]
    expect(pickRestoreCandidate(list, 300)).toEqual({ snapshotId: 7 })
  })
})

describe('itemsToOffer', () => {
  const items: DesktopItem[] = [
    { kind: 'office', app: 'word', path: 'C:\\A.docx', readOnly: false, exe: 'WINWORD.EXE' },
    { kind: 'office', app: 'excel', path: 'C:\\B.xlsx', readOnly: false, exe: 'EXCEL.EXE' },
    { kind: 'vscode', target: 'C:\\P', exe: 'Code.exe', bounds: null },
    { kind: 'vscode', target: 'C:\\Q', exe: 'Code.exe', bounds: null },
    { kind: 'explorer', tabs: ['C:\\X', 'C:\\Y'], bounds: null },
    { kind: 'explorer', tabs: ['C:\\Z', 'C:\\W'], bounds: null },
    { kind: 'eclipse', workspace: 'C:\\ws', exe: 'eclipse.exe', bounds: null }
  ]
  const snapshot: DesktopSnapshot = {
    ...snap(1, 'exit', 1, 2),
    itemCount: items.length,
    items: items.map((item, i) => ({ id: i + 1, item }))
  }

  it('滤掉已开着的 Office / VS Code / Explorer（第一个标签已开着）', () => {
    const open = new Set([
      'office:c:\\a.docx',
      'vscode:c:\\p',
      'explorer-tab:c:\\x',
      'explorer-tab:c:\\w' // 非第一个标签：不算
    ])
    expect(itemsToOffer(snapshot, open).map((i) => i.id)).toEqual([2, 4, 6, 7])
  })
  it('什么都没开着时全部提供', () => {
    expect(itemsToOffer(snapshot, new Set())).toHaveLength(7)
  })
})
