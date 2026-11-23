import { useEffect, type DependencyList } from 'react'
import { create } from 'zustand'

/**
 * 命令：快捷键、命令面板（M5 Task 10）共用的一份注册表。
 * 各 feature 用 useRegisterCommands 注册自己的命令；快捷键由 features/shell 的分发器统一监听。
 */
export interface Command {
  /** 'palette.open' | 'settings.open' | 'workspace.pick' | 'tab.close' | 'nav.back' | … */
  id: string
  /** i18n 键（`命名空间:键`） */
  titleKey: string
  group: 'general' | 'view' | 'navigation' | 'workspace' | 'appearance'
  /** 'Ctrl+K' 形式，lib/shortcut 的 parseShortcut 可解析 */
  shortcut?: string
  /** 焦点在文本输入处时也触发（默认不触发） */
  allowInEditable?: boolean
  /** 有模态对话框打开时也触发（默认不触发） */
  allowWithModal?: boolean
  /** 按住不放的重复按键不触发（开关类命令：否则在开 / 关之间来回抖动） */
  ignoreRepeat?: boolean
  /** 不在命令面板中列出（同一命令的第二个快捷键等） */
  hidden?: boolean
  /** 返回 false 时命令不可用（快捷键不触发） */
  when?: () => boolean
  run: () => void
}

interface Entry {
  token: number
  command: Command
}

interface CommandState {
  /** 按注册顺序的所有登记（含被同 id 覆盖的） */
  entries: Entry[]
  /** 注册一组命令，返回注销函数；同 id 后注册者覆盖，注销后恢复前一个 */
  register: (cmds: Command[]) => () => void
  /** 当前生效的命令（每个 id 取最后注册的，保持首次出现的顺序） */
  commands: () => Command[]
}

let nextToken = 1

export const useCommandStore = create<CommandState>((set, get) => ({
  entries: [],
  register: (cmds) => {
    const added = cmds.map((command) => ({ token: nextToken++, command }))
    const tokens = new Set(added.map((e) => e.token))
    set((s) => ({ entries: [...s.entries, ...added] }))
    return () => set((s) => ({ entries: s.entries.filter((e) => !tokens.has(e.token)) }))
  },
  commands: () => {
    const byId = new Map<string, Command>()
    for (const { command } of get().entries) byId.set(command.id, command)
    return [...byId.values()]
  }
}))

/**
 * 在组件挂载期间注册命令（卸载 / deps 变化时注销）。cmds 通常在渲染中构造，闭包里用到的值写进 deps
 */
export function useRegisterCommands(cmds: Command[], deps: DependencyList): void {
  useEffect(() => useCommandStore.getState().register(cmds), deps) // eslint-disable-line react-hooks/exhaustive-deps
}
