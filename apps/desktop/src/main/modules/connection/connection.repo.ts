import type { ConnectionAuthKind, ConnectionAuthState, HostKeyInfo } from '@pch/shared'
import type { Database } from '../../infra/db/client'
import type { ConnectionsTable } from '../../infra/db/schema'

export interface ConnectionRecord {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: ConnectionAuthKind
  keyPath: string | null
  secret: string | null
  sudoSecret: string | null // 加密后的值
  identities: string[]
  hostKey: HostKeyInfo | null
  sftpServerPath: string | null
  authState: ConnectionAuthState
  createdAt: number
  updatedAt: number
}

function parseOptions(json: string): { sftpServerPath: string | null } {
  try {
    const v = JSON.parse(json) as { sftpServerPath?: unknown }
    return { sftpServerPath: typeof v.sftpServerPath === 'string' ? v.sftpServerPath : null }
  } catch {
    return { sftpServerPath: null }
  }
}

function parseIdentities(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function parseHostKey(json: string | null): HostKeyInfo | null {
  if (json === null) return null
  try {
    return JSON.parse(json) as HostKeyInfo
  } catch {
    return null
  }
}

function fromRow(row: ConnectionsTable): ConnectionRecord {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    auth: row.auth as ConnectionAuthKind,
    keyPath: row.key_path,
    secret: row.secret,
    sudoSecret: row.sudo_secret,
    identities: parseIdentities(row.identities),
    hostKey: parseHostKey(row.host_key),
    sftpServerPath: parseOptions(row.options).sftpServerPath,
    authState: row.auth_state as ConnectionAuthState,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toRow(r: ConnectionRecord): ConnectionsTable {
  return {
    id: r.id,
    name: r.name,
    host: r.host,
    port: r.port,
    username: r.username,
    auth: r.auth,
    key_path: r.keyPath,
    secret: r.secret,
    sudo_secret: r.sudoSecret,
    identities: JSON.stringify(r.identities),
    host_key: r.hostKey === null ? null : JSON.stringify(r.hostKey),
    options: JSON.stringify({ sftpServerPath: r.sftpServerPath }),
    auth_state: r.authState,
    created_at: r.createdAt,
    updated_at: r.updatedAt
  }
}

export class ConnectionRepo {
  constructor(private readonly db: Database) {}

  async list(): Promise<ConnectionRecord[]> {
    const rows = await this.db
      .selectFrom('connections')
      .selectAll()
      .orderBy('created_at')
      .orderBy('id')
      .execute()
    return rows.map(fromRow)
  }

  async get(id: string): Promise<ConnectionRecord | undefined> {
    const row = await this.db
      .selectFrom('connections')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? fromRow(row) : undefined
  }

  async insert(r: ConnectionRecord): Promise<void> {
    await this.db.insertInto('connections').values(toRow(r)).execute()
  }

  async update(
    id: string,
    patch: Partial<Omit<ConnectionRecord, 'id' | 'createdAt'>>
  ): Promise<void> {
    const set: Partial<ConnectionsTable> = {}
    if (patch.name !== undefined) set.name = patch.name
    if (patch.host !== undefined) set.host = patch.host
    if (patch.port !== undefined) set.port = patch.port
    if (patch.username !== undefined) set.username = patch.username
    if (patch.auth !== undefined) set.auth = patch.auth
    if (patch.keyPath !== undefined) set.key_path = patch.keyPath
    if (patch.secret !== undefined) set.secret = patch.secret
    if (patch.sudoSecret !== undefined) set.sudo_secret = patch.sudoSecret
    if (patch.identities !== undefined) set.identities = JSON.stringify(patch.identities)
    if (patch.hostKey !== undefined)
      set.host_key = patch.hostKey === null ? null : JSON.stringify(patch.hostKey)
    if (patch.sftpServerPath !== undefined)
      set.options = JSON.stringify({ sftpServerPath: patch.sftpServerPath })
    if (patch.authState !== undefined) set.auth_state = patch.authState
    if (patch.updatedAt !== undefined) set.updated_at = patch.updatedAt
    if (Object.keys(set).length === 0) return
    await this.db.updateTable('connections').set(set).where('id', '=', id).execute()
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('connections').where('id', '=', id).execute()
  }

  async setAuthState(id: string, state: ConnectionAuthState): Promise<void> {
    await this.db
      .updateTable('connections')
      .set({ auth_state: state })
      .where('id', '=', id)
      .execute()
  }

  async setHostKey(id: string, key: HostKeyInfo | null): Promise<void> {
    await this.db
      .updateTable('connections')
      .set({ host_key: key === null ? null : JSON.stringify(key) })
      .where('id', '=', id)
      .execute()
  }
}
