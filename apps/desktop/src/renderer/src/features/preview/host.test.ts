import { describe, expect, it, vi } from 'vitest'
import type { PreviewHost } from '@pch/plugin-sdk'
import { AppError, type FileStat, type IpcChannel } from '@pch/shared'
import { createPreviewHost, type PreviewHostDeps } from './host'

const TXT = 'file:///C:/%E6%A1%88%E4%BB%B6/memo.txt'
const BAT = 'file:///C:/%E6%A1%88%E4%BB%B6/run.BAT'
const DIR = 'file:///C:/%E6%A1%88%E4%BB%B6/%E8%A8%AD%E8%A8%88%E6%9B%B8'

function setup(overrides: Partial<PreviewHostDeps> = {}): {
  host: PreviewHost
  deps: PreviewHostDeps
  calls: Array<[IpcChannel, unknown]>
  emit: (uri: string) => void
} {
  const calls: Array<[IpcChannel, unknown]> = []
  const stats: Record<string, FileStat> = {
    [DIR]: { uri: DIR, name: '設計書', kind: 'directory', size: 0, mtime: 1 },
    [TXT]: { uri: TXT, name: 'memo.txt', kind: 'file', size: 4, mtime: 2 }
  }
  const invoke = vi.fn(async (channel: IpcChannel, input: unknown) => {
    calls.push([channel, input])
    if (channel === 'vfs.stat') {
      const stat = stats[(input as { uri: string }).uri]
      if (!stat) throw new AppError({ code: 'FS_NOT_FOUND' })
      return stat
    }
    return undefined
  }) as unknown as PreviewHostDeps['invoke']
  const listeners = new Set<(uri: string) => void>()
  const deps: PreviewHostDeps = {
    tabId: 'tab-1',
    workspaceId: 'ws',
    invoke,
    listDirectory: vi.fn(async () => ({ items: [], state: 'fresh' as const, checkedAt: 1 })),
    refreshDirectory: vi.fn(async () => undefined),
    isOffline: () => false,
    onVfsChanged: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    tabs: { open: vi.fn(), navigate: vi.fn(), promote: vi.fn() },
    confirmExecutable: vi.fn(async () => false),
    notify: vi.fn(),
    t: (key, vars) => (vars ? `${key}${JSON.stringify(vars)}` : key),
    pluginT: (key) => `plugin:${key}`,
    language: 'ja',
    theme: 'dark',
    settings: { 'explorer.showHiddenFiles': true },
    roots: [
      'file:///C:/%E6%A1%88%E4%BB%B6',
      'file:///C:/%E6%A1%88%E4%BB%B6/%E8%A8%AD%E8%A8%88%E6%9B%B8'
    ],
    ...overrides
  }
  const emit = (uri: string): void => listeners.forEach((l) => l(uri))
  return { host: createPreviewHost(deps), deps, calls, emit }
}

/** 宿主内部的异步动作（void 调用）完成 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('createPreviewHost: system', () => {
  it('asks before opening an executable; cancelling does not open', async () => {
    const { host, deps, calls } = setup()
    await host.system.openWithSystem(BAT)
    expect(deps.confirmExecutable).toHaveBeenCalledWith('run.BAT')
    expect(calls.filter(([c]) => c === 'system.openPath')).toEqual([])
  })

  it('opens an executable after confirmation', async () => {
    const { host, calls } = setup({ confirmExecutable: vi.fn(async () => true) })
    await host.system.openWithSystem(BAT)
    expect(calls).toContainEqual(['system.openPath', { uri: BAT }])
  })

  it('opens other files without asking', async () => {
    const { host, deps, calls } = setup()
    await host.system.openWithSystem(TXT)
    expect(deps.confirmExecutable).not.toHaveBeenCalled()
    expect(calls).toEqual([['system.openPath', { uri: TXT }]])
  })

  it('reports a failure with the error code instead of rejecting', async () => {
    const invoke = vi.fn(async () => {
      throw new AppError({ code: 'FS_NOT_FOUND' })
    }) as unknown as PreviewHostDeps['invoke']
    const { host, deps } = setup({ invoke })
    await expect(host.system.openWithSystem(TXT)).resolves.toBeUndefined()
    expect(deps.notify).toHaveBeenCalledWith('errors:FS_NOT_FOUND', 'error')
  })

  it('copies the Windows path and confirms with a toast', async () => {
    const { host, deps, calls } = setup()
    await host.system.copyPath(TXT)
    expect(calls).toEqual([['system.copyText', { text: 'C:\\案件\\memo.txt' }]])
    expect(deps.notify).toHaveBeenCalledWith('preview:copiedPath', 'success')
  })

  it('reveals in the OS', async () => {
    const { host, calls } = setup()
    host.system.revealInOs(TXT)
    await flush()
    expect(calls).toEqual([['system.revealInOs', { uri: TXT }]])
  })

  it('treats every action as an interaction that promotes the preview tab', async () => {
    const { host, deps } = setup()
    host.system.revealInOs(TXT)
    await host.system.copyPath(TXT)
    await host.system.openWithSystem(TXT)
    host.tabs.navigate(DIR)
    host.tabs.open(TXT)
    await flush()
    expect(deps.tabs.promote).toHaveBeenCalledTimes(5)
    expect(deps.tabs.promote).toHaveBeenCalledWith('tab-1')
  })
})

describe('createPreviewHost: tabs', () => {
  it('navigate replaces the current tab with the stat of the target', async () => {
    const { host, deps } = setup()
    host.tabs.navigate(DIR)
    await flush()
    expect(deps.tabs.navigate).toHaveBeenCalledWith('tab-1', {
      uri: DIR,
      kind: 'directory',
      title: '設計書'
    })
  })

  it('navigate with a kind hint from the plugin skips the stat', async () => {
    const { host, deps, calls } = setup()
    host.tabs.navigate(DIR, 'directory')
    await flush()
    expect(calls.filter(([c]) => c === 'vfs.stat')).toEqual([])
    expect(deps.tabs.navigate).toHaveBeenCalledWith('tab-1', {
      uri: DIR,
      kind: 'directory',
      title: '設計書'
    })
    expect(deps.tabs.promote).toHaveBeenCalledWith('tab-1')
    // 驱动器根：标题为盘符
    host.tabs.navigate('file:///C:/', 'directory')
    await flush()
    expect(deps.tabs.navigate).toHaveBeenLastCalledWith('tab-1', {
      uri: 'file:///C:/',
      kind: 'directory',
      title: 'C:'
    })
  })

  it('open adds a tab in the workspace (permanent unless preview is asked)', async () => {
    const { host, deps } = setup()
    host.tabs.open(TXT)
    host.tabs.open(DIR, { preview: true })
    await flush()
    expect(deps.tabs.open).toHaveBeenCalledWith('ws', {
      uri: TXT,
      kind: 'file',
      title: 'memo.txt',
      preview: false
    })
    expect(deps.tabs.open).toHaveBeenCalledWith('ws', {
      uri: DIR,
      kind: 'directory',
      title: '設計書',
      preview: true
    })
  })

  it('reports a target that cannot be read and opens nothing', async () => {
    const { host, deps } = setup()
    host.tabs.open('file:///C:/missing.txt')
    await flush()
    expect(deps.tabs.open).not.toHaveBeenCalled()
    expect(deps.notify).toHaveBeenCalledWith('errors:FS_NOT_FOUND', 'error')
  })
})

describe('createPreviewHost: fs, i18n and settings', () => {
  it('subscribe filters vfs.changed by URI and can be cancelled', () => {
    const { host, emit } = setup()
    const onChange = vi.fn()
    const off = host.fs.subscribe(DIR, onChange)
    emit(TXT)
    expect(onChange).not.toHaveBeenCalled()
    emit(DIR)
    expect(onChange).toHaveBeenCalledTimes(1)
    off()
    emit(DIR)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('list and stat go through the data layer', async () => {
    const { host, deps } = setup()
    await expect(host.fs.list(DIR)).resolves.toEqual({ items: [], state: 'fresh', checkedAt: 1 })
    expect(deps.listDirectory).toHaveBeenCalledWith(DIR)
    await expect(host.fs.stat(TXT)).resolves.toMatchObject({ name: 'memo.txt' })
  })

  it('list reports offline while the share is disconnected in the reachability store', async () => {
    const { host } = setup({ isOffline: (uri) => uri === DIR })
    await expect(host.fs.list(DIR)).resolves.toEqual({ items: [], state: 'offline', checkedAt: 1 })
    await expect(host.fs.list(`${DIR}x`)).resolves.toMatchObject({ state: 'fresh' })
  })

  it('refresh asks the data layer to re-check the directory and is not an interaction', async () => {
    const { host, deps } = setup()
    await host.fs.refresh(DIR)
    expect(deps.refreshDirectory).toHaveBeenCalledWith(DIR)
    expect(deps.tabs.promote).not.toHaveBeenCalled()
  })

  it('rootOf returns the innermost folder entry containing the URI', () => {
    const { host } = setup()
    expect(host.fs.rootOf(`${DIR}/v1`)).toBe(DIR)
    expect(host.fs.rootOf(DIR)).toBe(DIR)
    expect(host.fs.rootOf(TXT)).toBe('file:///C:/%E6%A1%88%E4%BB%B6')
    // 前缀相同但不是子目录
    expect(host.fs.rootOf('file:///C:/%E6%A1%88%E4%BB%B6x')).toBeNull()
    expect(host.fs.rootOf('file:///D:/x')).toBeNull()
  })

  it('describes errors with the application messages of their codes', () => {
    const { host } = setup()
    expect(host.i18n.describeError(new AppError({ code: 'FS_NOT_FOUND' }))).toBe(
      'errors:FS_NOT_FOUND'
    )
    expect(host.i18n.describeError(new Error('x'))).toBe('errors:UNKNOWN')
  })

  it('shows Windows paths and falls back to the URI', () => {
    const { host } = setup()
    expect(host.fs.toDisplayPath(TXT)).toBe('C:\\案件\\memo.txt')
    expect(host.fs.toDisplayPath('sftp://h/x')).toBe('sftp://h/x')
  })

  it('exposes plugin translations, language, theme and read-only settings', () => {
    const { host } = setup()
    expect(host.i18n.t('name')).toBe('plugin:name')
    expect(host.i18n.language).toBe('ja')
    expect(host.theme.mode).toBe('dark')
    expect(host.settings.get('explorer.showHiddenFiles')).toBe(true)
  })

  it('reads only the settings declared in the SDK', () => {
    const settings = { 'explorer.showHiddenFiles': false, 'general.language': 'ja' }
    const { host } = setup({ settings })
    expect(host.settings.get('explorer.showHiddenFiles')).toBe(false)
    expect(host.settings.get('general.language' as 'explorer.showHiddenFiles')).toBeUndefined()
  })
})
