import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RecentItem, SearchHit, Workspace } from '@pch/shared'
import { useRecent } from '@renderer/data/recent'
import { hasSearchTerms, runSearch } from '@renderer/data/search'
import { useWorkspaces } from '@renderer/data/workspace'
import { queryKeys } from '@renderer/lib/query-keys'
import { matchScore, normalizeForMatch } from '@renderer/lib/text-match'
import { useCommandStore, type Command } from '@renderer/stores/command-store'

/** 命令面板各组的条数与触发条件（D5） */
export const PALETTE_RECENT_LIMIT = 8
export const PALETTE_FILE_LIMIT = 20
export const PALETTE_FILE_MIN_CHARS = 2
export const PALETTE_FILE_DEBOUNCE_MS = 150

export type PaletteItem =
  | { kind: 'recent'; key: string; title: string; description: string; item: RecentItem }
  | { kind: 'workspace'; key: string; title: string; workspace: Workspace }
  | { kind: 'command'; key: string; title: string; shortcut?: string; command: Command }
  | { kind: 'file'; key: string; title: string; description: string; hit: SearchHit }

export interface PaletteGroup {
  id: 'recent' | 'workspaces' | 'commands' | 'files'
  items: PaletteItem[]
}

export interface PaletteInput {
  query: string
  recent: RecentItem[]
  workspaces: Workspace[]
  activeId: string
  commands: Command[]
  files: SearchHit[]
  /**
   * files 是针对哪个查询（已修剪）搜索的；与 query.trim() 不一致（输入后还在防抖 / 搜索往返中）时
   * 不显示文件组——否则首项是旧查询的命中，立即 Enter 会打开与当前输入无关的文件。省略 = 与 query 一致
   */
  filesQuery?: string
  /** 翻译（命令标题与默认工作区名）；纯函数不依赖 i18n 实例 */
  t: (key: string) => string
}

/** 按得分降序（得分相同保持原顺序），去掉不匹配项 */
function filterSorted<T>(
  items: T[],
  query: string,
  score: (item: T, query: string) => number | null
): T[] {
  if (normalizeForMatch(query).trim() === '') return items
  return items
    .map((item, index) => ({ item, index, s: score(item, query) }))
    .filter((x): x is { item: T; index: number; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.index - b.index)
    .map((x) => x.item)
}

/**
 * 命令面板的内容（纯函数）：最近使用 / 工作区（不含当前）/ 命令 / 文件（查询 ≥ 2 个字符才有，最多 20 条）。
 * 没有内容的组不出现。文件由主进程按名称筛选（已是搜索结果），这里只截取条数
 */
export function buildPaletteGroups(input: PaletteInput): PaletteGroup[] {
  const { query, recent, workspaces, activeId, commands, files, filesQuery, t } = input
  const groups: PaletteGroup[] = []

  const recentItems = filterSorted(recent, query, (r, q) => matchScore(q, r.title, r.uri)).map(
    (item): PaletteItem => ({
      kind: 'recent',
      key: `recent:${item.uri}`,
      title: item.title,
      description: item.uri,
      item
    })
  )
  if (recentItems.length > 0) groups.push({ id: 'recent', items: recentItems })

  const nameOf = (w: Workspace): string => (w.name === '' ? t('common:defaultWorkspace') : w.name)
  const workspaceItems = filterSorted(
    workspaces.filter((w) => w.id !== activeId && !w.archived),
    query,
    (w, q) => matchScore(q, nameOf(w), w.description)
  ).map((workspace): PaletteItem => ({
    kind: 'workspace',
    key: `workspace:${workspace.id}`,
    title: nameOf(workspace),
    workspace
  }))
  if (workspaceItems.length > 0) groups.push({ id: 'workspaces', items: workspaceItems })

  // 说明用命令 id（如 settings.open），英文关键词在界面语言为日语 / 中文时也能命中
  const commandItems = filterSorted(
    commands
      .filter((c) => c.hidden !== true && c.when?.() !== false)
      .map((command) => ({ command, title: t(command.titleKey) })),
    query,
    (c, q) => matchScore(q, c.title, c.command.id)
  ).map(({ command, title }): PaletteItem => ({
    kind: 'command',
    key: `command:${command.id}`,
    title,
    ...(command.shortcut === undefined ? {} : { shortcut: command.shortcut }),
    command
  }))
  if (commandItems.length > 0) groups.push({ id: 'commands', items: commandItems })

  const filesFresh = filesQuery === undefined || filesQuery === query.trim()
  if (filesFresh && [...query.trim()].length >= PALETTE_FILE_MIN_CHARS && files.length > 0) {
    groups.push({
      id: 'files',
      items: files.slice(0, PALETTE_FILE_LIMIT).map((hit): PaletteItem => ({
        kind: 'file',
        key: `file:${hit.uri}`,
        title: hit.name,
        description: hit.relativePath,
        hit
      }))
    })
  }
  return groups
}

/** value 停止变化 ms 毫秒后才更新 */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/** 面板打开期间的数据：最近使用 / 工作区 / 命令注册表 / 防抖后的文件搜索，组合成分组 */
export function usePaletteItems(
  query: string,
  activeId: string | undefined,
  t: (key: string) => string
): PaletteGroup[] {
  const { data: recent } = useRecent(activeId, PALETTE_RECENT_LIMIT)
  const { data: workspaces } = useWorkspaces()
  const entries = useCommandStore((s) => s.entries)

  const debounced = useDebounced(query.trim(), PALETTE_FILE_DEBOUNCE_MS)
  const searchable =
    activeId !== undefined &&
    [...debounced].length >= PALETTE_FILE_MIN_CHARS &&
    hasSearchTerms(debounced)
  const { data: found } = useQuery({
    queryKey: queryKeys.paletteFiles(activeId ?? '', debounced),
    queryFn: ({ signal }) =>
      runSearch(
        { workspaceId: activeId!, text: debounced, kind: 'all', limit: PALETTE_FILE_LIMIT },
        signal
      ),
    enabled: searchable,
    staleTime: 0
  })
  // 结果只属于 debounced 这个查询（key 含它，不沿用上一次的结果）；buildPaletteGroups 在与当前输入不一致时不显示
  const files = searchable ? (found?.items ?? []) : []

  return useMemo(
    () =>
      buildPaletteGroups({
        query,
        recent: recent ?? [],
        workspaces: workspaces ?? [],
        activeId: activeId ?? '',
        commands: useCommandStore.getState().commands(),
        files,
        filesQuery: debounced,
        t
      }),
    // entries 变化 = 命令注册表变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, recent, workspaces, activeId, entries, files, debounced, t]
  )
}
