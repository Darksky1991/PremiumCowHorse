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
   * 原地更新一份 auto：替换创建时刻与全部项目（同一事务）。
   * 快照不存在（被用户删除或已被清理）、不是本机的、或种类不在 from 中时什么也不做并返回 false。
   * from 默认只接受 auto；同一登录内重启本应用时，服务把本次登录的 exit 接回来当作 auto（from 含 exit）
   */
  updateAuto(
    id: number,
    input: { createdAt: number; items: DesktopItem[] },
    from: readonly DesktopSnapshotKind[] = ['auto']
  ): Promise<boolean> {
    return this.rewrite(id, from, 'auto', input)
  }

  /**
   * 「保存して終了」：把本次登录的 auto 原地改为 exit（种类、创建时刻、项目全部替换，同一事务），
   * 使每次登录只占 1 个可见名额。只改本机、种类为 auto 的行；否则什么也不做并返回 false
   */
  convertToExit(id: number, input: { createdAt: number; items: DesktopItem[] }): Promise<boolean> {
    return this.rewrite(id, ['auto'], 'exit', input)
  }

  /** 删除一份 auto（只删本机、种类为 auto 的行）；返回是否删除了 */
  async deleteAuto(id: number): Promise<boolean> {
    const res = await this.db
      .deleteFrom('desktop_snapshots')
      .where('id', '=', id)
      .where('machine', '=', this.machine)
      .where('kind', '=', 'auto')
      .executeTakeFirst()
    return Number(res.numDeletedRows) > 0
  }

  /** 删除本机全部快照（含 exit-none）；别的机器的不动 */
  async deleteAll(): Promise<void> {
    await this.db.deleteFrom('desktop_snapshots').where('machine', '=', this.machine).execute()
  }

  /**
   * 按保留规则清理本机快照：
   * - 可见快照（auto / manual / exit 及未知种类）按创建时刻保留最新 keepVisible 个；
   *   protectId 指向的快照一定保留并计入这 keepVisible 个
   * - exit-none（内部标记，不计入）只保留最新一个
   */
  async prune(keepVisible: number, protectId: number | null): Promise<void> {
    const rows = await this.summaries() // created_at 降序
    const visible = rows.filter((r) => r.kind !== 'exit-none')
    const keep = new Set<number>()
    const protectedRow = protectId === null ? undefined : visible.find((r) => r.id === protectId)
    if (protectedRow) keep.add(protectedRow.id)
    for (const r of visible) {
      if (keep.size >= Math.max(0, keepVisible)) break
      keep.add(r.id)
    }
    const latestNone = rows.find((r) => r.kind === 'exit-none')
    const remove = rows
      .filter((r) => (r.kind === 'exit-none' ? r.id !== latestNone?.id : !keep.has(r.id)))
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

  /** 原地改写一份快照：种类、创建时刻与全部项目（同一事务）；条件不符时返回 false */
  private rewrite(
    id: number,
    from: readonly DesktopSnapshotKind[],
    kind: DesktopSnapshotKind,
    input: { createdAt: number; items: DesktopItem[] }
  ): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const res = await trx
        .updateTable('desktop_snapshots')
        .set({ kind, created_at: input.createdAt })
        .where('id', '=', id)
        .where('machine', '=', this.machine)
        .where('kind', 'in', [...from])
        .executeTakeFirst()
      if (Number(res.numUpdatedRows) === 0) return false
      await trx.deleteFrom('desktop_items').where('snapshot_id', '=', id).execute()
      if (input.items.length > 0) {
        await trx
          .insertInto('desktop_items')
          .values(
            input.items.map((item, sort) => ({
              snapshot_id: id,
              sort,
              data: JSON.stringify(item)
            }))
          )
          .execute()
      }
      return true
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
