import type { JSX, ReactNode } from 'react'

/**
 * 侧栏外框：内容（含标题行）由 app/ 注入的视图提供，视图可在标题行放置自己的操作按钮。
 * 资源树（工作区条目 + 真实目录）由 features/explorer 提供，远程连接列表由 features/connections 提供。
 */
export function SideBar({ children }: { children: ReactNode }): JSX.Element {
  return (
    <aside className="flex h-full flex-col bg-sidebar text-sidebar-foreground">{children}</aside>
  )
}
