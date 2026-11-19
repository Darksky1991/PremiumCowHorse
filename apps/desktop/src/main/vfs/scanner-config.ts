import { normalizeRootUri } from '@pch/shared'
import type { RootConfig, ScanSettings, ScannerConfig, Settings, WorkspaceEntry } from '@pch/shared'

/**
 * 构造下发给扫描进程的配置（设计 4.5 / 4.9），纯函数：
 * - roots = 活动工作区的 folder 条目；策略 = 条目级 cacheStrategy ?? cache.strategy.<位置>
 * - allRootUris = 所有工作区的 folder 条目 URI（缓存清理只删不属于任何工作区的目录）
 * - indexTargets = 活动工作区的「建立索引」目标
 * 条目 URI 一律经 normalizeRootUri 规范化（旧数据可能带结尾 `/`）。
 */
export function buildScannerConfig(input: {
  /** 当前工作区（多窗口时为各窗口的工作区；现在只有主窗口） */
  activeWorkspaceIds: readonly string[]
  /** 所有工作区的 folder 条目 */
  allFolderEntries: readonly WorkspaceEntry[]
  indexTargets: readonly { workspaceId: string; uri: string }[]
  settings: Settings
  location: (uri: string) => 'local' | 'network'
}): ScannerConfig {
  const { settings } = input
  const active = new Set(input.activeWorkspaceIds)
  const folders = input.allFolderEntries.filter(
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
      strategy: e.cacheStrategy ?? settings[`cache.strategy.${location}`],
      location
    })
  }
  const indexTargets = input.indexTargets
    .filter((t) => active.has(t.workspaceId))
    .map((t) => normalizeRootUri(t.uri))
  return {
    roots,
    allRootUris: [...new Set(folders.map((e) => normalizeRootUri(e.uri)))],
    indexTargets: [...new Set(indexTargets)],
    settings: toScanSettings(settings)
  }
}

/** 设置键 → 调度器使用的设置（设计 4.9） */
export function toScanSettings(s: Settings): ScanSettings {
  return {
    intervalSec: {
      local: s['cache.interval.near.local'],
      network: s['cache.interval.near.network']
    },
    // Task 3 起改用 cache.backgroundGapMs.*；此前保持原来的常量
    backgroundIntervalMin: 10,
    timeoutSec: { local: s['vfs.timeoutSec.local'], network: s['vfs.timeoutSec.network'] },
    activeDepth: s['cache.activeDepth']
  }
}
