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
  refresh: () => void
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
  const refreshListeners = new Set<() => void>()
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
    onRefresh: (listener) => {
      refreshListeners.add(listener)
      return () => refreshListeners.delete(listener)
    },
    doc: {} as PreviewHostDeps['doc'],
    web: {} as PreviewHostDeps['web'],
    viewer: {
      candidates: () => [
        { id: 'pch.preview.html', name: 'HTML', current: true },
        { id: 'pch.preview.text', name: 'Text', current: false }
      ],
      set: vi.fn(),
      selected: vi.fn(() => null)
    },
    tabs: { open: vi.fn(), navigate: vi.fn() },
    confirmExecutable: vi.fn(async () => false),
    notify: vi.fn(),
    t: (key, vars) => (vars ? `${key}${JSON.stringify(vars)}` : key),
    pluginT: (key) => `plugin:${key}`,
    language: 'ja',
    theme: 'dark',
    settings: { 'explorer.showHiddenFiles': true },
    connectionNames: { ID: 'AP1' },
    parent: { uri: 'file:///C:/%E6%A1%88%E4%BB%B6', kind: 'directory', title: '案件' },
    roots: [
      'file:///C:/%E6%A1%88%E4%BB%B6',
      'file:///C:/%E6%A1%88%E4%BB%B6/%E8%A8%AD%E8%A8%88%E6%9B%B8'
    ],
    ...overrides
  }
  const emit = (uri: string): void => listeners.forEach((l) => l(uri))
  const refresh = (): void => refreshListeners.forEach((l) => l())
  return { host: createPreviewHost(deps), deps, calls, emit, refresh }
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
})

describe('createPreviewHost: launcher', () => {
  const caps = { ext: 'xlsx', appName: 'Microsoft Excel', options: [] }

  it('getLaunchCapabilities returns the detected capabilities', async () => {
    const invoke = vi.fn(async () => caps) as unknown as PreviewHostDeps['invoke']
    const { host } = setup({ invoke })
    await expect(host.system.getLaunchCapabilities(TXT)).resolves.toEqual(caps)
    expect(invoke).toHaveBeenCalledWith('launcher.capabilities', { uri: TXT })
  })

  it('getLaunchCapabilities notifies and returns null on failure', async () => {
    const invoke = vi.fn(async () => {
      throw new AppError({ code: 'FS_UNSUPPORTED_SCHEME' })
    }) as unknown as PreviewHostDeps['invoke']
    const { host, deps } = setup({ invoke })
    await expect(host.system.getLaunchCapabilities(TXT)).resolves.toBeNull()
    expect(deps.notify).toHaveBeenCalledWith('errors:FS_UNSUPPORTED_SCHEME', 'error')
  })

  it('launch calls launcher.open and does not reject on failure', async () => {
    const { host, calls } = setup()
    await host.system.launch(TXT, 'readOnly')
    expect(calls).toEqual([['launcher.open', { uri: TXT, mode: 'readOnly' }]])

    const invoke = vi.fn(async () => {
      throw new AppError({ code: 'LAUNCH_FAILED' })
    }) as unknown as PreviewHostDeps['invoke']
    const failing = setup({ invoke })
    await expect(failing.host.system.launch(TXT, 'edit')).resolves.toBeUndefined()
    expect(failing.deps.notify).toHaveBeenCalledWith('errors:LAUNCH_FAILED', 'error')
  })

  it('redetectLaunchCapabilities calls launcher.redetect', async () => {
    const { host, calls } = setup()
    await host.system.redetectLaunchCapabilities()
    expect(calls).toEqual([['launcher.redetect', undefined]])
  })
})

const PLUGIN = { source: 'plugin' }

describe('createPreviewHost: tabs', () => {
  it('navigate replaces the current tab with the stat of the target', async () => {
    const { host, deps } = setup()
    host.tabs.navigate(DIR)
    await flush()
    expect(deps.tabs.navigate).toHaveBeenCalledWith(
      'tab-1',
      {
        uri: DIR,
        kind: 'directory',
        title: '設計書'
      },
      PLUGIN
    )
  })

  it('navigate with a kind hint from the plugin skips the stat', async () => {
    const { host, deps, calls } = setup()
    host.tabs.navigate(DIR, 'directory')
    await flush()
    expect(calls.filter(([c]) => c === 'vfs.stat')).toEqual([])
    expect(deps.tabs.navigate).toHaveBeenCalledWith(
      'tab-1',
      {
        uri: DIR,
        kind: 'directory',
        title: '設計書'
      },
      PLUGIN
    )
    // 驱动器根：标题为盘符
    host.tabs.navigate('file:///C:/', 'directory')
    await flush()
    expect(deps.tabs.navigate).toHaveBeenLastCalledWith(
      'tab-1',
      {
        uri: 'file:///C:/',
        kind: 'directory',
        title: 'C:'
      },
      PLUGIN
    )
  })

  it('open adds a new tab in the workspace (there are no preview tabs)', async () => {
    const { host, deps } = setup()
    host.tabs.open(TXT)
    host.tabs.open(DIR)
    await flush()
    expect(deps.tabs.open).toHaveBeenCalledWith(
      'ws',
      { uri: TXT, kind: 'file', title: 'memo.txt' },
      PLUGIN
    )
    expect(deps.tabs.open).toHaveBeenCalledWith(
      'ws',
      {
        uri: DIR,
        kind: 'directory',
        title: '設計書'
      },
      PLUGIN
    )
  })

  it('navigate with a file kind opens the file in the current tab without a stat', async () => {
    const { host, deps, calls } = setup()
    host.tabs.navigate(TXT, 'file')
    await flush()
    expect(calls.filter(([c]) => c === 'vfs.stat')).toEqual([])
    expect(deps.tabs.navigate).toHaveBeenCalledWith(
      'tab-1',
      {
        uri: TXT,
        kind: 'file',
        title: 'memo.txt'
      },
      PLUGIN
    )
  })

  it('up navigates the tab to the parent location given by the container (no stat)', () => {
    const { host, deps, calls } = setup()
    host.tabs.up()
    expect(deps.tabs.navigate).toHaveBeenCalledWith('tab-1', {
      uri: 'file:///C:/%E6%A1%88%E4%BB%B6',
      kind: 'directory',
      title: '案件'
    })
    expect(calls).toEqual([])
  })

  it('up does nothing without a parent location (the workspace overview)', () => {
    const { host, deps } = setup({ parent: null })
    host.tabs.up()
    expect(deps.tabs.navigate).not.toHaveBeenCalled()
  })

  it('onRefresh relays the refresh requests of this tab (address bar / F5) and can be cancelled', () => {
    const { host, refresh } = setup()
    const onRefresh = vi.fn()
    const off = host.tabs.onRefresh(onRefresh)
    refresh()
    expect(onRefresh).toHaveBeenCalledTimes(1)
    off()
    refresh()
    expect(onRefresh).toHaveBeenCalledTimes(1)
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

  it('refresh asks the data layer to re-check the directory', async () => {
    const { host, deps } = setup()
    await host.fs.refresh(DIR)
    expect(deps.refreshDirectory).toHaveBeenCalledWith(DIR)
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

  it('also describes a bare error code (DocProgress.error); unknown strings are UNKNOWN', () => {
    const { host } = setup()
    expect(host.i18n.describeError('FS_TIMEOUT')).toBe('errors:FS_TIMEOUT')
    expect(host.i18n.describeError('not a code')).toBe('errors:UNKNOWN')
  })

  it('shows Windows paths, <connection>:<path> for remote resources and falls back to the URI', () => {
    const { host } = setup()
    expect(host.fs.toDisplayPath(TXT)).toBe('C:\\案件\\memo.txt')
    expect(host.fs.toDisplayPath('sftp://ID/home/pchuser/a%20b.log')).toBe(
      'AP1:/home/pchuser/a b.log'
    )
    expect(host.fs.toDisplayPath('sftp://app1@ID/opt')).toBe('app1@AP1:/opt')
    expect(host.fs.toDisplayPath('https://example.com/')).toBe('https://example.com/')
  })

  it('isLocal: only file: resources support system actions', () => {
    const { host } = setup()
    expect(host.fs.isLocal(TXT)).toBe(true)
    expect(host.fs.isLocal('sftp://ID/home/pchuser/app.log')).toBe(false)
  })

  it('copies the absolute server path of a remote resource', async () => {
    const { host, calls, deps } = setup()
    await host.system.copyPath('sftp://app1@ID/opt/a%20b')
    expect(calls).toEqual([['system.copyText', { text: '/opt/a b' }]])
    expect(deps.notify).toHaveBeenCalledWith('preview:copiedPath', 'success')
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

describe('createPreviewHost: viewer / doc', () => {
  it('lists the candidates given by the container', () => {
    const { host } = setup()
    expect(host.tabs.candidates().map((c) => c.id)).toEqual([
      'pch.preview.html',
      'pch.preview.text'
    ])
  })

  it('reports the viewer chosen for the tab at call time (null while automatic)', () => {
    let chosen: string | null = null
    const { host } = setup({
      viewer: { candidates: () => [], set: vi.fn(), selected: () => chosen }
    })
    expect(host.tabs.selectedViewer()).toBeNull()
    chosen = 'pch.preview.fallback'
    expect(host.tabs.selectedViewer()).toBe('pch.preview.fallback')
  })

  it('switches only to a candidate', () => {
    const { host, deps } = setup()
    host.tabs.viewWith('pch.preview.office')
    expect(deps.viewer.set).not.toHaveBeenCalled()
    host.tabs.viewWith('pch.preview.text')
    expect(deps.viewer.set).toHaveBeenCalledWith('pch.preview.text')
  })

  it('exposes the document API given by the container as is (stable across host rebuilds)', () => {
    const { host, deps } = setup()
    expect(host.doc).toBe(deps.doc)
  })
})
