import type { WebShortcut } from '@pch/shared'

/**
 * 焦点在浏览器视图中时仍由应用执行的快捷键（设计 5.3.8）。只列渲染端在 window 上的 keydown 实际处理的组合
 * （宿主把 web.shortcut 作为 window 上的 keydown 重新派发，复用这些处理）：
 * - `features/address-bar/use-navigation-shortcuts.ts`（commands.ts）：F5、Alt+← / Alt+→、Alt+↑
 * - `features/tabs/tab-bar.tsx`：Ctrl+W
 * - `features/shell/use-shell-commands.ts`：Ctrl+Shift+F、Ctrl+B、Ctrl+K / Ctrl+Shift+P（命令面板）、Alt+W（工作区选择器）
 * - `features/settings/use-settings-commands.ts`：Ctrl+,
 * 渲染端的快捷键都登记在命令注册表（stores/command-store.ts），由 features/shell/use-command-shortcuts.ts 统一分发。
 * 未列入：Ctrl+Tab / Ctrl+Shift+Tab（渲染端不存在）。Ctrl+K 等虽会夺走网页的同名按键（网页常用 Ctrl+K 作搜索），
 * 但命令面板需要在任何焦点下都能唤起。渲染端增减全局快捷键时同步这里。
 * 不区分页面中的焦点是否在输入框：Alt+↑ / F5 在页面的 `<select>` / `<textarea>` 中也转发（渲染端对应用自己的
 * 输入框豁免，对视图不豁免）。`before-input-event` 必须同步决定是否拦截，而 Input 与 WebContents 都不含页面的
 * 焦点元素，只有向页面执行脚本才能知道；视图没有 preload，不为此注入脚本（唯一的注入是 WebViewManager.setMarkdownTheme
 * 对应用自己的 Markdown 外壳页执行的固定主题切换脚本，与按键无关）。
 */
export const APP_SHORTCUTS: readonly WebShortcut[] = [
  { key: 'F5', ctrl: false, shift: false, alt: false },
  { key: 'ArrowLeft', ctrl: false, shift: false, alt: true },
  { key: 'ArrowRight', ctrl: false, shift: false, alt: true },
  { key: 'ArrowUp', ctrl: false, shift: false, alt: true },
  { key: 'w', ctrl: true, shift: false, alt: false },
  { key: 'f', ctrl: true, shift: true, alt: false },
  { key: 'b', ctrl: true, shift: false, alt: false },
  { key: 'k', ctrl: true, shift: false, alt: false },
  { key: 'p', ctrl: true, shift: true, alt: false },
  { key: ',', ctrl: true, shift: false, alt: false },
  { key: 'w', ctrl: false, shift: false, alt: true }
]

/** `before-input-event` 的 Input 中用到的部分（Electron 把 rawKeyDown 也报告为 `keyDown`，已实测） */
export type KeyInput = Pick<
  Electron.Input,
  'type' | 'key' | 'control' | 'shift' | 'alt' | 'meta' | 'isComposing'
>

/** 按下（keyDown）的组合是否为应用快捷键：key 不区分大小写，修饰键必须完全一致（含 Meta 为假）；组字中不算 */
export function matchShortcut(input: KeyInput): WebShortcut | null {
  if (input.type !== 'keyDown' || input.isComposing || input.meta) return null
  const key = input.key.toLowerCase()
  return (
    APP_SHORTCUTS.find(
      (s) =>
        s.key.toLowerCase() === key &&
        s.ctrl === input.control &&
        s.shift === input.shift &&
        s.alt === input.alt
    ) ?? null
  )
}
