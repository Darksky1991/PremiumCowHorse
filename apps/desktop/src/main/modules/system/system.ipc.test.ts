import { describe, expect, it, vi } from 'vitest'
import { ipcContract } from '@pch/shared'

// electron 在单元测试中不可用：只需要 app.getName / getVersion 等
vi.mock('electron', () => ({
  app: { getName: () => 'PremiumCowHorse', getVersion: () => '0.1.0' },
  BrowserWindow: {},
  clipboard: {},
  dialog: {},
  shell: {},
  webContents: {}
}))

const { systemHandlers } = await import('./system.ipc')

const ctx = { senderId: 1 }
const paths = { userData: 'C:/data/PCH', logs: 'C:/data/PCH/logs' }

function setup(): {
  handlers: ReturnType<typeof systemHandlers>
  openPath: ReturnType<typeof vi.fn>
} {
  const openPath = vi.fn(async () => '')
  const handlers = systemHandlers({} as never, {} as never, paths as never, { openPath } as never)
  return { handlers, openPath }
}

describe('system.openAppFolder', () => {
  it('logs 以 paths.logs、userData 以 paths.userData 调用 openPath', async () => {
    const { handlers, openPath } = setup()
    await handlers['system.openAppFolder']({ which: 'logs' }, ctx)
    await handlers['system.openAppFolder']({ which: 'userData' }, ctx)
    expect(openPath.mock.calls).toEqual([[paths.logs], [paths.userData]])
  })

  it('openPath 返回错误文字时抛出 UNKNOWN', async () => {
    const openPath = vi.fn(async () => 'boom')
    const handlers = systemHandlers({} as never, {} as never, paths as never, { openPath })
    await expect(handlers['system.openAppFolder']({ which: 'logs' }, ctx)).rejects.toMatchObject({
      code: 'UNKNOWN'
    })
  })

  it('契约拒绝 logs / userData 之外的值与多余的键（不接受渲染端传路径）', () => {
    const schema = ipcContract['system.openAppFolder'].input
    expect(schema.safeParse({ which: 'logs' }).success).toBe(true)
    expect(schema.safeParse({ which: 'other' }).success).toBe(false)
    expect(schema.safeParse({ which: 'logs', path: 'C:/x' }).success).toBe(false)
  })
})

describe('app.getInfo', () => {
  it('含 userDataDir / logsDir', async () => {
    const { handlers } = setup()
    const info = await handlers['app.getInfo'](undefined, ctx)
    expect(info).toMatchObject({
      name: 'PremiumCowHorse',
      version: '0.1.0',
      userDataDir: paths.userData,
      logsDir: paths.logs
    })
  })
})
