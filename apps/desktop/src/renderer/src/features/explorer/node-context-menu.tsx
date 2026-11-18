import type { JSX, ReactNode, RefObject } from 'react'
import {
  CopyIcon,
  ExternalLinkIcon,
  FilePlusIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  LinkIcon,
  PencilIcon,
  PinIcon,
  SquareMinusIcon,
  type LucideIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AppError } from '@pch/shared'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut
} from '@pch/ui/components/context-menu'
import { call } from '@renderer/lib/ipc'
import { fileUriToWindowsPath } from '@renderer/lib/file-uri'
import { menuItemsFor, type MenuItemId } from './menu-items'
import type { TreeNode } from './tree-model'

export interface NodeContextMenuProps {
  /** 右键的节点；null 为树的空白处 */
  node: TreeNode | null
  /** 菜单关闭后焦点回到的元素（资源树） */
  finalFocus: RefObject<HTMLElement | null>
  onNewGroup: () => void
  onAddPaths: (kind: 'folder' | 'file') => void
  onRename: () => void
  onRemove: () => void
  onPin: () => void
}

const ICONS: Partial<Record<MenuItemId, LucideIcon>> = {
  newGroup: FolderPlusIcon,
  addFolder: FolderPlusIcon,
  addFile: FilePlusIcon,
  reveal: FolderSearchIcon,
  open: ExternalLinkIcon,
  copyPath: CopyIcon,
  copyUri: LinkIcon,
  pinToRoot: PinIcon,
  rename: PencilIcon,
  remove: SquareMinusIcon
}

/**
 * 资源树的右键菜单内容：随节点类型显示不同的菜单项（见 menuItemsFor）。
 * 全部是条目管理或只读操作（显示 / 打开 / 复制），不会修改磁盘上的文件。
 */
export function NodeContextMenu({
  node,
  finalFocus,
  onNewGroup,
  onAddPaths,
  onRename,
  onRemove,
  onPin
}: NodeContextMenuProps): JSX.Element | null {
  const { t } = useTranslation()
  const items = menuItemsFor(node)
  if (items.length === 0) return null

  const reportError = (e: unknown): void => {
    toast.error(t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
  }
  const uri = node?.uri ?? null

  const copy = async (text: string, message: string): Promise<void> => {
    try {
      await call('system.copyText', { text })
      toast.success(message)
    } catch (e) {
      reportError(e)
    }
  }
  const system = (channel: 'system.revealInOs' | 'system.openPath'): void => {
    if (uri === null) return
    call(channel, { uri }).catch(reportError)
  }

  const handlers: Partial<Record<MenuItemId, () => void>> = {
    newGroup: onNewGroup,
    addFolder: () => onAddPaths('folder'),
    addFile: () => onAddPaths('file'),
    reveal: () => system('system.revealInOs'),
    open: () => system('system.openPath'),
    copyPath: () => {
      const path = uri === null ? null : fileUriToWindowsPath(uri)
      if (path !== null) void copy(path, t('explorer:copiedPath'))
    },
    copyUri: () => {
      if (uri !== null) void copy(uri, t('explorer:copiedUri'))
    },
    pinToRoot: onPin,
    rename: onRename,
    remove: onRemove
  }
  const labels: Partial<Record<MenuItemId, string>> = {
    newGroup: t('explorer:newGroup'),
    addFolder: t('explorer:menuAddFolder'),
    addFile: t('explorer:menuAddFile'),
    reveal: t('explorer:reveal'),
    open: t('explorer:openWithApp'),
    copyPath: t('explorer:copyPath'),
    copyUri: t('explorer:copyUri'),
    pinToRoot: t('explorer:pinToRoot'),
    rename: t('explorer:rename'),
    remove: t('explorer:remove')
  }
  const shortcuts: Partial<Record<MenuItemId, string>> = { rename: 'F2', remove: 'Del' }

  // 本地路径只在 file: URI 能转换时提供「复制路径」
  const visible = items.filter(
    (id) => id !== 'copyPath' || (uri !== null && fileUriToWindowsPath(uri) !== null)
  )

  return (
    <ContextMenuContent finalFocus={finalFocus} className="min-w-52">
      {visible.map((id, i): ReactNode => {
        if (id === 'separator') return <ContextMenuSeparator key={`sep-${i}`} />
        const Icon = ICONS[id]
        const shortcut = shortcuts[id]
        return (
          <ContextMenuItem key={id} onClick={handlers[id]}>
            {Icon ? <Icon /> : null}
            {labels[id]}
            {shortcut ? <ContextMenuShortcut>{shortcut}</ContextMenuShortcut> : null}
          </ContextMenuItem>
        )
      })}
    </ContextMenuContent>
  )
}
