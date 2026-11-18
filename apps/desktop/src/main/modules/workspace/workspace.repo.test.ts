import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_ID, type Workspace, type WorkspaceEntry } from '@pch/shared'
import { openDatabase, type Database } from '../../infra/db/client'
import type { Logger } from '../../infra/logger'
import { EntryRepo } from './entry.repo'
import { WorkspaceRepo } from './workspace.repo'

const noop = (): void => undefined
const silent: Logger = { error: noop, warn: noop, info: noop, debug: noop }

const workspace = (id: string): Workspace => ({
  id,
  name: id,
  description: null,
  color: null,
  sortOrder: 1,
  archived: false,
  lastOpenedAt: null,
  createdAt: 1,
  updatedAt: 1
})

const entry = (id: string, over: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({
  id,
  workspaceId: DEFAULT_WORKSPACE_ID,
  parentId: null,
  kind: 'group',
  label: id,
  uri: null,
  sortOrder: 0,
  meta: null,
  createdAt: 1,
  updatedAt: 1,
  ...over
})

describe('workspace repositories (migration 0002)', () => {
  let db: Database
  let workspaces: WorkspaceRepo
  let entries: EntryRepo

  beforeEach(async () => {
    db = await openDatabase(':memory:', silent)
    workspaces = new WorkspaceRepo(db)
    entries = new EntryRepo(db)
  })
  afterEach(async () => {
    await db.destroy()
  })

  it('seeds exactly one default workspace with an empty name', async () => {
    const list = await workspaces.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: DEFAULT_WORKSPACE_ID, name: '', archived: false })
  })

  it('round-trips an entry including JSON meta and non-ASCII text', async () => {
    const e = entry('e1', {
      kind: 'folder',
      label: '設計書',
      uri: 'file:///C:/%E6%A1%88%E4%BB%B6A',
      meta: { note: '設計書' }
    })
    await entries.insert(e)
    expect(await entries.get('e1')).toEqual(e)
  })

  it('reports -1 as the max sort order when there are no siblings', async () => {
    expect(await entries.maxSortOrder(DEFAULT_WORKSPACE_ID, null)).toBe(-1)
    await entries.insert(entry('g1', { sortOrder: 4 }))
    expect(await entries.maxSortOrder(DEFAULT_WORKSPACE_ID, null)).toBe(4)
    expect(await entries.maxSortOrder(DEFAULT_WORKSPACE_ID, 'g1')).toBe(-1)
  })

  it('updates workspace fields including booleans and nullable timestamps', async () => {
    await workspaces.insert(workspace('w1'))
    await workspaces.update('w1', { name: '案件A', archived: true, lastOpenedAt: 42 })
    expect(await workspaces.get('w1')).toMatchObject({
      name: '案件A',
      archived: true,
      lastOpenedAt: 42
    })
  })

  it('cascades entry deletion when a workspace is deleted (foreign keys on)', async () => {
    await workspaces.insert(workspace('w1'))
    await entries.insert(entry('e1', { workspaceId: 'w1' }))
    await workspaces.delete('w1')
    expect(await entries.get('e1')).toBeUndefined()
  })

  it('works inside a transaction', async () => {
    await db.transaction().execute(async (trx) => {
      await new EntryRepo(trx).insert(entry('t1'))
    })
    expect(await entries.get('t1')).toBeDefined()
  })
})
