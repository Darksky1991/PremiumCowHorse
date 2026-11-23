/** 快捷键的解析、匹配与显示（命令注册表使用的写法：`Ctrl+Shift+P`） */

export interface ParsedShortcut {
  /** 小写的 `KeyboardEvent.key`（`p`、`,`、`f5`、`arrowleft`） */
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}

/** 解析 `Ctrl+Shift+P` 形式（修饰键 Ctrl / Shift / Alt，大小写不敏感；最后一段是按键，`+` 键写作 `Ctrl++`） */
export function parseShortcut(shortcut: string): ParsedShortcut {
  const plusKey = shortcut.endsWith('++') || shortcut === '+'
  const parts = (plusKey ? shortcut.slice(0, -1) : shortcut).split('+')
  const key = plusKey ? '+' : (parts.pop() ?? '')
  const mods = (plusKey ? parts.slice(0, -1) : parts).map((m) => m.toLowerCase())
  for (const m of mods) {
    if (m !== 'ctrl' && m !== 'shift' && m !== 'alt') throw new Error(`Bad shortcut: ${shortcut}`)
  }
  if (key === '') throw new Error(`Bad shortcut: ${shortcut}`)
  return {
    key: key.toLowerCase(),
    ctrl: mods.includes('ctrl'),
    shift: mods.includes('shift'),
    alt: mods.includes('alt')
  }
}

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>

/** 按键事件是否恰好是该快捷键：key 不区分大小写，修饰键必须完全一致（含 Meta 为假） */
export function matchesShortcut(e: KeyEventLike, shortcut: string | ParsedShortcut): boolean {
  const s = typeof shortcut === 'string' ? parseShortcut(shortcut) : shortcut
  return (
    !e.metaKey &&
    e.key.toLowerCase() === s.key &&
    e.ctrlKey === s.ctrl &&
    e.shiftKey === s.shift &&
    e.altKey === s.alt
  )
}

const KEY_LABEL: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  escape: 'Esc'
}

/** 显示用写法：修饰键按 Ctrl、Shift、Alt 的顺序，单个字母大写，方向键用箭头 */
export function formatShortcut(shortcut: string): string {
  const s = parseShortcut(shortcut)
  const key = KEY_LABEL[s.key] ?? s.key.toUpperCase()
  return [s.ctrl && 'Ctrl', s.shift && 'Shift', s.alt && 'Alt', key].filter(Boolean).join('+')
}

/** 命令分发的环境：有模态对话框打开、焦点在文本输入处 */
export interface DispatchContext {
  modal: boolean
  editable: boolean
}

/** pickCommand 关心的命令字段（lib 不依赖 stores，命令类型由调用方带入） */
export interface Pickable {
  shortcut?: string
  allowInEditable?: boolean
  allowWithModal?: boolean
  when?: () => boolean
}

export type DispatchKey = KeyEventLike & { defaultPrevented?: boolean; isComposing?: boolean }

/**
 * 按键 → 命令（快捷键分发的纯函数）：已被处理（defaultPrevented）或输入法组字中 → 无；
 * 有模态且命令未 allowWithModal → 跳过；目标可编辑且命令未 allowInEditable → 跳过；`when()` 为 false → 跳过；
 * 取第一个命中的
 */
export function pickCommand<C extends Pickable>(
  e: DispatchKey,
  commands: readonly C[],
  ctx: DispatchContext
): C | null {
  if (e.defaultPrevented === true || e.isComposing === true) return null
  for (const c of commands) {
    if (c.shortcut === undefined || !matchesShortcut(e, c.shortcut)) continue
    if (ctx.modal && c.allowWithModal !== true) continue
    if (ctx.editable && c.allowInEditable !== true) continue
    if (c.when?.() === false) continue
    return c
  }
  return null
}
