import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { bindMainWindowHooks, type HookableWindow, type MainWindowHooks } from './main-window-hooks'

function setup(): {
  win: EventEmitter
  contents: EventEmitter
  hooks: Required<{ [K in keyof MainWindowHooks]: ReturnType<typeof vi.fn> }>
} {
  const contents = new EventEmitter()
  const win = Object.assign(new EventEmitter(), { webContents: contents })
  const hooks = {
    close: vi.fn(),
    querySessionEnd: vi.fn(),
    sessionEnd: vi.fn(),
    rendererReset: vi.fn()
  }
  bindMainWindowHooks(win as unknown as HookableWindow, () => hooks)
  return { win, contents, hooks }
}

describe('bindMainWindowHooks', () => {
  it('close / query-session-end / session-end 转给对应的 hook（带事件对象）', () => {
    const { win, hooks } = setup()
    const e = { preventDefault: vi.fn(), reasons: ['shutdown'] }
    win.emit('close', e)
    win.emit('query-session-end', e)
    win.emit('session-end', e)
    expect(hooks.close).toHaveBeenCalledWith(e)
    expect(hooks.querySessionEnd).toHaveBeenCalledWith(e)
    expect(hooks.sessionEnd).toHaveBeenCalledWith(e)
  })

  it('主框架提交新文档（did-navigate，含重新加载）与渲染进程退出 → rendererReset', () => {
    const { contents, hooks } = setup()
    contents.emit('did-navigate', {}, 'app://renderer/index.html', -1, '')
    contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    expect(hooks.rendererReset).toHaveBeenCalledTimes(2)
  })

  it('被 will-navigate 阻止的导航（只有 did-start-navigation）不重置', () => {
    const { contents, hooks } = setup()
    contents.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://example.com/'
    })
    contents.emit('will-navigate', { preventDefault: vi.fn(), url: 'https://example.com/' })
    expect(hooks.rendererReset).not.toHaveBeenCalled()
  })

  it('每次触发时取最新的 hooks（bootstrap 在打开窗口后设置也生效）', () => {
    const contents = new EventEmitter()
    const win = Object.assign(new EventEmitter(), { webContents: contents })
    let current: MainWindowHooks = {}
    bindMainWindowHooks(win as unknown as HookableWindow, () => current)
    contents.emit('did-navigate')
    const rendererReset = vi.fn()
    current = { rendererReset }
    contents.emit('did-navigate')
    expect(rendererReset).toHaveBeenCalledTimes(1)
  })
})
