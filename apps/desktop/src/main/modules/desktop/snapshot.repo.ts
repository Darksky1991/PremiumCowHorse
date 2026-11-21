import { z } from 'zod'
import type {
  DesktopItem,
  DesktopSnapshot,
  DesktopSnapshotKind,
  DesktopSnapshotSummary
} from '@pch/shared'
import type { Database } from '../../infra/db/client'

const boundsSchema = z
  .strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
  .nullable()

const itemSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('explorer'), tabs: z.array(z.string()), bounds: boundsSchema }),
  z.strictObject({
    kind: z.literal('office'),
    app: z.enum(['word', 'excel', 'powerpoint']),
    path: z.string(),
    readOnly: z.boolean(),
    exe: z.string()
  }),
  z.strictObject({
    kind: z.literal('vscode'),
    target: z.string(),
    exe: z.string(),
    bounds: boundsSchema
  }),
  z.strictObject({
    kind: z.literal('eclipse'),
    workspace: z.string(),
    exe: z.string(),
    bounds: boundsSchema
  })
]) satisfies z.ZodType<DesktopItem>

const KINDS: readonly DesktopSnapshotKind[] = ['auto', 'manual', 'exit', 'exit-none']

/** 一次 delete ... where id in (...) 的最大个数（SQLite 绑定参数上限内） */
const DELETE_CHUNK = 500

interface SnapshotRow {
  id: number
  kind: string
  created_at: number
  logon_at: number
  name: string | null
  itemCount: number | string | bigint
}

function toSummary(row: SnapshotRow): DesktopSnapshotSummary {
  return {
    id: row.id,
    // 未知的种类（比当前版本新的数据）按手动记录对待：不会被清理，也不当作恢复候选的自动记录
    kind: (KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as DesktopSnapshotKind)
      : 'manual',
    createdAt: row.created_at,
    logonAt: row.logon_at,
    name: row.name,
    itemCount: Number(row.itemCount)
  }
}

/**
 * 桌面快照的持久化（只做存取与清理，不含业务判断）。
 * 按机器区分：数据库可能随漫游配置文件到别的机器，所有读写都限定在 `machine`（本机标识）的行
 */
export class DesktopSnapshotRepo {
  constructor(
    private readonly db: Database,
    private readonly machine: string
  ) {}

  /** 写入一份快照及其项目（同一事务），返回快照 id */
  async insert(input: {
    kind: DesktopSnapshotKind
    createdAt: number
    logonAt: number
    name?: string | null
    items: DesktopItem[]
  }): Promise<number> {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('desktop_snapshots')
        .values({
          machine: this.machine,
          kind: input.kind,
          created_at: input.createdAt,
          logon_at: input.logonAt,
          name: input.name ?? null
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      if (input.items.length > 0) {
        await trx
          .insertInto('desktop_items')
          .values(
            input.items.map((item, sort) => ({
              snapshot_id: row.id,
              sort,
              data: JSON.stringify(item)
            }))
          )
          .execute()
      }
      return row.id
    })
  }

  /** 本机快照，创建时刻降序；不含 exit-none（那只是「不提示」的标记） */
  async list(): Promise<DesktopSnapshotSummary[]> {
    return (await this.summaries()).filter((s) => s.kind !== 'exit-none')
  }

  /** 本机全部快照（含 exit-none），创建时刻降序，供恢复候选判断 */
  async listByLogon(): Promise<DesktopSnapshotSummary[]> {
    return this.summaries()
  }

  /** 别的机器的快照 id 返回 null；data 解析失败的项目丢弃（itemCount 按实际可用项目计） */
  async get(id: number): Promise<DesktopSnapshot | null> {
    const row = await this.db
      .selectFrom('desktop_snapshots')
      .selectAll()
      .where('id', '=', id)
      .where('machine', '=', this.machine)
      .executeTakeFirst()
    if (!row) return null
    const rows = await this.db
      .selectFrom('desktop_items')
      .select(['id', 'data'])
      .where('snapshot_id', '=', id)
      .orderBy('sort')
      .orderBy('id')
      .execute()
    const items: DesktopSnapshot['items'] = []
    for (const r of rows) {
      try {
        const parsed = itemSchema.safeParse(JSON.parse(r.data))
        if (parsed.success) items.push({ id: r.id, item: parsed.data })
      } catch {
        // 损坏的项目丢弃
      }
    }
    return { ...toSummary({ ...row, itemCount: items.length }), items }
  }

  async rename(id: number, name: string | null): Promise<void> {
    await this.db
      .updateTable('desktop_snapshots')
      .set({ name })
      .where('id', '=', id)
      .where('machine', '=', this.machine)
      .execute()
  }

  /** 项目随快照级联删除 */
  async delete(id: number): Promise<void> {
    await this.db
      .deleteFrom('desktop_snapshots')
      .where('id', '=', id)
      .where('machine', '=', this.machine)
      .execute()
  }

  /**
   * 按保留规则清理本机快照：
   * - auto：保留最近 keepAuto 份，以及有 auto 的最近 keepLogons 个不同 logon_at 各自 created_at 最大的一份
   * - manual / exit：不删
   * - exit-none：只保留最近 keepLogons 个登录内的（登录按本机全部快照的 logon_at 计）
   */
  async prune(keepAuto: number, keepLogons: number): Promise<void> {
    const rows = await this.summaries() // created_at 降序
    const recent = (list: DesktopSnapshotSummary[]): Set<number> =>
      new Set([...new Set(list.map((r) => r.logonAt))].sort((x, y) => y - x).slice(0, keepLogons))
    const autos = rows.filter((r) => r.kind === 'auto')
    // auto 的窗口只数有 auto 的登录；exit-none 的窗口数本机全部种类的登录
    const recentAutoLogons = recent(autos)
    const recentAllLogons = recent(rows)

    const keep = new Set<number>()
    for (const r of autos.slice(0, Math.max(0, keepAuto))) keep.add(r.id)
    // rows 已按创建时刻降序，每个登录第一次出现的即其最后一份
    const seenLogons = new Set<number>()
    for (const r of autos) {
      if (seenLogons.has(r.logonAt)) continue
      seenLogons.add(r.logonAt)
      if (recentAutoLogons.has(r.logonAt)) keep.add(r.id)
    }

    const remove = rows
      .filter((r) => {
        if (r.kind === 'auto') return !keep.has(r.id)
        if (r.kind === 'exit-none') return !recentAllLogons.has(r.logonAt)
        return false
      })
      .map((r) => r.id)
    await this.db.transaction().execute(async (trx) => {
      for (let i = 0; i < remove.length; i += DELETE_CHUNK) {
        await trx
          .deleteFrom('desktop_snapshots')
          .where('machine', '=', this.machine)
          .where('id', 'in', remove.slice(i, i + DELETE_CHUNK))
          .execute()
      }
    })
  }

  /** 本机全部快照及项目数（一次查询），创建时刻降序（同刻按 id 降序） */
  private async summaries(): Promise<DesktopSnapshotSummary[]> {
    const rows = await this.db
      .selectFrom('desktop_snapshots as s')
      .leftJoin('desktop_items as i', 'i.snapshot_id', 's.id')
      .select((eb) => [
        's.id',
        's.kind',
        's.created_at',
        's.logon_at',
        's.name',
        eb.fn.count<number>('i.id').as('itemCount')
      ])
      .where('s.machine', '=', this.machine)
      .groupBy('s.id')
      .orderBy('s.created_at', 'desc')
      .orderBy('s.id', 'desc')
      .execute()
    return rows.map(toSummary)
  }
}
