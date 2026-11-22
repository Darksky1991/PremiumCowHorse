import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError, DEFAULT_WORKSPACE_ID, type WorkspaceEntry } from '@pch/shared'
import { EventBus } from '../../core/event-bus'
import type { MainEvents } from '../../core/events'
import { openDatabase, type Database } from '../../infra/db/client'
import type { Logger } from '../../infra/logger'
import { LocalProvider } from '../../vfs/providers/local.provider'
import type { FileSystemProvider } from '../../vfs/types'
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
    // 注入的「临时目录」是 Temp；Temp2 前缀相同但不在其下
    mkdirSync(at('Temp', 'zip-copy'), { recursive: true })
    mkdirSync(at('Temp2'), { recursive: true })
    writeFileSync(at('Temp', 'zip-copy', 'f.txt'), '')
    writeFileSync(at('Temp2', 'g.txt'), '')
    db = await openDatabase(':memory:', silent)
    const bus = new EventBus<MainEvents>()
    events = []
    bus.on('workspace.changed', (e) => events.push(e))
    service = new WorkspaceService(db, new VfsService([new LocalProvider()]), bus, at('Temp'))
  })
  afterEach(async () => {
    try {
      await db.destroy()
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
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

    it('lets the default workspace reset to the localized name with an empty name', async () => {
      await service.update({ id: DEFAULT_WORKSPACE_ID, name: '共用フォルダ' })
      const reset = await service.update({ id: DEFAULT_WORKSPACE_ID, name: '' })
      expect(reset.name).toBe('')
    })

    it('rejects an empty name for other workspaces', async () => {
      const w = await service.create({ name: '案件B' })
      await expect(service.update({ id: w.id, name: '' })).rejects.toMatchObject({
        code: 'WORKSPACE_NAME_REQUIRED'
      })
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
    const addFile = (
      name: string,
      extra: { parentId?: string | null; position?: { before: string } | { after: string } } = {}
    ): Promise<WorkspaceEntry> =>
      service.addEntry({
        kind: 'file',
        workspaceId: DEFAULT_WORKSPACE_ID,
        parentId: extra.parentId ?? null,
        path: at(name),
        ...(extra.position ? { position: extra.position } : {})
      })
    const order = async (parentId: string | null = null): Promise<string[]> =>
      (await service.listEntries(DEFAULT_WORKSPACE_ID))
        .filter((e) => e.parentId === parentId)
        .sort((x, y) => x.sortOrder - y.sortOrder)
        .map((e) => e.label)

    describe('position', () => {
      beforeEach(() => {
        for (const n of ['p1.txt', 'p2.txt', 'p3.txt', 'n1.txt', 'n2.txt', 'n3.txt']) {
          writeFileSync(at(n), '')
        }
      })

      it('inserts before / after a sibling and renumbers sort_order to 0..n-1', async () => {
        const p1 = await addFile('p1.txt')
        const p2 = await addFile('p2.txt')
        await addFile('p3.txt')
        await addFile('n1.txt', { position: { before: p2.id } })
        await addFile('n2.txt', { position: { after: p1.id } })
        expect(await order()).toEqual(['p1.txt', 'n2.txt', 'n1.txt', 'p2.txt', 'p3.txt'])
        const orders = (await service.listEntries(DEFAULT_WORKSPACE_ID)).map((e) => e.sortOrder)
        expect([...orders].sort()).toEqual([0, 1, 2, 3, 4])
      })

      it('inserts before the first and after the last sibling', async () => {
        const p1 = await addFile('p1.txt')
        const p2 = await addFile('p2.txt')
        await addFile('n1.txt', { position: { before: p1.id } })
        await addFile('n2.txt', { position: { after: p2.id } })
        expect(await order()).toEqual(['n1.txt', 'p1.txt', 'p2.txt', 'n2.txt'])
      })

      it('appends when no position is given', async () => {
        await addFile('p1.txt')
        await addFile('p2.txt')
        expect(await order()).toEqual(['p1.txt', 'p2.txt'])
      })

      it('inserting several in drop order, each after the previous, keeps that order', async () => {
        const p1 = await addFile('p1.txt')
        await addFile('p2.txt')
        const n1 = await addFile('n1.txt', { position: { after: p1.id } })
        const n2 = await addFile('n2.txt', { position: { after: n1.id } })
        await addFile('n3.txt', { position: { after: n2.id } })
        expect(await order()).toEqual(['p1.txt', 'n1.txt', 'n2.txt', 'n3.txt', 'p2.txt'])
      })

      it('only reorders the siblings under the target parent', async () => {
        const g = await group('G')
        const inG = await addFile('p1.txt', { parentId: g.id })
        await addFile('p2.txt')
        await addFile('n1.txt', { parentId: g.id, position: { before: inG.id } })
        expect(await order(g.id)).toEqual(['n1.txt', 'p1.txt'])
        expect(await order()).toEqual(['G', 'p2.txt'])
      })

      it('rejects a position entry under another parent with ENTRY_INVALID_PARENT', async () => {
        const g = await group('G')
        const inG = await addFile('p1.txt', { parentId: g.id })
        await expect(addFile('n1.txt', { position: { after: inG.id } })).rejects.toMatchObject({
          code: 'ENTRY_INVALID_PARENT'
        })
        await expect(
          addFile('n1.txt', { position: { before: 'no-such-entry' } })
        ).rejects.toMatchObject({ code: 'ENTRY_INVALID_PARENT' })
        expect(await order()).toEqual(['G'])
      })
    })

    describe('rejectTemporary', () => {
      const addPath = (p: string, rejectTemporary?: boolean): Promise<WorkspaceEntry> =>
        service.addEntry({
          kind: 'file',
          workspaceId: DEFAULT_WORKSPACE_ID,
          parentId: null,
          path: p,
          ...(rejectTemporary === undefined ? {} : { rejectTemporary })
        })

      it('rejects a file and a folder under the temp directory with ENTRY_TEMPORARY_PATH', async () => {
        await expect(addPath(at('Temp', 'zip-copy', 'f.txt'), true)).rejects.toMatchObject({
          code: 'ENTRY_TEMPORARY_PATH'
        })
        await expect(
          service.addEntry({
            kind: 'folder',
            workspaceId: DEFAULT_WORKSPACE_ID,
            parentId: null,
            path: at('Temp', 'zip-copy'),
            rejectTemporary: true
          })
        ).rejects.toMatchObject({ code: 'ENTRY_TEMPORARY_PATH' })
        expect(await order()).toEqual([])
      })

      it('matches case-insensitively and with forward slashes', async () => {
        const upper = at('Temp', 'zip-copy', 'f.txt').toUpperCase().replaceAll('\\', '/')
        await expect(addPath(upper, true)).rejects.toMatchObject({ code: 'ENTRY_TEMPORARY_PATH' })
      })

      it('rejects a path reached through a directory junction that points into the temp directory', async () => {
        symlinkSync(at('Temp', 'zip-copy'), at('junc'), 'junction')
        await expect(addPath(at('junc', 'f.txt'), true)).rejects.toMatchObject({
          code: 'ENTRY_TEMPORARY_PATH'
        })
        // 不设标志时照常添加
        expect((await addPath(at('junc', 'f.txt'))).label).toBe('f.txt')
      })

      it('does not reject a path whose junction points outside the temp directory', async () => {
        symlinkSync(at('Temp2'), at('junc2'), 'junction')
        expect((await addPath(at('junc2', 'g.txt'), true)).label).toBe('g.txt')
      })

      it('does not reject a sibling directory with the same prefix (Temp2)', async () => {
        const e = await addPath(at('Temp2', 'g.txt'), true)
        expect(e.label).toBe('g.txt')
      })

      it('allows temp paths when rejectTemporary is not set', async () => {
        const e = await addPath(at('Temp', 'zip-copy', 'f.txt'))
        expect(e.label).toBe('f.txt')
      })
    })

    describe('sftp: folders', () => {
      const ID = '3f2a0000-0000-4000-8000-000000000001'
      const sftpStat = vi.fn(async (uri: URL) => ({
        uri: uri.href,
        name: 'opt',
        kind: 'directory' as const,
        size: 0,
        mtime: 0
      }))
      const sftpProvider: FileSystemProvider = {
        scheme: 'sftp',
        stat: sftpStat,
        list: async () => [],
        read: async () => new Uint8Array(),
        createReadStream: async () => {
          throw new Error('unused')
        },
        dispose: async () => undefined
      }
      const addSftp = (uri: string, rejectTemporary?: boolean): Promise<WorkspaceEntry> =>
        service.addEntry({
          kind: 'folder',
          workspaceId: DEFAULT_WORKSPACE_ID,
          parentId: null,
          uri,
          ...(rejectTemporary === undefined ? {} : { rejectTemporary })
        })

      beforeEach(() => {
        sftpStat.mockClear()
        service = new WorkspaceService(
          db,
          new VfsService([new LocalProvider(), sftpProvider]),
          new EventBus<MainEvents>(),
          at('Temp'),
          // 连接 ID 登记了身份 app1；其余连接不存在
          { identities: async (id) => (id === ID ? ['app1'] : null) }
        )
      })

      it('validates through the VFS (stat) and ignores rejectTemporary (only for file:)', async () => {
        const e = await addSftp(`sftp://${ID}/opt/`, true)
        expect(e.uri).toBe(`sftp://${ID}/opt`)
        expect(e.label).toBe('opt')
        expect(sftpStat).toHaveBeenCalledTimes(1)
      })

      it('stores the canonical form (dot segments resolved, segments re-encoded)', async () => {
        const e = await addSftp(`sftp://${ID}/var/../opt/%E6%97%A5%E5%BF%97/`)
        expect(e.uri).toBe(`sftp://${ID}/opt/%E6%97%A5%E5%BF%97`)
      })

      it('propagates CONN_NOT_FOUND from the provider', async () => {
        sftpStat.mockRejectedValueOnce(new AppError({ code: 'CONN_NOT_FOUND' }))
        await expect(addSftp(`sftp://${ID}/opt`)).rejects.toMatchObject({ code: 'CONN_NOT_FOUND' })
        expect(await order()).toEqual([])
      })

      it('rejects an unparsable sftp URI with FS_INVALID_URI', async () => {
        await expect(addSftp('sftp://')).rejects.toMatchObject({ code: 'FS_INVALID_URI' })
        expect(sftpStat).not.toHaveBeenCalled()
      })

      it('R14: rejects remote file entries with FS_UNSUPPORTED_SCHEME before stat', async () => {
        await expect(
          service.addEntry({
            kind: 'file',
            workspaceId: DEFAULT_WORKSPACE_ID,
            parentId: null,
            uri: `sftp://${ID}/etc/hosts`
          })
        ).rejects.toMatchObject({ code: 'FS_UNSUPPORTED_SCHEME' })
        expect(sftpStat).not.toHaveBeenCalled()
        expect(await order()).toEqual([])
      })

      it('accepts a registered identity; rejects an unregistered one with IPC_FORBIDDEN before stat', async () => {
        const e = await addSftp(`sftp://app1@${ID}/opt`)
        expect(e.uri).toBe(`sftp://app1@${ID}/opt`)
        sftpStat.mockClear()
        await expect(addSftp(`sftp://root@${ID}/root`)).rejects.toMatchObject({
          code: 'IPC_FORBIDDEN'
        })
        expect(sftpStat).not.toHaveBeenCalled()
      })

      it('an identity on an unknown connection -> CONN_NOT_FOUND before stat', async () => {
        await expect(addSftp('sftp://app1@nope/opt')).rejects.toMatchObject({
          code: 'CONN_NOT_FOUND'
        })
        expect(sftpStat).not.toHaveBeenCalled()
      })

      it('without the connection lookup injected, identity URIs are rejected (fail closed)', async () => {
        service = new WorkspaceService(
          db,
          new VfsService([new LocalProvider(), sftpProvider]),
          new EventBus<MainEvents>(),
          at('Temp')
        )
        await expect(addSftp(`sftp://app1@${ID}/opt`)).rejects.toMatchObject({
          code: 'IPC_FORBIDDEN'
        })
        expect(sftpStat).not.toHaveBeenCalled()
      })
    })

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

  describe('entries by uri and concurrency', () => {
    it('adds a real directory by uri, labelled with the directory name', async () => {
      const entry = await service.addEntry({
        kind: 'folder',
        workspaceId: DEFAULT_WORKSPACE_ID,
        parentId: null,
        uri: pathToFileURL(at('案件 A', '設計書#1')).href
      })
      expect(entry.label).toBe('設計書#1')
      expect(entry.uri).toBe(pathToFileURL(at('案件 A', '設計書#1')).href)
    })

    it('keeps sortOrder as 0..3 after 4 concurrent moves', async () => {
      const ids = [(await group('a')).id, (await group('b')).id, (await group('c')).id]
      ids.push((await group('d')).id)
      await Promise.all(ids.map((id) => service.moveEntry({ id, parentId: null, index: 0 })))
      const orders = (await snapshot()).map((e) => e.sortOrder).sort()
      expect(orders).toEqual([0, 1, 2, 3])
    })
  })

  describe('cache strategies and index targets', () => {
    const folder = (p: string, parentId: string | null = null): Promise<WorkspaceEntry> =>
      service.addEntry({ kind: 'folder', workspaceId: DEFAULT_WORKSPACE_ID, parentId, path: p })
    const uriOf = (...parts: string[]): string => pathToFileURL(at(...parts)).href

    it('stores a folder URI without a trailing slash (path and uri inputs)', async () => {
      const byPath = await folder(at('work') + path.sep)
      const byUri = await service.addEntry({
        kind: 'folder',
        workspaceId: DEFAULT_WORKSPACE_ID,
        parentId: null,
        uri: uriOf('work', 'a') + '/'
      })
      expect(byPath.uri).toBe(uriOf('work'))
      expect(byUri.uri).toBe(uriOf('work', 'a'))
    })

    it('sets and clears the cache strategy of a folder, emitting workspace.changed', async () => {
      const f = await folder(at('work'))
      expect(f.cacheStrategy).toBeNull()
      events.length = 0
      const set = await service.setCacheStrategy({
        workspaceId: DEFAULT_WORKSPACE_ID,
        entryId: f.id,
        strategy: 'active'
      })
      expect(set.cacheStrategy).toBe('active')
      expect(events).toEqual([{ id: DEFAULT_WORKSPACE_ID }])
      const cleared = await service.setCacheStrategy({
        workspaceId: DEFAULT_WORKSPACE_ID,
        entryId: f.id,
        strategy: null
      })
      expect(cleared.cacheStrategy).toBeNull()
    })

    it('rejects a group or file with ENTRY_KIND_MISMATCH', async () => {
      const g = await group('g')
      const file = await service.addEntry({
        kind: 'file',
        workspaceId: DEFAULT_WORKSPACE_ID,
        parentId: null,
        path: at('x.txt')
      })
      for (const entryId of [g.id, file.id]) {
        await expect(
          service.setCacheStrategy({ workspaceId: DEFAULT_WORKSPACE_ID, entryId, strategy: 'all' })
        ).rejects.toMatchObject({ code: 'ENTRY_KIND_MISMATCH' })
      }
    })

    it('rejects an entry of another workspace with ENTRY_NOT_FOUND', async () => {
      const f = await folder(at('work'))
      const w = await service.create({ name: 'w2' })
      await expect(
        service.setCacheStrategy({ workspaceId: w.id, entryId: f.id, strategy: 'all' })
      ).rejects.toMatchObject({ code: 'ENTRY_NOT_FOUND' })
    })

    it('setIndexTarget is idempotent, normalizes the uri and requires a folder entry above it', async () => {
      await folder(at('work'))
      const target = { workspaceId: DEFAULT_WORKSPACE_ID, uri: uriOf('work', 'a') + '/' }
      await service.setIndexTarget({ ...target, enabled: true })
      await service.setIndexTarget({ ...target, enabled: true })
      expect(await service.listIndexTargets(DEFAULT_WORKSPACE_ID)).toEqual([uriOf('work', 'a')])
      await service.setIndexTarget({ ...target, enabled: false })
      await service.setIndexTarget({ ...target, enabled: false })
      expect(await service.listIndexTargets(DEFAULT_WORKSPACE_ID)).toEqual([])
      await expect(
        service.setIndexTarget({
          workspaceId: DEFAULT_WORKSPACE_ID,
          uri: uriOf('案件 A'),
          enabled: true
        })
      ).rejects.toMatchObject({ code: 'ENTRY_INVALID_PARENT' })
    })

    it('allows the folder entry itself as an index target', async () => {
      await folder(at('work'))
      await service.setIndexTarget({
        workspaceId: DEFAULT_WORKSPACE_ID,
        uri: uriOf('work'),
        enabled: true
      })
      expect(await service.listIndexTargets(DEFAULT_WORKSPACE_ID)).toEqual([uriOf('work')])
    })

    it('removes the index targets below a removed folder, keeping those still covered', async () => {
      const work = await folder(at('work'))
      const a = await folder(at('work', 'a'))
      const other = await folder(at('案件 A'))
      for (const uri of [uriOf('work', 'a'), uriOf('案件 A', '設計書#1')]) {
        await service.setIndexTarget({ workspaceId: DEFAULT_WORKSPACE_ID, uri, enabled: true })
      }
      // work/a 仍由 a 条目覆盖：移除 work 后其下的目标保留
      await service.removeEntry(work.id)
      expect((await service.listIndexTargets(DEFAULT_WORKSPACE_ID)).sort()).toEqual(
        [uriOf('work', 'a'), uriOf('案件 A', '設計書#1')].sort()
      )
      await service.removeEntry(a.id)
      expect(await service.listIndexTargets(DEFAULT_WORKSPACE_ID)).toEqual([
        uriOf('案件 A', '設計書#1')
      ])
      await service.removeEntry(other.id)
      expect(await service.listIndexTargets(DEFAULT_WORKSPACE_ID)).toEqual([])
    })

    it('removing a group removes the targets under its folders', async () => {
      const g = await group('g')
      await folder(at('work'), g.id)
      await service.setIndexTarget({
        workspaceId: DEFAULT_WORKSPACE_ID,
        uri: uriOf('work', 'a'),
        enabled: true
      })
      await service.removeEntry(g.id)
      expect(await service.listIndexTargets(DEFAULT_WORKSPACE_ID)).toEqual([])
    })
  })
})
