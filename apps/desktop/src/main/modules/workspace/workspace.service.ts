import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  AppError,
  DEFAULT_WORKSPACE_ID,
  type EntryAddInput,
  type EntryMoveInput,
  type EntryUpdateInput,
  type Workspace,
  type WorkspaceCreateInput,
  type WorkspaceEntry,
  type WorkspaceUpdateInput
} from '@pch/shared'
import type { EventBus } from '../../core/event-bus'
import type { MainEvents } from '../../core/events'
import type { Database } from '../../infra/db/client'
import type { VfsService } from '../../vfs/vfs.service'
import { EntryRepo } from './entry.repo'
import { WorkspaceRepo } from './workspace.repo'

/**
 * 工作区与条目的业务规则。所有写操作各自在一个事务内完成（多步写入保持原子性），
 * 成功后发出一次 workspace.changed（条目变化时 id 为所属工作区）。
 */
export class WorkspaceService {
  constructor(
    private readonly db: Database,
    private readonly vfs: VfsService,
    private readonly bus: EventBus<MainEvents>
  ) {}

  // ---------- 工作区 ----------

  list(): Promise<Workspace[]> {
    return new WorkspaceRepo(this.db).list()
  }

  /** 当前工作区：最近一次切换到的工作区；从未切换过时为默认工作区 */
  async active(): Promise<Workspace> {
    const list = await this.list()
    const latest = list
      .filter((w) => w.lastOpenedAt !== null)
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0]
    return latest ?? (await this.requireWorkspace(new WorkspaceRepo(this.db), DEFAULT_WORKSPACE_ID))
  }

  async create(input: WorkspaceCreateInput): Promise<Workspace> {
    const now = Date.now()
    const workspace: Workspace = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? null,
      sortOrder: 0,
      archived: false,
      lastOpenedAt: null,
      createdAt: now,
      updatedAt: now
    }
    await this.write(workspace.id, async (trx) => {
      const repo = new WorkspaceRepo(trx)
      const max = Math.max(-1, ...(await repo.list()).map((w) => w.sortOrder))
      workspace.sortOrder = max + 1
      await repo.insert(workspace)
    })
    return workspace
  }

  async update(input: WorkspaceUpdateInput): Promise<Workspace> {
    const { id, ...patch } = input
    return this.write(id, async (trx) => {
      const repo = new WorkspaceRepo(trx)
      await this.requireWorkspace(repo, id)
      await repo.update(id, patch)
      return this.requireWorkspace(repo, id)
    })
  }

  async delete(id: string): Promise<void> {
    if (id === DEFAULT_WORKSPACE_ID) throw new AppError({ code: 'WORKSPACE_DEFAULT_PROTECTED' })
    await this.write(id, async (trx) => {
      const repo = new WorkspaceRepo(trx)
      await this.requireWorkspace(repo, id)
      await repo.delete(id) // 条目由外键级联删除
    })
  }

  async activate(id: string): Promise<void> {
    await this.write(id, async (trx) => {
      const repo = new WorkspaceRepo(trx)
      await this.requireWorkspace(repo, id)
      await repo.update(id, { lastOpenedAt: Date.now() })
    })
  }

  // ---------- 条目 ----------

  listEntries(workspaceId: string): Promise<WorkspaceEntry[]> {
    return new EntryRepo(this.db).listByWorkspace(workspaceId)
  }

  async addEntry(input: EntryAddInput): Promise<WorkspaceEntry> {
    // folder / file：目标必须存在且类型一致（在事务外检查，避免文件系统访问占用数据库连接）
    const uri = input.kind === 'group' ? null : pathToFileURL(input.path).href
    if (uri !== null) {
      const stat = await this.vfs.stat(uri)
      if ((input.kind === 'folder') !== (stat.kind === 'directory')) {
        throw new AppError({ code: 'ENTRY_KIND_MISMATCH', detail: `${input.kind} → ${stat.kind}` })
      }
    }
    return this.write(input.workspaceId, async (trx) => {
      await this.requireWorkspace(new WorkspaceRepo(trx), input.workspaceId)
      const entries = new EntryRepo(trx)
      await this.requireParent(entries, input.workspaceId, input.parentId)
      const now = Date.now()
      const entry: WorkspaceEntry = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        kind: input.kind,
        label: input.kind === 'group' ? input.label : (input.label ?? path.basename(input.path)),
        uri,
        sortOrder: (await entries.maxSortOrder(input.workspaceId, input.parentId)) + 1,
        meta: null,
        createdAt: now,
        updatedAt: now
      }
      await entries.insert(entry)
      return entry
    })
  }

  async updateEntry(input: EntryUpdateInput): Promise<WorkspaceEntry> {
    const existing = await this.requireEntry(new EntryRepo(this.db), input.id)
    const { id, ...patch } = input
    return this.write(existing.workspaceId, async (trx) => {
      const entries = new EntryRepo(trx)
      await entries.update(id, patch)
      return this.requireEntry(entries, id)
    })
  }

  /** 删除条目；group 连同所有后代一起删除 */
  async removeEntry(id: string): Promise<void> {
    const existing = await this.requireEntry(new EntryRepo(this.db), id)
    await this.write(existing.workspaceId, async (trx) => {
      const entries = new EntryRepo(trx)
      const all = await entries.listByWorkspace(existing.workspaceId)
      await entries.deleteMany(subtreeIds(all, id))
    })
  }

  /**
   * 移动到 parentId 之下、同级列表的第 index 位（index 为移除自身后的位置，超出则放到末尾），
   * 并把目标同级列表（以及跨父节点移动时的原同级列表）的 sort_order 重排为 0..n-1。
   */
  async moveEntry(input: EntryMoveInput): Promise<void> {
    const existing = await this.requireEntry(new EntryRepo(this.db), input.id)
    await this.write(existing.workspaceId, async (trx) => {
      const entries = new EntryRepo(trx)
      await this.requireParent(entries, existing.workspaceId, input.parentId)
      const all = await entries.listByWorkspace(existing.workspaceId)
      if (input.parentId !== null && subtreeIds(all, existing.id).includes(input.parentId)) {
        throw new AppError({ code: 'ENTRY_INVALID_PARENT', detail: 'cannot move into itself' })
      }
      const siblings = (parentId: string | null): WorkspaceEntry[] =>
        all
          .filter((e) => e.parentId === parentId && e.id !== existing.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)

      const target = siblings(input.parentId)
      target.splice(Math.min(input.index, target.length), 0, existing)
      for (const [i, e] of target.entries()) {
        if (e.id === existing.id)
          await entries.update(e.id, { parentId: input.parentId, sortOrder: i })
        else if (e.sortOrder !== i) await entries.update(e.id, { sortOrder: i })
      }
      if (existing.parentId !== input.parentId) {
        for (const [i, e] of siblings(existing.parentId).entries()) {
          if (e.sortOrder !== i) await entries.update(e.id, { sortOrder: i })
        }
      }
    })
  }

  // ---------- 内部 ----------

  /** 在事务内执行写操作，成功后发出 workspace.changed */
  private async write<T>(workspaceId: string, fn: (trx: Database) => Promise<T>): Promise<T> {
    const result = await this.db.transaction().execute(fn)
    this.bus.emit('workspace.changed', { id: workspaceId })
    return result
  }

  private async requireWorkspace(repo: WorkspaceRepo, id: string): Promise<Workspace> {
    const w = await repo.get(id)
    if (!w) throw new AppError({ code: 'WORKSPACE_NOT_FOUND', detail: id })
    return w
  }

  private async requireEntry(repo: EntryRepo, id: string): Promise<WorkspaceEntry> {
    const e = await repo.get(id)
    if (!e) throw new AppError({ code: 'ENTRY_NOT_FOUND', detail: id })
    return e
  }

  /** 父节点只能是根（null）或同一工作区的 group */
  private async requireParent(
    repo: EntryRepo,
    workspaceId: string,
    parentId: string | null
  ): Promise<void> {
    if (parentId === null) return
    const parent = await repo.get(parentId)
    if (!parent || parent.workspaceId !== workspaceId || parent.kind !== 'group') {
      throw new AppError({ code: 'ENTRY_INVALID_PARENT', detail: parentId })
    }
  }
}

/** id 自身及其所有后代的 id */
function subtreeIds(all: WorkspaceEntry[], rootId: string): string[] {
  const result = [rootId]
  for (let i = 0; i < result.length; i++) {
    for (const e of all) if (e.parentId === result[i]) result.push(e.id)
  }
  return result
}
