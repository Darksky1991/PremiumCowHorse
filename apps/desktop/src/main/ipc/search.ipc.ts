import {
  SEARCH_LIMIT_MAX,
  SEARCH_TOTAL_CAP,
  matchesName,
  parseQuery,
  type SearchHit,
  type SearchResult,
  type SearchScope
} from '@pch/shared'
import type { SettingsService } from '../modules/settings/settings.service'
import type { WorkspaceService } from '../modules/workspace/workspace.service'
import type { ScannerClient } from '../vfs/scanner-client'
import type { HandlersOf } from './router'

export type SearchScannerApi = Pick<ScannerClient, 'search' | 'cancelSearch'>

/** file URI 的最后一段（已解码）。只做字符串处理，不访问文件系统 */
function fileNameOf(uri: string): string {
  const last = uri.slice(uri.lastIndexOf('/') + 1)
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/**
 * 搜索：scopes 由工作区的 folder 条目组装，由扫描进程在缓存中查询；固定的单个文件条目
 * 在这里按名称匹配（与扫描进程同一份 parseQuery / matchesName），排在结果最前面。
 * 只读缓存：文件条目没有缓存的 size / mtime，命中项记为 0。
 */
export function searchHandlers(
  workspaces: Pick<WorkspaceService, 'listEntries'>,
  settings: Pick<SettingsService, 'get'>,
  scanner: SearchScannerApi
): HandlersOf<'search.query'> {
  return {
    'search.query': async ({ workspaceId, text, kind, limit, requestId }) => {
      const { terms } = parseQuery(text)
      if (terms.length === 0) {
        scanner.cancelSearch(requestId)
        return { items: [], total: 0, truncated: false, indexedAt: null, incomplete: false }
      }
      const max = limit ?? SEARCH_LIMIT_MAX
      const entries = await workspaces.listEntries(workspaceId)

      const scopes: SearchScope[] = []
      const fileHits: SearchHit[] = []
      const seenFiles = new Set<string>()
      for (const e of entries) {
        if (e.uri === null) continue
        if (e.kind === 'folder') {
          scopes.push({ uri: e.uri, entryId: e.id, label: e.label })
        } else if (e.kind === 'file' && kind !== 'directory' && !seenFiles.has(e.uri)) {
          const name = fileNameOf(e.uri)
          if (!matchesName(name, terms)) continue
          seenFiles.add(e.uri)
          fileHits.push({
            uri: e.uri,
            name,
            kind: 'file',
            size: 0,
            mtime: 0,
            hidden: false,
            entryId: e.id,
            relativePath: ''
          })
        }
      }

      let scanned: SearchResult = {
        items: [],
        total: 0,
        truncated: false,
        indexedAt: null,
        incomplete: false
      }
      if (scopes.length > 0) {
        scanned = await scanner.search(
          {
            scopes,
            terms,
            kind,
            showHidden: settings.get('explorer.showHiddenFiles'),
            limit: max
          },
          requestId
        )
      } else {
        scanner.cancelSearch(requestId)
      }

      // 固定的文件同时位于已扫描的文件夹之下时，只保留固定条目的那一行
      const items = [...fileHits, ...scanned.items.filter((i) => !seenFiles.has(i.uri))].slice(
        0,
        max
      )
      const dup = scanned.items.length - scanned.items.filter((i) => !seenFiles.has(i.uri)).length
      const total = Math.min(SEARCH_TOTAL_CAP, scanned.total - dup + fileHits.length)
      return {
        items,
        total,
        truncated: total > items.length,
        indexedAt: scanned.indexedAt,
        incomplete: scanned.incomplete
      }
    }
  }
}
