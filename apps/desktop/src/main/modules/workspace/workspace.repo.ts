import type { Selectable, Updateable } from 'kysely'
import type { Workspace } from '@pch/shared'
import type { Database } from '../../infra/db/client'
import type { WorkspacesTable } from '../../infra/db/schema'

export type WorkspacePatch = Partial<
  Pick<Workspace, 'name' | 'description' | 'color' | 'archived' | 'lastOpenedAt'>
>

/**
 * 只做数据存取，不含业务规则。行 ↔ 领域对象的转换只在这里。
 * 构造参数也可以是事务对象（Kysely 的 Transaction 同样是 Kysely<DB>）。
 */
export class WorkspaceRepo {
  constructor(private readonly db: Database) {}

  async list(): Promise<Workspace[]> {
    const rows = await this.db
      .selectFrom('workspaces')
      .selectAll()
      .orderBy('sort_order')
      .orderBy('created_at')
      .execute()
    return rows.map(toWorkspace)
  }

  async get(id: string): Promise<Workspace | undefined> {
    const row = await this.db
      .selectFrom('workspaces')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row && toWorkspace(row)
  }

  async insert(w: Workspace): Promise<void> {
    await this.db
      .insertInto('workspaces')
      .values({
        id: w.id,
        name: w.name,
        description: w.description,
        color: w.color,
        sort_order: w.sortOrder,
        archived: w.archived ? 1 : 0,
        last_opened_at: w.lastOpenedAt,
        created_at: w.createdAt,
        updated_at: w.updatedAt
      })
      .execute()
  }

  async update(id: string, patch: WorkspacePatch): Promise<void> {
    const set: Updateable<WorkspacesTable> = { updated_at: Date.now() }
    if (patch.name !== undefined) set.name = patch.name
    if (patch.description !== undefined) set.description = patch.description
    if (patch.color !== undefined) set.color = patch.color
    if (patch.archived !== undefined) set.archived = patch.archived ? 1 : 0
    if (patch.lastOpenedAt !== undefined) set.last_opened_at = patch.lastOpenedAt
    await this.db.updateTable('workspaces').set(set).where('id', '=', id).execute()
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('workspaces').where('id', '=', id).execute()
  }
}

function toWorkspace(row: Selectable<WorkspacesTable>): Workspace {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    sortOrder: row.sort_order,
    archived: row.archived === 1,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
