import { describe, expect, it } from 'vitest'
import type { WorkspaceEntry } from '@pch/shared'
import { overviewSections, type OverviewSection } from './overview-model'

function entry(
  id: string,
  kind: WorkspaceEntry['kind'],
  sortOrder: number,
  parentId: string | null = null
): WorkspaceEntry {
  return {
    id,
    workspaceId: 'w1',
    parentId,
    kind,
    label: id,
    uri: kind === 'group' ? null : `file:///C:/${id}`,
    sortOrder,
    meta: null,
    cacheStrategy: null,
    createdAt: 0,
    updatedAt: 0
  }
}

/** 分节的简要形式：`分组id(深度): 项…`，子分节缩进在后 */
function brief(sections: OverviewSection[]): string[] {
  return sections.flatMap((s) => [
    `${s.group?.id ?? '-'}(${s.depth}): ${s.items.map((i) => i.id).join(' ')}`,
    ...brief(s.children).map((line) => `  ${line}`)
  ])
}

describe('overviewSections', () => {
  it('未分组的项在最前（无标题），之后是顶层分组；分组内先项后子分组；同层按 sortOrder', () => {
    const sections = overviewSections([
      entry('g2', 'group', 3),
      entry('b', 'folder', 2),
      entry('g1', 'group', 0),
      entry('a', 'file', 1),
      entry('g1x', 'folder', 1, 'g1'),
      entry('g1sub', 'group', 0, 'g1'),
      entry('g1sub-y', 'folder', 0, 'g1sub')
    ])
    expect(brief(sections)).toEqual(['-(0): a b', 'g1(1): g1x', '  g1sub(2): g1sub-y', 'g2(1): '])
  })

  it('没有未分组的项时不产生无标题的分节；没有条目时为空', () => {
    expect(brief(overviewSections([entry('g', 'group', 0), entry('x', 'folder', 0, 'g')]))).toEqual(
      ['g(1): x']
    )
    expect(overviewSections([])).toEqual([])
  })
})
