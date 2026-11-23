import { RECENT_KEEP, type RecentItem } from '@pch/shared'
import type { Database } from '../../infra/db/client'

/** 只做数据存取：每个工作区保留最近 RECENT_KEEP 条 */
export class RecentRepo {
  constructor(private readonly db: Database) {}

  async list(workspaceId: string, limit: number): Promise<RecentItem[]> {
    const rows = await this.db
      .selectFrom('recent_items')
      .select(['uri', 'kind', 'title', 'opened_at'])
      .where('workspace_id', '=', workspaceId)
      .orderBy('opened_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute()
    return rows.map((r) => ({ uri: r.uri, kind: r.kind, title: r.title, openedAt: r.opened_at }))
  }

  /** 同 (workspace, uri) 只更新种类 / 标题 / 时间；写入后删除该工作区超出保留条数的最旧项 */
  async record(
    workspaceId: string,
    item: Pick<RecentItem, 'uri' | 'kind' | 'title'>,
    at: number
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('recent_items')
        .values({
          workspace_id: workspaceId,
          uri: item.uri,
          kind: item.kind,
          title: item.title,
          opened_at: at
        })
        .onConflict((oc) =>
          oc.columns(['workspace_id', 'uri']).doUpdateSet({
            kind: item.kind,
            title: item.title,
            opened_at: at
          })
        )
        .execute()
      await trx
        .deleteFrom('recent_items')
        .where('workspace_id', '=', workspaceId)
        .where('id', 'not in', (eb) =>
          eb
            .selectFrom('recent_items')
            .select('id')
            .where('workspace_id', '=', workspaceId)
            .orderBy('opened_at', 'desc')
            .orderBy('id', 'desc')
            .limit(RECENT_KEEP)
        )
        .execute()
    })
  }

  async clear(workspaceId?: string): Promise<void> {
    let q = this.db.deleteFrom('recent_items')
    if (workspaceId !== undefined) q = q.where('workspace_id', '=', workspaceId)
    await q.execute()
  }
}
