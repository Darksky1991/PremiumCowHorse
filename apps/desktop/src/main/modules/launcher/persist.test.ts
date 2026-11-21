import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileStat } from '@pch/shared'
import type { Logger } from '../../infra/logger'
import { openDatabase, type Database } from '../../infra/db/client'
import type { RawAssociation } from './association'
import { LaunchCapabilitiesRepo } from './launch-capabilities.repo'
import { LauncherService } from './launcher.service'

const noop = (): void => undefined
const silent: Logger = { error: noop, warn: noop, info: noop, debug: noop }

const EXCEL: RawAssociation = {
  ext: 'xlsx',
  progId: 'Excel.Sheet.12',
  defaultVerb: 'Open',
  verbs: ['Open', 'New', 'ViewProtected'],
  appName: 'Microsoft Excel',
  exe: 'C:\\Office\\EXCEL.EXE'
}
const stat = async (uri: string): Promise<FileStat> => ({
  uri,
  name: 'x',
  kind: 'file',
  size: 1,
  mtime: 0
})

type Run = (script: string, env: Record<string, string>, timeoutMs: number) => Promise<string>

const dbs: Database[] = []
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.destroy()))
})

async function memoryDb(): Promise<Database> {
  const db = await openDatabase(':memory:', silent)
  dbs.push(db)
  return db
}

function serviceOn(db: Database, run: Run, machine = 'PC-A'): LauncherService {
  return new LauncherService({
    run,
    vfs: { stat },
    logger: silent,
    repo: new LaunchCapabilitiesRepo(db, machine)
  })
}

const excelRun = (): ReturnType<typeof vi.fn<Run>> =>
  vi.fn<Run>(async () => JSON.stringify([EXCEL]))

describe('LauncherService persistence', () => {
  it('uses the saved result after a restart (new instance, same database) without detecting', async () => {
    const db = await memoryDb()
    const first = await serviceOn(db, excelRun()).capabilities('file:///C:/a.xlsx')
    const run2 = vi.fn<Run>(async () => '[]')
    expect(await serviceOn(db, run2).capabilities('file:///C:/b.xlsx')).toEqual(first)
    expect(run2).not.toHaveBeenCalled()
  })

  it('saves a successful detection that found no option (does not detect again)', async () => {
    const db = await memoryDb()
    const run = vi.fn<Run>(async () => '[]')
    expect((await serviceOn(db, run).capabilities('file:///C:/a.xyz')).options).toEqual([])
    const run2 = vi.fn<Run>(async () => '[]')
    expect((await serviceOn(db, run2).capabilities('file:///C:/b.xyz')).options).toEqual([])
    expect(run2).not.toHaveBeenCalled()
  })

  it('does not save a failed detection', async () => {
    const db = await memoryDb()
    const run = vi.fn<Run>().mockRejectedValue(new Error('boom'))
    await serviceOn(db, run).capabilities('file:///C:/a.xlsx')
    expect(await db.selectFrom('launch_capabilities').selectAll().execute()).toEqual([])
  })

  it('redetect() clears the database; the next query detects and saves again', async () => {
    const db = await memoryDb()
    const run = excelRun()
    const service = serviceOn(db, run)
    await service.capabilities('file:///C:/a.xlsx')
    await service.redetect()
    expect(await db.selectFrom('launch_capabilities').selectAll().execute()).toEqual([])
    await service.capabilities('file:///C:/a.xlsx')
    expect(run).toHaveBeenCalledTimes(2)
    expect(await db.selectFrom('launch_capabilities').select('ext').execute()).toEqual([
      { ext: 'xlsx' }
    ])
  })

  it('ignores a dirty row and detects again (overwriting it)', async () => {
    const db = await memoryDb()
    const dirtyRows = [
      'not json',
      '{"ext":"xlsx"}',
      '{"ext":"docx","appName":null,"options":[]}',
      '{"ext":"xlsx","appName":null,"options":[{"mode":"nope","via":{"type":"verb","verb":"x"}}]}'
    ]
    for (const data of dirtyRows) {
      await db
        .replaceInto('launch_capabilities')
        .values({ machine: 'PC-A', ext: 'xlsx', data, detected_at: 1 })
        .execute()
      const run = excelRun()
      const caps = await serviceOn(db, run).capabilities('file:///C:/a.xlsx')
      expect(caps.options.length).toBe(4)
      expect(run).toHaveBeenCalledTimes(1)
    }
    const saved = await db.selectFrom('launch_capabilities').select('data').execute()
    expect(JSON.parse(saved[0]?.data ?? '')).toMatchObject({
      ext: 'xlsx',
      appName: 'Microsoft Excel'
    })
  })

  it('does not write a result whose detection was overtaken by redetect()', async () => {
    const db = await memoryDb()
    let release: (v: string) => void = noop
    const run = vi.fn<Run>(() => new Promise<string>((r) => (release = r)))
    const service = serviceOn(db, run)
    const inflight = service.capabilities('file:///C:/a.xlsx')
    await vi.waitFor(() => expect(run).toHaveBeenCalled())
    await service.redetect()
    release(JSON.stringify([EXCEL]))
    await inflight
    expect(await db.selectFrom('launch_capabilities').selectAll().execute()).toEqual([])
  })

  it('does not use a result saved by another machine (roaming profile); saves its own next to it', async () => {
    const db = await memoryDb()
    await serviceOn(db, excelRun(), 'PC-A').capabilities('file:///C:/a.xlsx')
    const runB = vi.fn<Run>(async () => '[]')
    const onB = await serviceOn(db, runB, 'PC-B').capabilities('file:///C:/a.xlsx')
    expect(runB).toHaveBeenCalledTimes(1)
    expect(onB.options).toEqual([])
    const rows = await db
      .selectFrom('launch_capabilities')
      .select(['machine', 'ext'])
      .orderBy('machine')
      .execute()
    expect(rows).toEqual([
      { machine: 'PC-A', ext: 'xlsx' },
      { machine: 'PC-B', ext: 'xlsx' }
    ])
    // A 上仍用 A 自己的结果
    const runA = vi.fn<Run>(async () => '[]')
    expect(
      (await serviceOn(db, runA, 'PC-A').capabilities('file:///C:/b.xlsx')).options.length
    ).toBe(4)
    expect(runA).not.toHaveBeenCalled()
  })

  it('redetect() clears only the rows of this machine', async () => {
    const db = await memoryDb()
    await serviceOn(db, excelRun(), 'PC-A').capabilities('file:///C:/a.xlsx')
    const onB = serviceOn(db, excelRun(), 'PC-B')
    await onB.capabilities('file:///C:/a.xlsx')
    await onB.redetect()
    expect(await db.selectFrom('launch_capabilities').select(['machine', 'ext']).execute()).toEqual(
      [{ machine: 'PC-A', ext: 'xlsx' }]
    )
  })
})
