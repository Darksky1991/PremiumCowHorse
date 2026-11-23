/** 地址栏的导航命令（快捷键与鼠标侧键共用） */
export type NavCommand = 'back' | 'forward' | 'up' | 'refresh'

/**
 * 导航命令的注册信息（命令注册表的 id / 文案 / 快捷键）：`Alt+←` / `Alt+→` 后退 / 前进（与浏览器相同，
 * 焦点在输入框时也有效）；`Alt+↑` 上一级（与 Windows 资源管理器相同）与 `F5` 刷新激活标签，焦点在输入框时除外
 * （输入框 / 下拉选择中 Alt+↑ 有自己的含义；只对应用自己的输入框——网页视图中的按键由主进程转发、派发在
 * window 上，不算输入框，见 main/modules/web/shortcuts.ts）。有模态对话框打开时都不处理
 * （否则会作用于对话框背后的标签）。分发规则见 lib/shortcut 的 pickCommand
 */
export const NAV_COMMANDS: readonly {
  command: NavCommand
  id: string
  titleKey: string
  shortcut: string
  allowInEditable: boolean
}[] = [
  {
    command: 'back',
    id: 'nav.back',
    titleKey: 'commands:navBack',
    shortcut: 'Alt+ArrowLeft',
    allowInEditable: true
  },
  {
    command: 'forward',
    id: 'nav.forward',
    titleKey: 'commands:navForward',
    shortcut: 'Alt+ArrowRight',
    allowInEditable: true
  },
  {
    command: 'up',
    id: 'nav.up',
    titleKey: 'commands:navUp',
    shortcut: 'Alt+ArrowUp',
    allowInEditable: false
  },
  {
    command: 'refresh',
    id: 'nav.refresh',
    titleKey: 'commands:navRefresh',
    shortcut: 'F5',
    allowInEditable: false
  }
]

/** 鼠标侧键（MouseEvent.button）：3 = 后退、4 = 前进；有模态对话框打开时不是命令 */
export function mouseCommand(button: number, modal: boolean): NavCommand | null {
  if (modal) return null
  if (button === 3) return 'back'
  return button === 4 ? 'forward' : null
}

/** 是否为侧键（其默认动作——Chromium 的历史导航——总要阻止，与是否有对话框无关） */
export function isNavButton(button: number): boolean {
  return button === 3 || button === 4
}
