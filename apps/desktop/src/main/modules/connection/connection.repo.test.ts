import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import type { Logger } from '../../infra/logger'
import { openDatabase, type Database } from '../../infra/db/client'
import { ConnectionRepo, type ConnectionRecord } from './connection.repo'

const noop = (): void => undefined
const silent: Logger = { error: noop, warn: noop, info: noop, debug: noop }

const dbs: Database[] = []
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.destroy()))
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
async function open(file = ':memory:'): Promise<Database> {
  const db = await openDatabase(file, silent)
  dbs.push(db)
  return db
}

const sample = (over: Partial<ConnectionRecord> = {}): ConnectionRecord => ({
  id: 'c1',
  name: 'prod',
  host: 'example.com',
  port: 22,
  username: 'ops',
  auth: 'key',
  keyPath: '/home/ops/.ssh/id_ed25519',
  secret: 'ZW5jLXNlY3JldA==',
  sudoSecret: 'c3Vkbw==',
  identities: ['root', 'app'],
  hostKey: { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:abc' },
  sftpServerPath: '/usr/lib/sftp-server',
  authState: 'ok',
  createdAt: 100,
  updatedAt: 200,
  ...over
})

describe('ConnectionRepo', () => {
  it('round-trips all fields', async () => {
    const repo = new ConnectionRepo(await open())
    const r = sample()
    await repo.insert(r)
    expect(await repo.get('c1')).toEqual(r)
    expect(await repo.list()).toEqual([r])
  })

  it('round-trips nulls', async () => {
    const repo = new ConnectionRepo(await open())
    const r = sample({
      auth: 'password',
      keyPath: null,
      secret: null,
      sudoSecret: null,
      identities: [],
      hostKey: null,
      sftpServerPath: null
    })
    await repo.insert(r)
    expect(await repo.get('c1')).toEqual(r)
  })

  it('update patches only given fields and bumps nothing else', async () => {
    const repo = new ConnectionRepo(await open())
    await repo.insert(sample())
    await repo.update('c1', { name: 'x', sftpServerPath: null, keyPath: null, updatedAt: 300 })
    expect(await repo.get('c1')).toEqual(
      sample({ name: 'x', sftpServerPath: null, keyPath: null, updatedAt: 300 })
    )
  })

  it('setHostKey sets and clears', async () => {
    const repo = new ConnectionRepo(await open())
    await repo.insert(sample({ hostKey: null }))
    const key = { algorithm: 'ssh-rsa', fingerprint: 'SHA256:z' }
    await repo.setHostKey('c1', key)
    expect((await repo.get('c1'))?.hostKey).toEqual(key)
    await repo.setHostKey('c1', null)
    expect((await repo.get('c1'))?.hostKey).toBeNull()
  })

  it('delete removes the row', async () => {
    const repo = new ConnectionRepo(await open())
    await repo.insert(sample())
    await repo.delete('c1')
    expect(await repo.get('c1')).toBeUndefined()
  })

  it('persists authState across reopening the same db file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pch-conn-'))
    dirs.push(dir)
    const file = path.join(dir, 'db.sqlite')
    const db1 = await open(file)
    await new ConnectionRepo(db1).insert(sample())
    await new ConnectionRepo(db1).setAuthState('c1', 'sudo-auth-failed')
    await db1.destroy()
    dbs.splice(dbs.indexOf(db1), 1)

    const db2 = await open(file)
    expect((await new ConnectionRepo(db2).get('c1'))?.authState).toBe('sudo-auth-failed')
  })

  it('defaults auth_state to ok and leaves older tables intact', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pch-conn-'))
    dirs.push(dir)
    const file = path.join(dir, 'db.sqlite')
    const db1 = await open(file)
    await sql`insert into workspaces (id, name, sort_order, archived, created_at, updated_at) values ('w', 'W', 0, 0, 1, 1)`.execute(
      db1
    )
    await sql`insert into connections (id, name, host, port, username, auth, identities, options, created_at, updated_at) values ('d', 'n', 'h', 22, 'u', 'password', '[]', '{"sftpServerPath":null}', 1, 1)`.execute(
      db1
    )
    expect((await new ConnectionRepo(db1).get('d'))?.authState).toBe('ok')
    await db1.destroy()
    dbs.splice(dbs.indexOf(db1), 1)

    const db2 = await open(file)
    const rows = await db2.selectFrom('workspaces').select('name').where('id', '=', 'w').execute()
    expect(rows).toEqual([{ name: 'W' }])
  })
})
