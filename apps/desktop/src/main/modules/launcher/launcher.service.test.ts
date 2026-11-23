import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError, type FileStat } from '@pch/shared'
import type { Logger } from '../../infra/logger'
import { openDatabase, type Database } from '../../infra/db/client'
import { LaunchCapabilitiesRepo } from './launch-capabilities.repo'
import { LauncherService } from './launcher.service'
import type { RawAssociation } from './association'

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

type RunMock = ReturnType<typeof vi.fn<Run>>

const dbs: Database[] = []
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.destroy()))
})

async function memoryRepo(): Promise<LaunchCapabilitiesRepo> {
  const db = await openDatabase(':memory:', silent)
  dbs.push(db)
  return new LaunchCapabilitiesRepo(db, 'PC-A')
}

async function setup(run: RunMock = vi.fn<Run>(async () => JSON.stringify([EXCEL]))): Promise<{
  service: LauncherService
  run: RunMock
}> {
  const service = new LauncherService({
    run,
    vfs: { stat },
    logger: silent,
    repo: await memoryRepo()
  })
  return { service, run }
}

describe('LauncherService.capabilities', () => {
  it('detects once per extension and caches the result', async () => {
    const { service, run } = await setup()
    const a = await service.capabilities('file:///C:/a/B.XLSX')
    const b = await service.capabilities('file:///C:/other/c.xlsx')
    expect(a.ext).toBe('xlsx')
    expect(a.options.map((o) => o.mode)).toEqual([
      'edit',
      'readOnly',
      'protectedView',
      'newFromFile'
    ])
    expect(b).toBe(a)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[1]).toEqual({ PCH_EXTS: 'xlsx' })
  })

  it('shares one in-flight detection between concurrent calls', async () => {
    const { service, run } = await setup()
    await Promise.all([
      service.capabilities('file:///C:/a.xlsx'),
      service.capabilities('file:///C:/b.xlsx')
    ])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('detects again after redetect()', async () => {
    const { service, run } = await setup()
    await service.capabilities('file:///C:/a.xlsx')
    await service.redetect()
    await service.capabilities('file:///C:/a.xlsx')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('returns empty options without caching the failure when detection fails', async () => {
    const run = vi
      .fn<Run>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(JSON.stringify([EXCEL]))
    const { service } = await setup(run)
    expect(await service.capabilities('file:///C:/a.xlsx')).toEqual({
      ext: 'xlsx',
      appName: null,
      options: [],
      detectFailed: true
    })
    const retried = await service.capabilities('file:///C:/a.xlsx')
    expect(retried.options.length).toBeGreaterThan(0)
    expect(retried.detectFailed).toBeUndefined()
  })

  it('does not flag detectFailed when detection succeeds but the extension has no association', async () => {
    const { service } = await setup(vi.fn<Run>(async () => '[]'))
    expect(await service.capabilities('file:///C:/a.xlsx')).toEqual({
      ext: 'xlsx',
      appName: null,
      options: []
    })
  })

  it('answers an empty result for an extension outside the Office whitelist without running PowerShell', async () => {
    const { service, run } = await setup()
    expect(await service.capabilities('file:///C:/tool/run.bat')).toEqual({
      ext: 'bat',
      appName: null,
      options: []
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects non-file URIs; a file without an extension has no options', async () => {
    const { service, run } = await setup()
    await expect(service.capabilities('ftp://h/a.xlsx')).rejects.toMatchObject({
      code: 'FS_UNSUPPORTED_SCHEME'
    })
    expect((await service.capabilities('file:///C:/README')).options).toEqual([])
    expect(run).not.toHaveBeenCalled()
  })
})

describe('LauncherService.open', () => {
  it('passes path and verb only through the environment; the script has neither path nor Start-Process', async () => {
    const { service, run } = await setup()
    await service.capabilities('file:///C:/a.xlsx')
    run.mockClear()
    const target = 'C:\\work\\見積[1] 案.xlsx'
    await service.open(pathToFileURL(target).href, 'protectedView')
    expect(run).toHaveBeenCalledTimes(1)
    const [script, env, timeout] = run.mock.calls[0] as Parameters<Run>
    expect(env).toEqual({ PCH_TARGET: target, PCH_VERB: 'ViewProtected' })
    expect(timeout).toBe(15_000)
    expect(script).not.toContain('work')
    expect(script).not.toContain('xlsx')
    expect(script).not.toContain('Start-Process')
    expect(script).toContain('ProcessStartInfo')
  })

  it('refuses an executable-class extension with LAUNCH_FAILED without running anything', async () => {
    const { service, run } = await setup()
    for (const name of ['run.bat', 'setup.exe', 'x.ps1', 'noext']) {
      await expect(service.open(`file:///C:/tool/${name}`, 'edit')).rejects.toMatchObject({
        code: 'LAUNCH_FAILED'
      })
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses a directory (only files are launched) without running anything', async () => {
    const run = vi.fn<Run>(async () => JSON.stringify([EXCEL]))
    const service = new LauncherService({
      run,
      vfs: { stat: async (uri) => ({ ...(await stat(uri)), kind: 'directory' }) },
      logger: silent,
      repo: await memoryRepo()
    })
    await expect(service.open('file:///C:/work/folder.xlsx', 'edit')).rejects.toMatchObject({
      code: 'LAUNCH_FAILED'
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('keeps UNC paths as they are', async () => {
    const { service, run } = await setup()
    await service.open('file://server/share/dir/a.xlsx', 'edit')
    expect((run.mock.calls.at(-1)?.[1] as Record<string, string>).PCH_TARGET).toBe(
      '\\\\server\\share\\dir\\a.xlsx'
    )
  })

  it('launches a switch option by exe and arguments through the environment', async () => {
    const { service, run } = await setup()
    await service.open('file:///C:/a.xlsx', 'readOnly')
    const [script, env] = run.mock.calls.at(-1) as Parameters<Run>
    expect(env).toEqual({
      PCH_EXE: 'C:\\Office\\EXCEL.EXE',
      PCH_ARGS: JSON.stringify(['/r', 'C:\\a.xlsx'])
    })
    expect(script).not.toContain('Start-Process')
    expect(script).not.toContain('a.xlsx')
  })

  it('maps a failing run to LAUNCH_FAILED', async () => {
    const { service, run } = await setup()
    await service.capabilities('file:///C:/a.xlsx')
    run.mockRejectedValueOnce(new Error('timeout'))
    await expect(service.open('file:///C:/a.xlsx', 'edit')).rejects.toMatchObject({
      code: 'LAUNCH_FAILED'
    })
  })

  it('fails with LAUNCH_FAILED for a mode the extension does not offer', async () => {
    const { service } = await setup(
      vi.fn<Run>(async () => JSON.stringify([{ ...EXCEL, ext: 'doc', exe: null }]))
    )
    const err = await service.open('file:///C:/a.doc', 'readOnly').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    expect(err).toMatchObject({ code: 'LAUNCH_FAILED' })
  })

  it('does not launch when the file does not exist', async () => {
    const run = vi.fn<Run>(async () => JSON.stringify([EXCEL]))
    const missing = new LauncherService({
      run,
      vfs: {
        stat: async () => {
          throw new AppError({ code: 'FS_NOT_FOUND' })
        }
      },
      logger: silent,
      repo: await memoryRepo()
    })
    await expect(missing.open('file:///C:/gone.xlsx', 'edit')).rejects.toMatchObject({
      code: 'FS_NOT_FOUND'
    })
    expect(run).not.toHaveBeenCalled()
  })
})
