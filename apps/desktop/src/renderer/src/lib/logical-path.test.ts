import { describe, expect, it } from 'vitest'
import { aboutLocation, settingsLocation, type TabLocation, type WorkspaceEntry } from '@pch/shared'
import { entryOf, logicalPath, parentLocation, type LogicalPathContext } from './logical-path'

/** 案件 = %E6%A1%88%E4%BB%B6、設計書 = %E8%A8%AD%E8%A8%88%E6%9B%B8 */
const ANKEN = 'file:///C:/%E6%A1%88%E4%BB%B6'
const SEKKEI = `${ANKEN}/%E8%A8%AD%E8%A8%88%E6%9B%B8`

let seq = 0
function entry(
  kind: WorkspaceEntry['kind'],
  label: string,
  uri: string | null,
  parentId: string | null = null
): WorkspaceEntry {
  return {
    id: `e${++seq}`,
    workspaceId: 'w1',
    parentId,
    kind,
    label,
    uri,
    sortOrder: seq,
    meta: null,
    cacheStrategy: null,
    createdAt: 0,
    updatedAt: 0
  }
}

const group = entry('group', '分组', null)
const ctx: LogicalPathContext = {
  workspace: { id: 'w1', name: '保守' },
  workspacesTitle: 'ワークスペース一覧',
  settingsTitle: '設定',
  aboutTitle: 'このアプリについて',
  entries: [
    group,
    // 放在分组之下：分组不出现在逻辑路径中
    entry('folder', '案件（別名）', ANKEN, group.id),
    entry('folder', 'D ドライブ', 'file:///D:/'),
    entry('folder', '共有', 'file://srv/share/docs'),
    entry('file', '手順書', 'file:///E:/manual/%E6%89%8B%E9%A0%86.docx')
  ]
}

const dir = (uri: string, title: string): TabLocation => ({ uri, kind: 'directory', title })
const file = (uri: string, title: string): TabLocation => ({ uri, kind: 'file', title })
const OVERVIEW: TabLocation = { uri: 'pch-workspace:w1', kind: 'workspace', title: '保守' }
const WORKSPACES: TabLocation = {
  uri: 'pch-workspaces:',
  kind: 'workspaces',
  title: 'ワークスペース一覧'
}

/** 段的简要形式：`种类:标签`（用于断言整个路径） */
const brief = (loc: TabLocation): string[] =>
  logicalPath(loc, ctx).map((s) => `${s.kind}:${s.label}`)

describe('logicalPath', () => {
  it('桌面记录：只有一段（标签为位置标题，不含工作区段），上一级为 null，不属于任何条目', () => {
    const loc: TabLocation = { uri: 'pch-desktop:3', kind: 'desktop', title: '2026-11-21 10:00' }
    expect(logicalPath(loc, ctx)).toEqual([
      { label: '2026-11-21 10:00', kind: 'desktop', target: loc }
    ])
    expect(parentLocation(loc, ctx)).toBeNull()
    expect(entryOf(loc, ctx.entries)).toBeNull()
  })

  it('设置页 / 关于页：只有一段（标签为 ctx 中本地化的名称，不用标签标题的快照），上一级为 null，不属于任何条目', () => {
    const cases = [
      { loc: settingsLocation('旧標題'), label: '設定' },
      { loc: aboutLocation('旧標題'), label: 'このアプリについて' }
    ]
    for (const { loc, label } of cases) {
      expect(logicalPath(loc, ctx)).toEqual([{ label, kind: loc.kind, target: loc }])
      expect(parentLocation(loc, ctx)).toBeNull()
      expect(entryOf(loc, ctx.entries)).toBeNull()
    }
  })

  it('工作区总览：只有工作区一段，目标为总览', () => {
    expect(logicalPath(OVERVIEW, ctx)).toEqual([
      { label: '保守', kind: 'workspace', target: OVERVIEW }
    ])
  })

  it('工作区一览：只有一览一段（标签为本地化的「工作区一览」），普通位置的路径不含这一段', () => {
    expect(logicalPath({ ...WORKSPACES, title: '旧标题' }, ctx)).toEqual([
      { label: 'ワークスペース一覧', kind: 'workspaces', target: WORKSPACES }
    ])
    expect(brief(OVERVIEW)).toEqual(['workspace:保守'])
    expect(brief(dir(SEKKEI, '設計書'))[0]).toBe('workspace:保守')
  })

  it('条目内的目录：工作区 › 条目别名 › 相对路径各段（分组不出现，各段 URI 由原编码拼接）', () => {
    const segments = logicalPath(dir(`${SEKKEI}/v1`, 'v1'), ctx)
    expect(segments).toEqual([
      { label: '保守', kind: 'workspace', target: OVERVIEW },
      { label: '案件（別名）', kind: 'entry', target: dir(ANKEN, '案件（別名）') },
      { label: '設計書', kind: 'dir', target: dir(SEKKEI, '設計書') },
      { label: 'v1', kind: 'dir', target: dir(`${SEKKEI}/v1`, 'v1') }
    ])
  })

  it('条目根：最后一段是条目（别名）', () => {
    expect(brief(dir(ANKEN, '案件'))).toEqual(['workspace:保守', 'entry:案件（別名）'])
  })

  it('条目内的文件：最后一段为文件名', () => {
    const segments = logicalPath(file(`${SEKKEI}/memo.txt`, 'memo.txt'), ctx)
    expect(segments.map((s) => `${s.kind}:${s.label}`)).toEqual([
      'workspace:保守',
      'entry:案件（別名）',
      'dir:設計書',
      'file:memo.txt'
    ])
    expect(segments.at(-1)!.target).toEqual(file(`${SEKKEI}/memo.txt`, 'memo.txt'))
  })

  it('驱动器根条目（file:///D:/）：相对路径从驱动器之下开始', () => {
    const segments = logicalPath(dir('file:///D:/logs/2026', '2026'), ctx)
    expect(segments.map((s) => `${s.kind}:${s.label}`)).toEqual([
      'workspace:保守',
      'entry:D ドライブ',
      'dir:logs',
      'dir:2026'
    ])
    expect(segments[1]!.target).toEqual(dir('file:///D:/', 'D ドライブ'))
    expect(segments[2]!.target).toEqual(dir('file:///D:/logs', 'logs'))
  })

  it('UNC 条目：相对路径从条目根之下开始', () => {
    const segments = logicalPath(dir('file://srv/share/docs/a/b', 'b'), ctx)
    expect(segments.map((s) => `${s.kind}:${s.label}`)).toEqual([
      'workspace:保守',
      'entry:共有',
      'dir:a',
      'dir:b'
    ])
    expect(segments[2]!.target.uri).toBe('file://srv/share/docs/a')
  })

  it('file 条目：工作区 › 条目别名（目标为文件）', () => {
    const uri = 'file:///E:/manual/%E6%89%8B%E9%A0%86.docx'
    expect(logicalPath(file(uri, '手順.docx'), ctx)).toEqual([
      { label: '保守', kind: 'workspace', target: OVERVIEW },
      { label: '手順書', kind: 'entry', target: file(uri, '手順書') }
    ])
  })

  it('嵌套的 folder 条目：取包含它的条目中最内层者', () => {
    const nested: LogicalPathContext = {
      ...ctx,
      entries: [...ctx.entries, entry('folder', '設計', SEKKEI)]
    }
    expect(logicalPath(dir(`${SEKKEI}/v1`, 'v1'), nested).map((s) => s.label)).toEqual([
      '保守',
      '設計',
      'v1'
    ])
  })

  it('条目之外的目录：工作区 › 驱动器 › 绝对路径各段（前缀相同但不是子目录的不算在条目内）', () => {
    const segments = logicalPath(dir('file:///C:/%E6%A1%88%E4%BB%B6x/y', 'y'), ctx)
    expect(segments.map((s) => `${s.kind}:${s.label}`)).toEqual([
      'workspace:保守',
      'dir:C:',
      'dir:案件x',
      'dir:y'
    ])
    expect(segments[1]!.target).toEqual(dir('file:///C:/', 'C:'))
  })

  it('条目之外的 UNC 目录：从共享（\\\\host\\share）开始', () => {
    expect(brief(dir('file://srv/other/x', 'x'))).toEqual([
      'workspace:保守',
      'dir:\\\\srv\\other',
      'dir:x'
    ])
  })

  it('条目之外的文件：最后一段为文件', () => {
    expect(brief(file('file:///F:/a.txt', 'a.txt'))).toEqual([
      'workspace:保守',
      'dir:F:',
      'file:a.txt'
    ])
  })

  it('不是 file URI：工作区之后只有一段（URI 本身）', () => {
    expect(brief(dir('sftp://h/x', 'x'))).toEqual(['workspace:保守', 'dir:sftp://h/x'])
  })
})

describe('parentLocation', () => {
  it('条目内：相对路径逐级向上', () => {
    expect(parentLocation(dir(`${SEKKEI}/v1`, 'v1'), ctx)).toEqual(dir(SEKKEI, '設計書'))
    // 上一级是条目根：标题为别名
    expect(parentLocation(dir(SEKKEI, '設計書'), ctx)).toEqual(dir(ANKEN, '案件（別名）'))
    expect(parentLocation(file(`${ANKEN}/memo.txt`, 'memo.txt'), ctx)).toEqual(
      dir(ANKEN, '案件（別名）')
    )
  })

  it('条目根的上一级是工作区总览（不越过条目根走到磁盘上的上级）', () => {
    expect(parentLocation(dir(ANKEN, '案件'), ctx)).toEqual(OVERVIEW)
    expect(parentLocation(dir('file:///D:/', 'D:'), ctx)).toEqual(OVERVIEW)
    expect(parentLocation(dir('file://srv/share/docs', 'docs'), ctx)).toEqual(OVERVIEW)
  })

  it('file 条目的上一级是工作区总览', () => {
    const uri = 'file:///E:/manual/%E6%89%8B%E9%A0%86.docx'
    expect(parentLocation(file(uri, '手順.docx'), ctx)).toEqual(OVERVIEW)
  })

  it('工作区总览的上一级是工作区一览；一览没有上一级', () => {
    expect(parentLocation(OVERVIEW, ctx)).toEqual(WORKSPACES)
    expect(parentLocation(WORKSPACES, ctx)).toBeNull()
  })

  it('条目之外：退化为磁盘上的上级；驱动器 / 共享根的上一级是工作区总览', () => {
    expect(parentLocation(dir('file:///C:/a/b', 'b'), ctx)).toEqual(dir('file:///C:/a', 'a'))
    expect(parentLocation(dir('file:///C:/a', 'a'), ctx)).toEqual(dir('file:///C:/', 'C:'))
    expect(parentLocation(dir('file:///C:/', 'C:'), ctx)).toEqual(OVERVIEW)
    expect(parentLocation(dir('file://srv/other/x', 'x'), ctx)).toEqual(
      dir('file://srv/other', '\\\\srv\\other')
    )
  })
})
