import { formatSftpUri, parseSftpUri, type ConnectionDto, type WorkspaceEntry } from '@pch/shared'
import type { TreeNode } from './tree-model'

/** 「以属主身份添加为条目」的内容：新条目的 URI、所在分组与标签 */
export interface OwnerSwitch {
  owner: string
  uri: string
  /** 包含该目录的条目所在的父分组（null 为工作区根部） */
  parentId: string | null
  /** 默认标签：路径最后一段（根为 /） */
  label: string
}

/**
 * 无权限的远程目录（设计 devDoc/2026-11-22-37 第 5.8 节）：状态行为 FS_PERMISSION_DENIED、节点为 sftp、
 * 列表给出的属主在该连接登记的身份中，且与当前身份（URI 的 userinfo；登录用户为 null）、登录用户名都不同时，
 * 给出以属主身份读取同一路径的新条目。不自动切换身份（审计上要能说清谁用 sudo 读了什么）。
 * 不满足任何一条时为 null
 */
export function ownerSwitchFor(
  node: TreeNode,
  entries: readonly WorkspaceEntry[],
  connections: readonly ConnectionDto[] | undefined
): OwnerSwitch | null {
  if (node.status !== 'error' || node.errorCode !== 'FS_PERMISSION_DENIED') return null
  const owner = node.owner
  if (owner === undefined || node.uri === null) return null
  const loc = parseSftpUri(node.uri)
  if (loc === null) return null
  const connection = connections?.find((c) => c.id === loc.connectionId)
  if (connection === undefined) return null
  if (!connection.identities.includes(owner)) return null
  if (owner === loc.identity || owner === connection.username) return null
  const entry = entries.find((e) => e.id === node.entryId)
  return {
    owner,
    uri: formatSftpUri({ connectionId: loc.connectionId, identity: owner, path: loc.path }),
    parentId: entry?.parentId ?? null,
    label: loc.path === '/' ? '/' : loc.path.slice(loc.path.lastIndexOf('/') + 1)
  }
}
