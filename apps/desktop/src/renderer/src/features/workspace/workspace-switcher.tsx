import { cloneElement, type JSX, type ReactElement, type ReactNode } from 'react'
import { GalleryVerticalIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@pch/ui/components/button'
import { useSetting } from '@renderer/data/settings'
import { useActiveWorkspace, workspaceDisplayName } from '@renderer/data/workspace'
import { useUiStore, type PickerAnchor } from '@renderer/stores/ui-store'
import { ColorDot } from './color-dot'
import { NewWorkspaceDialog } from './workspace-dialogs'
import { WorkspaceMenu } from './workspace-menu'

/** Alt+W（选择器的快捷键，注册在 use-workspace-commands.ts） */
const PICK_SHORTCUT = 'Alt+W'

/**
 * 标题栏的工作区按钮（设计稿 1.2）：`[颜色圆点] 名称`，不带 ▼。按 `workspace.pickerStyle`
 * 打开圆环选择器（Dialog，`aria-haspopup="dialog"`）或菜单式（锚定在本按钮下）。
 * 「新建工作区」对话框也挂在这里：开关在 ui-store 中，欢迎页、命令与菜单都能打开它。
 */
export function WorkspaceSwitcher(): JSX.Element {
  const { t } = useTranslation()
  const { data: active } = useActiveWorkspace()
  const newOpen = useUiStore((s) => s.newWorkspaceOpen)
  const setNewOpen = useUiStore((s) => s.setNewWorkspaceOpen)
  return (
    <>
      <PickerEntry
        anchor="title"
        button={
          <Button
            variant="ghost"
            size="sm"
            className="app-no-drag max-w-60 font-normal text-muted-foreground"
          />
        }
      >
        {active ? <ColorDot color={active.color} /> : null}
        <span className="truncate">
          {active ? workspaceDisplayName(active, t('common:defaultWorkspace')) : ''}
        </span>
      </PickerEntry>
      <NewWorkspaceDialog open={newOpen} onOpenChange={setNewOpen} />
    </>
  )
}

/**
 * 地址框左端的工作区按钮（lucide GalleryVertical）：与标题栏按钮打开同一个选择器
 * （圆环式同一位置；菜单式锚定在本按钮下）。由 app.tsx 注入地址栏的 workspacePicker 插槽
 */
export function WorkspaceAddressButton(): JSX.Element {
  return (
    <PickerEntry anchor="address" button={<Button variant="ghost" size="icon-xs" />}>
      <GalleryVerticalIcon />
    </PickerEntry>
  )
}

/** 两个入口共用：圆环式 = 切换 ui-store 的 pickerOpen；菜单式 = 本按钮作为菜单的触发器 */
function PickerEntry({
  anchor,
  button,
  children
}: {
  anchor: PickerAnchor
  button: ReactElement<Record<string, unknown>>
  children: ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  const style = useSetting('workspace.pickerStyle') ?? 'carousel'
  const open = useUiStore((s) => s.pickerOpen !== null)
  const togglePicker = useUiStore((s) => s.togglePicker)
  const props = {
    'aria-label': t('workspace:switcherLabel'),
    title: t('workspace:pickerButtonTitle', { shortcut: PICK_SHORTCUT })
  }
  if (style === 'menu') {
    return (
      <WorkspaceMenu anchor={anchor} trigger={cloneElement(button, props)}>
        {children}
      </WorkspaceMenu>
    )
  }
  return cloneElement(
    button,
    {
      ...props,
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      onClick: () => togglePicker(anchor)
    },
    children
  )
}
