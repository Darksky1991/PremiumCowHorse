import { describe, expect, it } from 'vitest'
import type { RecentItem, SearchHit, Workspace } from '@pch/shared'
import type { Command } from '@renderer/stores/command-store'
import { buildPaletteGroups, type PaletteInput } from './use-palette-items'

const titles: Record<string, string> = {
  'commands:settingsOpen': '設定を開く',
  'commands:aboutOpen': 'このアプリについてを開く',
  'commands:viewSearch': '検索を開く',
  'commands:paletteOpen': 'コマンドパレットを開く',
  'common:defaultWorkspace': '既定'
}
const t = (key: string): string => titles[key] ?? key

const command = (id: string, titleKey: string, extra: Partial<Command> = {}): Command => ({
  id,
  titleKey,
  group: 'general',
  run: () => undefined,
  ...extra
})
const commands: Command[] = [
  command('about.open', 'commands:aboutOpen'),
  command('view.search', 'commands:viewSearch'),
  command('settings.open', 'commands:settingsOpen', { shortcut: 'Ctrl+,' }),
  command('palette.openAlt', 'commands:paletteOpen', { hidden: true }),
  command('tab.close', 'tab.close', { when: () => false })
]

const ws = (id: string, name: string): Workspace => ({
  id,
  name,
  description: null,
  color: null,
  sortOrder: 0,
  archived: false,
  lastOpenedAt: null,
  createdAt: 0,
  updatedAt: 0
})
const workspaces = [ws('w1', 'WMS 保守'), ws('w2', '経理')]
const recent: RecentItem[] = [
  { uri: 'file:///a/設計書.xlsx', kind: 'file', title: '設計書.xlsx', openedAt: 2 }
]
const hit = (n: number): SearchHit => ({
  uri: `file:///f/${n}`,
  name: `file-${n}.txt`,
  kind: 'file',
  size: 1,
  mtime: 1,
  hidden: false,
  entryId: 'e',
  relativePath: `f/file-${n}.txt`
})
const base: PaletteInput = {
  query: '',
  recent,
  workspaces,
  activeId: 'w1',
  commands,
  files: [],
  t
}
const ids = (input: PaletteInput): string[] => buildPaletteGroups(input).map((g) => g.id)

describe('buildPaletteGroups', () => {
  it('empty query: recent / workspaces / commands, no files, active workspace excluded', () => {
    const groups = buildPaletteGroups({ ...base, files: [hit(1)] })
    expect(groups.map((g) => g.id)).toEqual(['recent', 'workspaces', 'commands'])
    const names = groups.find((g) => g.id === 'workspaces')!.items.map((i) => i.title)
    expect(names).toEqual(['経理'])
  })

  it('hides hidden commands and commands whose when() is false', () => {
    const items = buildPaletteGroups(base).find((g) => g.id === 'commands')!.items
    expect(items.map((i) => i.key)).toEqual([
      'command:about.open',
      'command:view.search',
      'command:settings.open'
    ])
  })

  it('query "set" ranks the settings command first', () => {
    const items = buildPaletteGroups({ ...base, query: 'set' }).find((g) => g.id === 'commands')!
    expect(items.items[0]?.title).toBe('設定を開く')
    expect(items.items).toHaveLength(1)
  })

  it('matches Japanese titles after hiragana / katakana folding', () => {
    const q = buildPaletteGroups({ ...base, query: 'このあぷり' }).find((g) => g.id === 'commands')
    expect(q?.items[0]?.title).toBe('このアプリについてを開く')
  })

  it('omits groups with no match', () => {
    expect(ids({ ...base, query: '経理' })).toEqual(['workspaces'])
  })

  it('files need at least 2 characters and are capped at 20', () => {
    const files = Array.from({ length: 30 }, (_, i) => hit(i))
    expect(ids({ ...base, query: 'f', files })).not.toContain('files')
    const groups = buildPaletteGroups({ ...base, query: 'fi', files })
    const group = groups.find((g) => g.id === 'files')!
    expect(group.items).toHaveLength(20)
    expect(groups[groups.length - 1]?.id).toBe('files')
  })
})
