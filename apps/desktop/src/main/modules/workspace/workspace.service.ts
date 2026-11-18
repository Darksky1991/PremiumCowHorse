import { randomUUID } from 'node:crypto'
import {
  AppError,
  isUnderUri,
  normalizeRootUri,
  DEFAULT_WORKSPACE_ID,
  type EntryAddInput,
  type EntryMoveInput,
  type EntrySetRefreshLevelInput,
  type IndexSetTargetInput,
  type EntryUpdateInput,
  type Workspace,
  type WorkspaceCreateInput,
  type WorkspaceEntry,
  type WorkspaceUpdateInput
} from '@pch/shared'
import type { EventBus } from '../../core/event-bus'
import type { MainEvents } from '../../core/events'
import type { Database } from '../../infra/db/client'
import { toFileUri } from '../../vfs/input-path'
import { fileUriToLocalPath } from '../../vfs/local-path'

import type { VfsService } from '../../vfs/vfs.service'
import { EntryRepo, IndexTargetRepo } from './entry.repo'
import { WorkspaceRepo } from './workspace.repo'

/**
 * 工作区与条目的业务规则。所有写操作各自在一个事务内完成（多步写入保持原子性），
 * 成功后发出一次 workspace.changed（条目变化时 id 为所属工作区）。
 */
export class WorkspaceService {
  constructor(
    private readonly db: Database,
    private readonly vfs: VfsService,
    private readonly bus: EventBus<MainEvents>,
    /** 系统临时目录（app.getPath('temp')）；rejectTemporary 时位于其下的路径被拒绝。组合根注入，测试可传任意目录 */
    private readonly tempDir: string
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
    await this.write(async (trx) => {
      const repo = new WorkspaceRepo(trx)
      const max = Math.max(-1, ...(await repo.list()).map((w) => w.sortOrder))
      workspace.sortOrder = max + 1
      await repo.insert(workspace)
      return { workspaceId: workspace.id, result: undefined }
    })
    return workspace
  }

  async update(input: WorkspaceUpdateInput): Promise<Workspace> {
    const { id, ...patch } = input
    // 空名称只允许用于默认工作区（界面显示本地化的默认名称）
    if (patch.name === '' && id !== DEFAULT_WORKSPACE_ID) {
      throw new AppError({ code: 'WORKSPACE_NAME_REQUIRED' })
    }
    return this.write(async (trx) => {
      const repo = new WorkspaceRepo(trx)
      await this.requireWorkspace(repo, id)
      await repo.update(id, patch)
      return { workspaceId: id, result: await this.requireWorkspace(repo, id) }
    })
  }

  async delete(id: string): Promise<void> {
    if (id === DEFAULT_WORKSPACE_ID) throw new AppError({ code: 'WORKSPACE_DEFAULT_PROTECTED' })
    await this.write(async (trx) => {
      const repo = new WorkspaceRepo(trx)
      await this.requireWorkspace(repo, id)
      await repo.delete(id) // 条目由外键级联删除
      return { workspaceId: id, result: undefined }
    })
  }

  async activate(id: string): Promise<void> {
    await this.write(async (trx) => {
      const repo = new WorkspaceRepo(trx)
      await this.requireWorkspace(repo, id)
      await repo.update(id, { lastOpenedAt: Date.now() })
      return { workspaceId: id, result: undefined }
    })
  }

  // ---------- 条目 ----------

  listEntries(workspaceId: string): Promise<WorkspaceEntry[]> {
    return new EntryRepo(this.db).listByWorkspace(workspaceId)
  }

  async addEntry(input: EntryAddInput): Promise<WorkspaceEntry> {
    // folder / file：目标必须存在且类型一致（在事务外检查，避免文件系统访问占用数据库连接）
    let uri: string | null = null
    let defaultLabel = ''
    if (input.kind !== 'group') {
      uri = input.path !== undefined ? toFileUri(input.path) : normalizeRootUri(input.uri as string)
      // 先于 stat 检查：临时副本即使存在也不接受
      if (
        input.rejectTemporary === true &&
        isUnderDirectory(fileUriToLocalPath(uri), this.tempDir)
      ) {
        throw new AppError({ code: 'ENTRY_TEMPORARY_PATH', detail: uri })
      }
      const stat = await this.vfs.stat(uri)
      if ((input.kind === 'folder') !== (stat.kind === 'directory')) {
        throw new AppError({ code: 'ENTRY_KIND_MISMATCH', detail: `${input.kind} → ${stat.kind}` })
      }
      defaultLabel = stat.name
    }
    return this.write(async (trx) => {
      await this.requireWorkspace(new WorkspaceRepo(trx), input.workspaceId)
      const entries = new EntryRepo(trx)
      await this.requireParent(entries, input.workspaceId, input.parentId)
      // 位置：参照条目必须是同一父节点下的同级；插入后把同级重排为 0..n-1
      const siblings = (await entries.listByWorkspace(input.workspaceId))
        .filter((e) => e.parentId === input.parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      let index = siblings.length
      if (input.kind !== 'group' && input.position !== undefined) {
        const refId = 'before' in input.position ? input.position.before : input.position.after
        const at = siblings.findIndex((e) => e.id === refId)
        if (at < 0) throw new AppError({ code: 'ENTRY_INVALID_PARENT', detail: refId })
        index = 'before' in input.position ? at : at + 1
      }
      const now = Date.now()
      const entry: WorkspaceEntry = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        kind: input.kind,
        label: input.kind === 'group' ? input.label : (input.label ?? defaultLabel),
        uri,
        sortOrder: index,
        meta: null,
        refreshLevel: null,
        createdAt: now,
        updatedAt: now
      }
      await entries.insert(entry)
      for (const [i, e] of siblings.entries()) {
        const sortOrder = i < index ? i : i + 1
        if (e.sortOrder !== sortOrder) await entries.update(e.id, { sortOrder })
      }
      return { workspaceId: input.workspaceId, result: entry }
    })
  }

  async updateEntry(input: EntryUpdateInput): Promise<WorkspaceEntry> {
    const { id, ...patch } = input
    return this.write(async (trx) => {
      const entries = new EntryRepo(trx)
      const existing = await this.requireEntry(entries, id)
      await entries.update(id, patch)
      return { workspaceId: existing.workspaceId, result: await this.requireEntry(entries, id) }
    })
  }

  /** 删除条目；group 连同所有后代一起删除 */
  async removeEntry(id: string): Promise<void> {
    await this.write(async (trx) => {
      const entries = new EntryRepo(trx)
      const existing = await this.requireEntry(entries, id)
      const all = await entries.listByWorkspace(existing.workspaceId)
      const removedIds = new Set(subtreeIds(all, id))
      await entries.deleteMany([...removedIds])
      await this.pruneIndexTargets(
        trx,
        existing.workspaceId,
        all.filter((e) => removedIds.has(e.id)),
        all.filter((e) => !removedIds.has(e.id))
      )
      return { workspaceId: existing.workspaceId, result: undefined }
    })
  }

  /** 设置条目级刷新级别（null = 沿用全局默认）；只有 folder 条目可设置 */
  async setRefreshLevel(input: EntrySetRefreshLevelInput): Promise<WorkspaceEntry> {
    return this.write(async (trx) => {
      const entries = new EntryRepo(trx)
      const existing = await this.requireEntry(entries, input.entryId)
      if (existing.workspaceId !== input.workspaceId) {
        throw new AppError({ code: 'ENTRY_NOT_FOUND', detail: input.entryId })
      }
      if (existing.kind !== 'folder') {
        throw new AppError({ code: 'ENTRY_KIND_MISMATCH', detail: `${existing.kind} → folder` })
      }
      await entries.update(existing.id, { refreshLevel: input.level })
      return {
        workspaceId: existing.workspaceId,
        result: await this.requireEntry(entries, existing.id)
      }
    })
  }

  // ---------- 建立索引 ----------

  listIndexTargets(workspaceId: string): Promise<string[]> {
    return new IndexTargetRepo(this.db).listByWorkspace(workspaceId)
  }

  /** 全部工作区的索引目标（配置下发用，由 buildScannerConfig 按活动工作区过滤） */
  listAllIndexTargets(): Promise<{ workspaceId: string; uri: string }[]> {
    return new IndexTargetRepo(this.db).listAll()
  }

  /**
   * 开启 / 关闭某目录的「建立索引」。uri 经规范化，开启时必须位于该工作区某个 folder 条目之下
   * （否则 ENTRY_INVALID_PARENT）；重复开启 / 关闭是幂等的。
   */
  async setIndexTarget(input: IndexSetTargetInput): Promise<void> {
    const uri = normalizeRootUri(input.uri)
    await this.write(async (trx) => {
      await this.requireWorkspace(new WorkspaceRepo(trx), input.workspaceId)
      const targets = new IndexTargetRepo(trx)
      if (!input.enabled) {
        await targets.remove(input.workspaceId, uri)
      } else {
        const all = await new EntryRepo(trx).listByWorkspace(input.workspaceId)
        const inside = all.some(
          (e) => e.kind === 'folder' && e.uri !== null && isUnderUri(uri, normalizeRootUri(e.uri))
        )
        if (!inside) throw new AppError({ code: 'ENTRY_INVALID_PARENT', detail: uri })
        await targets.add(input.workspaceId, uri)
      }
      return { workspaceId: input.workspaceId, result: undefined }
    })
  }

  /**
   * 移动到 parentId 之下、同级列表的第 index 位（index 为移除自身后的位置，超出则放到末尾），
   * 并把目标同级列表（以及跨父节点移动时的原同级列表）的 sort_order 重排为 0..n-1。
   */
  async moveEntry(input: EntryMoveInput): Promise<void> {
    await this.write(async (trx) => {
      const entries = new EntryRepo(trx)
      const existing = await this.requireEntry(entries, input.id)
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
      return { workspaceId: existing.workspaceId, result: undefined }
    })
  }

  // ---------- 内部 ----------

  /**
   * 在事务内执行写操作，成功后发出 workspace.changed。
   * 回调在事务内读取数据并返回受影响的工作区 id 与结果，避免用事务外的过期读取决定 id。
   */
  private async write<T>(
    fn: (trx: Database) => Promise<{ workspaceId: string; result: T }>
  ): Promise<T> {
    const { workspaceId, result } = await this.db.transaction().execute(fn)
    this.bus.emit('workspace.changed', { id: workspaceId })
    return result
  }

  /** 删除位于被移除 folder 之下、且不在任何保留 folder 之下的索引目标 */
  private async pruneIndexTargets(
    trx: Database,
    workspaceId: string,
    removed: WorkspaceEntry[],
    kept: WorkspaceEntry[]
  ): Promise<void> {
    const folderUris = (list: WorkspaceEntry[]): string[] =>
      list.flatMap((e) => (e.kind === 'folder' && e.uri !== null ? [normalizeRootUri(e.uri)] : []))
    const removedRoots = folderUris(removed)
    if (removedRoots.length === 0) return
    const keptRoots = folderUris(kept)
    const targets = new IndexTargetRepo(trx)
    for (const uri of await targets.listByWorkspace(workspaceId)) {
      if (
        removedRoots.some((r) => isUnderUri(uri, r)) &&
        !keptRoots.some((r) => isUnderUri(uri, r))
      ) {
        await targets.remove(workspaceId, uri)
      }
    }
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

/**
 * target 是否等于 dir 或在其之下：Windows 路径，统一分隔符、按路径段比较、不区分大小写
 * （`C:\\Temp2` 不在 `C:\\Temp` 之下）。
 */
function isUnderDirectory(target: string, dir: string): boolean {
  const segments = (p: string): string[] =>
    p
      .replaceAll('/', '\\')
      .split('\\')
      .filter((s) => s !== '')
      .map((s) => s.toLowerCase())
  const base = segments(dir)
  const t = segments(target)
  return base.length > 0 && t.length >= base.length && base.every((s, i) => t[i] === s)
}

/** id 自身及其所有后代的 id */
function subtreeIds(all: WorkspaceEntry[], rootId: string): string[] {
  const result = [rootId]
  for (let i = 0; i < result.length; i++) {
    for (const e of all) if (e.parentId === result[i]) result.push(e.id)
  }
  return result
}
