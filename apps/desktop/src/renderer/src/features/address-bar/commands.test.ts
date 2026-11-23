import { describe, expect, it } from 'vitest'
import { pickCommand, type DispatchKey } from '../../lib/shortcut'
import { copyTarget, isNavButton, mouseCommand, NAV_COMMANDS } from './commands'

const key = (
  k: string,
  mods: Partial<Record<'alt' | 'ctrl' | 'shift' | 'meta', boolean>> = {}
): DispatchKey => ({
  key: k,
  altKey: mods.alt ?? false,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  metaKey: mods.meta ?? false
})

/** 经分发规则（与统一分发器相同）把按键解析为导航命令 */
const nav = (e: DispatchKey, ctx: { editable: boolean; modal: boolean }): string | null =>
  pickCommand(e, NAV_COMMANDS, ctx)?.command ?? null
const free = { editable: false, modal: false }

describe('address bar commands', () => {
  it('Alt+← / Alt+→ go back / forward, also while typing (as in browsers)', () => {
    expect(nav(key('ArrowLeft', { alt: true }), free)).toBe('back')
    expect(nav(key('ArrowRight', { alt: true }), free)).toBe('forward')
    expect(nav(key('ArrowLeft', { alt: true }), { editable: true, modal: false })).toBe('back')
  })

  it('other modifiers or plain arrows are not commands', () => {
    expect(nav(key('ArrowLeft'), free)).toBeNull()
    expect(nav(key('ArrowLeft', { alt: true, ctrl: true }), free)).toBeNull()
    expect(nav(key('ArrowRight', { alt: true, shift: true }), free)).toBeNull()
    expect(nav(key('ArrowDown', { alt: true }), free)).toBeNull()
  })

  it('Alt+↑ goes up one level, except while typing (Alt+↑ belongs to the text field / select there)', () => {
    expect(nav(key('ArrowUp', { alt: true }), free)).toBe('up')
    expect(nav(key('ArrowUp', { alt: true }), { editable: true, modal: false })).toBeNull()
    expect(nav(key('ArrowUp'), free)).toBeNull()
    expect(nav(key('ArrowUp', { alt: true, shift: true }), free)).toBeNull()
    expect(nav(key('ArrowUp', { alt: true, ctrl: true }), free)).toBeNull()
  })

  it('F5 refreshes unless focus is in a text field; modified F5 is not a command', () => {
    expect(nav(key('F5'), free)).toBe('refresh')
    expect(nav(key('F5'), { editable: true, modal: false })).toBeNull()
    expect(nav(key('F5', { ctrl: true }), free)).toBeNull()
    expect(nav(key('F5', { shift: true }), free)).toBeNull()
  })

  it('mouse side buttons: 3 = back, 4 = forward', () => {
    expect(mouseCommand(3, false)).toBe('back')
    expect(mouseCommand(4, false)).toBe('forward')
    expect(mouseCommand(0, false)).toBeNull()
    expect(mouseCommand(1, false)).toBeNull()
    expect(mouseCommand(2, false)).toBeNull()
  })

  it('a modal dialog is open: keys and side buttons do nothing (they would act on the tab behind it)', () => {
    const modal = { editable: false, modal: true }
    expect(nav(key('ArrowLeft', { alt: true }), modal)).toBeNull()
    expect(nav(key('ArrowRight', { alt: true }), modal)).toBeNull()
    expect(nav(key('F5'), modal)).toBeNull()
    expect(nav(key('ArrowUp', { alt: true }), modal)).toBeNull()
    expect(nav(key('ArrowLeft', { alt: true }), { editable: true, modal: true })).toBeNull()
    expect(mouseCommand(3, true)).toBeNull()
    expect(mouseCommand(4, true)).toBeNull()
    // 侧键的默认动作（Chromium 的历史导航）仍要阻止：与是否有对话框无关
    expect(isNavButton(3)).toBe(true)
    expect(isNavButton(4)).toBe(true)
    expect(isNavButton(0)).toBe(false)
  })
})

describe('copyTarget', () => {
  it('K6：远程 → 复制服务器路径，提示第一行是复制的内容，第二行是显示路径', () => {
    const r = copyTarget('sftp://c1/var/log', 'prod:/var/log')
    expect(r.text).toBe('/var/log')
    expect(r.title.split('\n')[0]).toBe('/var/log')
    expect(r.title).toContain('prod:/var/log')
  })

  it('本地 → 复制 Windows 路径，提示与复制内容一致', () => {
    const r = copyTarget('file:///C:/Users/a', 'C:\\Users\\a')
    expect(r.text).toBe('C:\\Users\\a')
    expect(r.title.split('\n')[0]).toBe(r.text)
    expect(r.title).toBe(r.text)
  })

  it('网页 → 复制 URI', () => {
    const r = copyTarget('https://example.com/a', 'https://example.com/a')
    expect(r).toEqual({ text: 'https://example.com/a', title: 'https://example.com/a' })
  })
})
