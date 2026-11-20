import { beforeEach, describe, expect, it, vi } from 'vitest'

// electron 的假实现：记录 web-contents-created 的监听，会话按分区名返回固定对象
const electron = vi.hoisted(() => {
  const sessions = new Map<string, object>()
  const listeners: Array<(event: unknown, contents: unknown) => void> = []
  return {
    listeners,
    defaultSession: { setPermissionRequestHandler: (): void => undefined },
    fromPartition: (partition: string): object => {
      let s = sessions.get(partition)
      if (!s) {
        s = { partition }
        sessions.set(partition, s)
      }
      return s
    }
  }
})
vi.mock('electron', () => ({
  app: {
    on: (_event: string, listener: (event: unknown, contents: unknown) => void) =>
      electron.listeners.push(listener)
  },
  session: { defaultSession: electron.defaultSession, fromPartition: electron.fromPartition },
  shell: { openExternal: vi.fn(async () => undefined) },
  // web-session.ts 在调用时才用到的导出
  BrowserWindow: {},
  WebContentsView: class {},
  webContents: {}
}))

import { WEB_PARTITION } from '../modules/web/web-session'
import { applySecurityPolicies } from './security'

/** 新建的 webContents（只记录施加了哪些处理） */
function contentsIn(session: object): {
  contents: object
  windowOpen: boolean
  navigate: boolean
} {
  const result = { contents: {}, windowOpen: false, navigate: false }
  result.contents = {
    session,
    on: (event: string) => {
      if (event === 'will-navigate') result.navigate = true
    },
    setWindowOpenHandler: () => {
      result.windowOpen = true
    }
  }
  return result
}

describe('applySecurityPolicies', () => {
  const noop = (): void => undefined
  beforeEach(() => {
    electron.listeners.length = 0
    applySecurityPolicies('app://renderer/', {
      error: noop,
      warn: noop,
      info: noop,
      debug: noop
    })
  })
  const created = (session: object): ReturnType<typeof contentsIn> => {
    const c = contentsIn(session)
    for (const l of electron.listeners) l({}, c.contents)
    return c
  }

  it('applies the navigation / window.open limits to the default session', () => {
    expect(created(electron.defaultSession)).toMatchObject({ windowOpen: true, navigate: true })
  })

  it('skips only the browser views (persist:pch-web), which apply their own handlers', () => {
    expect(created(electron.fromPartition(WEB_PARTITION))).toMatchObject({
      windowOpen: false,
      navigate: false
    })
  })

  it('still applies the limits to any other session', () => {
    expect(created(electron.fromPartition('persist:other'))).toMatchObject({
      windowOpen: true,
      navigate: true
    })
  })
})
