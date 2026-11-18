import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_ID, type WorkspaceEntry } from '@pch/shared'
import { EventBus } from '../../core/event-bus'
import type { MainEvents } from '../../core/events'
import { openDatabase, type Database } from '../../infra/db/client'
import type { Logger } from '../../infra/logger'
import { LocalProvider } from '../../vfs/providers/local.provider'
import { VfsService } from '../../vfs/vfs.service'
import { WorkspaceService } from './workspace.service'

const noop = (): void => undefined
const silent: Logger = { error: noop, warn: noop, info: noop, debug: noop }

describe('WorkspaceService', () => {
  let db: Database
  let service: WorkspaceService
  let events: MainEvents['workspace.changed'][]
  /** 临时目录：work/a（目录）、work/b.xlsx、案件 A/設計書#1（目录）、x.txt */
  let root: string
  const at = (...parts: string[]): string => path.join(root, ...parts)

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'pch-ws-'))
    mkdirSync(at('work', 'a'), { recursive: true })
    mkdirSync(at('案件 A', '設計書#1'), { recursive: true })
    writeFileSync(at('work', 'b.xlsx'), '')
    writeFileSync(at('x.txt'), '')
    db = await openDatabase(':memory:', silent)
    const bus = new EventBus<MainEvents>()
    events = []
    bus.on('workspace.changed', (e) => events.push(e))
    service = new WorkspaceService(db, new VfsService([new LocalProvider()]), bus)
  })
  afterEach(async () => {
    await db.destroy()
    rmSync(root, { recursive: true, force: true })
  })

  const group = (
    label: string,
    parentId: string | null = null,
    workspaceId = DEFAULT_WORKSPACE_ID
  ): Promise<WorkspaceEntry> => service.addEntry({ kind: 'group', workspaceId, parentId, label })
  const snapshot = async (): Promise<Pick<WorkspaceEntry, 'id' | 'parentId' | 'sortOrder'>[]> =>
    (await service.listEntries(DEFAULT_WORKSPACE_ID)).map(({ id, parentId, sortOrder }) => ({
      id,
      parentId,
      sortOrder
    }))

  describe('workspaces', () => {
    it('protects the default workspace from deletion but allows renaming it', async () => {
      await expect(service.delete(DEFAULT_WORKSPACE_ID)).rejects.toMatchObject({
        code: 'WORKSPACE_DEFAULT_PROTECTED'
      })
      const renamed = await service.update({ id: DEFAULT_WORKSPACE_ID, name: '共用フォルダ' })
      expect(renamed.name).toBe('共用フォルダ')
    })

    it('reports WORKSPACE_NOT_FOUND for unknown ids', async () => {
      await expect(service.activate('nope')).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' })
    })

    it('treats the most recently activated workspace as the active one', async () => {
      expect((await service.active()).id).toBe(DEFAULT_WORKSPACE_ID)
      const b = await service.create({ name: '案件B' })
      await service.activate(b.id)
      expect((await service.active()).id).toBe(b.id)
      await service.activate(DEFAULT_WORKSPACE_ID)
      expect((await service.active()).id).toBe(DEFAULT_WORKSPACE_ID)
    })

    it('deleting a workspace removes its entries', async () => {
      const w = await service.create({ name: '案件C' })
      await group('ログ', null, w.id)
      await service.delete(w.id)
      expect(await service.listEntries(w.id)).toEqual([])
    })
  })

  describe('entries', () => {
    it('adds a folder under a group and appends to the end of its siblings', async () => {
      const g = await group('設計書')
      const a = await service.addEntry({
        kind: 'folder',
        workspaceId: DEFAULT_WORKSPACE_ID,
        parentId: g.id,
        path: at('work', 'a')
      })
      const b = await service.addEntry({
        kind: 'file',
        workspaceId: DEFAULT_WORKSPACE_ID,
        parentId: g.id,
        path: at('work', 'b.xlsx')
      })
      expect([a.parentId, a.sortOrder, b.sortOrder]).toEqual([g.id, 0, 1])
    })

    it('keeps a URI that round-trips paths with Japanese, spaces and #', async () => {
      const p = at('案件 A', '設計書#1')
      const e = await service.addEntry({
        kind: 'folder',
        workspaceId: DEFAULT_WORKSPACE_ID,
        parentId: null,
        path: p
      })
      expect(fileURLToPath(e.uri!)).toBe(p)
      expect(e.label).toBe('設計書#1')
    })

    it('labels a drive-root folder entry with the drive name, not an empty string', async () => {
      const driveRoot = path.parse(root).root
      const e = await service.addEntry({
        kind: 'folder',
        workspaceId: DEFAULT_WORKSPACE_ID,
        parentId: null,
        path: driveRoot
      })
      expect(e.label).toBe(driveRoot.replace(/[\\/]$/, ''))
    })

    it('rejects a path that does not exist with FS_NOT_FOUND', async () => {
      await expect(
        service.addEntry({
          kind: 'folder',
          workspaceId: DEFAULT_WORKSPACE_ID,
          parentId: null,
          path: at('nope')
        })
      ).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
    })

    it('rejects a folder entry pointing at a file and a file entry pointing at a folder', async () => {
      const add = (kind: 'folder' | 'file', p: string): Promise<WorkspaceEntry> =>
        service.addEntry({ kind, workspaceId: DEFAULT_WORKSPACE_ID, parentId: null, path: p })
      await expect(add('folder', at('x.txt'))).rejects.toMatchObject({
        code: 'ENTRY_KIND_MISMATCH'
      })
      await expect(add('file', at('work'))).rejects.toMatchObject({ code: 'ENTRY_KIND_MISMATCH' })
    })

    it('rejects a parent that is not a group', async () => {
      const f = await service.addEntry({
        kind: 'file',
        workspaceId: DEFAULT_WORKSPACE_ID,
        parentId: null,
        path: at('x.txt')
      })
      await expect(group('子', f.id)).rejects.toMatchObject({ code: 'ENTRY_INVALID_PARENT' })
    })

    it('rejects a parent from another workspace', async () => {
      const other = await service.create({ name: '他案件' })
      const g = await group('他のグループ', null, other.id)
      await expect(group('子', g.id)).rejects.toMatchObject({ code: 'ENTRY_INVALID_PARENT' })
    })

    it('refuses to move a group under its own descendant and leaves data unchanged', async () => {
      const a = await group('A')
      const b = await group('B', a.id)
      await group('C', b.id)
      const before = await snapshot()
      await expect(service.moveEntry({ id: a.id, parentId: b.id, index: 0 })).rejects.toMatchObject(
        { code: 'ENTRY_INVALID_PARENT' }
      )
      await expect(service.moveEntry({ id: a.id, parentId: a.id, index: 0 })).rejects.toMatchObject(
        { code: 'ENTRY_INVALID_PARENT' }
      )
      expect(await snapshot()).toEqual(before)
    })

    it('reorders siblings when moving within the same parent', async () => {
      const x = await group('x')
      const y = await group('y')
      const z = await group('z')
      await service.moveEntry({ id: z.id, parentId: null, index: 0 })
      const order = (await service.listEntries(DEFAULT_WORKSPACE_ID)).map((e) => [
        e.id,
        e.sortOrder
      ])
      expect(order).toEqual([
        [z.id, 0],
        [x.id, 1],
        [y.id, 2]
      ])
    })

    it('moves an entry into another group and renumbers both sibling lists', async () => {
      const g = await group('g')
      const a = await group('a')
      const b = await group('b')
      await service.moveEntry({ id: a.id, parentId: g.id, index: 0 })
      const byId = new Map((await service.listEntries(DEFAULT_WORKSPACE_ID)).map((e) => [e.id, e]))
      expect(byId.get(a.id)).toMatchObject({ parentId: g.id, sortOrder: 0 })
      expect([byId.get(g.id)?.sortOrder, byId.get(b.id)?.sortOrder]).toEqual([0, 1])
    })

    it('removes a group with its whole subtree while a concurrent write elsewhere succeeds', async () => {
      const other = await service.create({ name: '並行' })
      const keep = await group('keep')
      const a = await group('A')
      const b = await group('B', a.id)
      await group('C', b.id)
      const [, added] = await Promise.all([
        service.removeEntry(a.id),
        service.addEntry({
          kind: 'group',
          workspaceId: other.id,
          parentId: null,
          label: '並行追加'
        })
      ])
      expect((await service.listEntries(DEFAULT_WORKSPACE_ID)).map((e) => e.id)).toEqual([keep.id])
      expect((await service.listEntries(other.id)).map((e) => e.id)).toEqual([added.id])
    })

    it('updates label and meta', async () => {
      const g = await group('旧')
      const updated = await service.updateEntry({ id: g.id, label: '新', meta: { note: 'メモ' } })
      expect(updated).toMatchObject({ label: '新', meta: { note: 'メモ' } })
    })

    it('reports ENTRY_NOT_FOUND for unknown entries', async () => {
      await expect(service.removeEntry('nope')).rejects.toMatchObject({ code: 'ENTRY_NOT_FOUND' })
    })
  })

  it('emits exactly one workspace.changed per write with the workspace id', async () => {
    const w = await service.create({ name: 'E' })
    await service.update({ id: w.id, name: 'E2' })
    await service.activate(w.id)
    const g = await group('g', null, w.id)
    await service.updateEntry({ id: g.id, label: 'g2' })
    await service.moveEntry({ id: g.id, parentId: null, index: 0 })
    await service.removeEntry(g.id)
    await service.delete(w.id)
    expect(events).toEqual(Array.from({ length: 8 }, () => ({ id: w.id })))
  })
})
