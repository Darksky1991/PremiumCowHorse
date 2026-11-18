import type { JSX } from 'react'
import { Shell } from '@renderer/features/shell'

/**
 * 根组件。M3 起按窗口角色（bootstrap 中的主窗口 / 弹出窗口）渲染不同外壳；
 * 两种窗口共用同一个页面，不需要路由库。
 */
export function App(): JSX.Element {
  return <Shell />
}
