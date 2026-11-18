import type { Selectable, Updateable } from 'kysely'
import type { EntryMeta, WorkspaceEntry } from '@pch/shared'
import type { Database } from '../../infra/db/client'
import type { WorkspaceEntriesTable } from '../../infra/db/schema'

export type EntryPatch = Partial<Pick<WorkspaceEntry, 'label' | 'meta' | 'parentId' | 'sortOrder'>>

/**
 * 只做数据存取，不含业务规则（父节点合法性、排序重排等由 WorkspaceService 负责）。
 * 构造参数也可以是事务对象（Kysely 的 Transaction 同样是 Kysely<DB>）。
 */
export class EntryRepo {
  constructor(private readonly db: Database) {}

  async listByWorkspace(workspaceId: string): Promise<WorkspaceEntry[]> {
    const rows = await this.db
      .selectFrom('workspace_entries')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .orderBy('parent_id')
      .orderBy('sort_order')
      .execute()
    return rows.map(toEntry)
  }

  async get(id: string): Promise<WorkspaceEntry | undefined> {
    const row = await this.db
      .selectFrom('workspace_entries')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row && toEntry(row)
  }

  async insert(e: WorkspaceEntry): Promise<void> {
    await this.db
      .insertInto('workspace_entries')
      .values({
        id: e.id,
        workspace_id: e.workspaceId,
        parent_id: e.parentId,
        kind: e.kind,
        label: e.label,
        uri: e.uri,
        sort_order: e.sortOrder,
        meta: e.meta === null ? null : JSON.stringify(e.meta),
        created_at: e.createdAt,
        updated_at: e.updatedAt
      })
      .execute()
  }

  async update(id: string, patch: EntryPatch): Promise<void> {
    const set: Updateable<WorkspaceEntriesTable> = { updated_at: Date.now() }
    if (patch.label !== undefined) set.label = patch.label
    if (patch.meta !== undefined) set.meta = patch.meta === null ? null : JSON.stringify(patch.meta)
    if (patch.parentId !== undefined) set.parent_id = patch.parentId
    if (patch.sortOrder !== undefined) set.sort_order = patch.sortOrder
    await this.db.updateTable('workspace_entries').set(set).where('id', '=', id).execute()
  }

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.db.deleteFrom('workspace_entries').where('id', 'in', ids).execute()
  }

  /** 同级条目中最大的 sort_order；没有同级时为 -1 */
  async maxSortOrder(workspaceId: string, parentId: string | null): Promise<number> {
    const row = await this.db
      .selectFrom('workspace_entries')
      .select((eb) => eb.fn.max('sort_order').as('max'))
      .where('workspace_id', '=', workspaceId)
      .where('parent_id', parentId === null ? 'is' : '=', parentId)
      .executeTakeFirst()
    return row?.max ?? -1
  }
}

function toEntry(row: Selectable<WorkspaceEntriesTable>): WorkspaceEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    parentId: row.parent_id,
    kind: row.kind,
    label: row.label,
    uri: row.uri,
    sortOrder: row.sort_order,
    meta: row.meta === null ? null : (JSON.parse(row.meta) as EntryMeta),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
