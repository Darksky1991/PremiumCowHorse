import type { RootConfig, ScanSettings, ScannerConfig, Settings, WorkspaceEntry } from '@pch/shared'

/**
 * 下发给扫描进程的最小配置（Task 6）：参与调度的根 = 当前工作区的全部 folder 条目，级别一律取
 * 全局默认 refresh.defaultLevel.<位置>；不建立索引。条目级的级别与「建立索引」随 Task 7 加入，
 * 届时由 buildScannerConfig 取代本函数。
 */
export function minimalScannerConfig(input: {
  /** 当前工作区（多窗口时为各窗口的工作区；现在只有主窗口） */
  activeWorkspaceIds: readonly string[]
  /** 所有工作区的条目 */
  entries: readonly WorkspaceEntry[]
  settings: Settings
  location: (uri: string) => 'local' | 'network'
}): ScannerConfig {
  const { settings } = input
  const active = new Set(input.activeWorkspaceIds)
  const folders = input.entries.filter(
    (e): e is WorkspaceEntry & { uri: string } => e.kind === 'folder' && e.uri !== null
  )
  const roots: RootConfig[] = []
  for (const e of folders) {
    if (!active.has(e.workspaceId)) continue
    const uri = normalizeRootUri(e.uri)
    let location: 'local' | 'network'
    try {
      location = input.location(uri)
    } catch {
      // 无法解析的 URI：扫描进程也会滤掉，这里不下发
      continue
    }
    roots.push({
      entryId: e.id,
      workspaceId: e.workspaceId,
      uri,
      level: settings[`refresh.defaultLevel.${location}`],
      location
    })
  }
  return {
    roots,
    allRootUris: [...new Set(folders.map((e) => normalizeRootUri(e.uri)))],
    indexTargets: [],
    settings: toScanSettings(settings)
  }
}

/** 设置键 → 调度器使用的设置（设计 4.9） */
export function toScanSettings(s: Settings): ScanSettings {
  return {
    intervalSec: {
      local: s['refresh.intervalSec.local'],
      network: s['refresh.intervalSec.network']
    },
    backgroundIntervalMin: s['refresh.backgroundIntervalMin'],
    timeoutSec: { local: s['vfs.timeoutSec.local'], network: s['vfs.timeoutSec.network'] },
    activeDepth: s['refresh.activeDepth']
  }
}

/**
 * 根 URI 规范化：除驱动器根（`file:///C:/`）外不带结尾 `/`。缓存的 isUnder 以「根 + /」
 * 作前缀判断子目录，结尾多一个 `/` 会让子目录都不在根之下。
 */
export function normalizeRootUri(uri: string): string {
  const trimmed = uri.replace(/\/+$/, '')
  return /^file:\/\/\/[A-Za-z]:$/.test(trimmed) ? `${trimmed}/` : trimmed
}
