import type { JSX, ReactNode, RefObject } from 'react'
import {
  CopyIcon,
  DatabaseIcon,
  FilePlusIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  LinkIcon,
  PencilIcon,
  PinIcon,
  RefreshCwIcon,
  SquareArrowOutUpRightIcon,
  SquareMinusIcon,
  type LucideIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { notify } from '@renderer/stores/messages-store'
import { AppError, normalizeRootUri, type CacheStrategy } from '@pch/shared'
import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@pch/ui/components/context-menu'
import { useEntries, useEntryActions, useIndexTargets } from '@renderer/data/entries'
import { useSetting } from '@renderer/data/settings'
import { call } from '@renderer/lib/ipc'
import { fileUriToWindowsPath, isUncUri } from '@renderer/lib/file-uri'
import { menuItemsFor, type MenuItemId } from './menu-items'
import type { TreeNode } from './tree-model'

/** 缓存策略子菜单的选项顺序（跟随全局之后）与对应的文案键 */
const LEVELS = [
  ['all', 'explorer:levelAll'],
  ['active', 'explorer:levelActive'],
  ['default', 'explorer:levelDefault'],
  ['passive', 'explorer:levelPassive']
] as const satisfies readonly (readonly [CacheStrategy, string])[]

/** 单选组的值：null（沿用全局默认）用 follow 表示 */
const FOLLOW = 'follow'

export interface NodeContextMenuProps {
  workspaceId: string
  /** 右键的节点；null 为树的空白处 */
  node: TreeNode | null
  /** 菜单关闭后焦点回到的元素（资源树） */
  finalFocus: RefObject<HTMLElement | null>
  /** 「在新标签页中打开」（设计 2.8） */
  onOpenInNewTab: () => void
  onNewGroup: () => void
  onAddPaths: (kind: 'folder' | 'file') => void
  onRename: () => void
  onRemove: () => void
  onPin: () => void
}

const ICONS: Partial<Record<MenuItemId, LucideIcon>> = {
  openInNewTab: SquareArrowOutUpRightIcon,
  newGroup: FolderPlusIcon,
  addFolder: FolderPlusIcon,
  addFile: FilePlusIcon,
  reveal: FolderSearchIcon,
  cacheStrategy: RefreshCwIcon,
  buildIndex: DatabaseIcon,
  copyPath: CopyIcon,
  copyUri: LinkIcon,
  pinToRoot: PinIcon,
  rename: PencilIcon,
  remove: SquareMinusIcon
}

/**
 * 资源树的右键菜单内容：随节点类型显示不同的菜单项（见 menuItemsFor）。
 * 全部是条目管理或只读操作（在新标签页中打开 / 显示 / 复制），不会修改磁盘上的文件。
 */
export function NodeContextMenu({
  workspaceId,
  node,
  finalFocus,
  onOpenInNewTab,
  onNewGroup,
  onAddPaths,
  onRename,
  onRemove,
  onPin
}: NodeContextMenuProps): JSX.Element | null {
  const { t } = useTranslation()
  const items = menuItemsFor(node)
  const { data: entries } = useEntries(workspaceId)
  const { data: indexTargets } = useIndexTargets(workspaceId)
  const { setCacheStrategy, setIndexTarget } = useEntryActions()
  const globalLocal = useSetting('cache.strategy.local')
  const globalNetwork = useSetting('cache.strategy.network')
  if (items.length === 0) return null

  const reportError = (e: unknown): void => {
    notify('error', t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
  }
  const uri = node?.uri ?? null

  const copy = async (text: string, message: string): Promise<void> => {
    try {
      await call('system.copyText', { text })
      notify('success', message)
    } catch (e) {
      reportError(e)
    }
  }
  const reveal = (): void => {
    if (uri === null) return
    call('system.revealInOs', { uri }).catch(reportError)
  }

  // 缓存策略：条目自身的设置；跟随全局时显示该位置（UNC 为网络，其余为本地）对应的全局值。
  // 映射网络盘在渲染端无法识别，按本地显示（扫描进程按真实位置类型生效）
  const entry = node === null ? undefined : entries?.find((e) => e.id === node.entryId)
  const globalLevel = (uri !== null && isUncUri(uri) ? globalNetwork : globalLocal) ?? 'default'
  const levelName = (level: CacheStrategy): string =>
    t(LEVELS.find(([l]) => l === level)?.[1] ?? 'explorer:levelDefault')
  const onLevelChange = (value: string): void => {
    if (node === null) return
    const strategy = value === FOLLOW ? null : (value as CacheStrategy)
    setCacheStrategy.mutate(
      { workspaceId, entryId: node.entryId, strategy },
      { onError: reportError }
    )
  }

  const indexed =
    uri !== null && (indexTargets ?? []).some((target) => target === normalizeRootUri(uri))
  const onIndexChange = (enabled: boolean): void => {
    if (uri === null) return
    setIndexTarget.mutate({ workspaceId, uri, enabled }, { onError: reportError })
  }

  const handlers: Partial<Record<MenuItemId, () => void>> = {
    openInNewTab: onOpenInNewTab,
    newGroup: onNewGroup,
    addFolder: () => onAddPaths('folder'),
    addFile: () => onAddPaths('file'),
    reveal,
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
    openInNewTab: t('explorer:openInNewTab'),
    newGroup: t('explorer:newGroup'),
    addFolder: t('explorer:menuAddFolder'),
    addFile: t('explorer:menuAddFile'),
    reveal: t('explorer:reveal'),
    cacheStrategy: t('explorer:cacheStrategy'),
    buildIndex: t('explorer:buildIndex'),
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
        if (id === 'cacheStrategy') {
          return (
            <ContextMenuSub key={id}>
              <ContextMenuSubTrigger>
                {Icon ? <Icon /> : null}
                {labels[id]}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {/* Base UI 的 RadioItem 默认点击后不关闭菜单：选中即生效并关闭，传 closeOnClick */}
                <ContextMenuRadioGroup
                  value={entry?.cacheStrategy ?? FOLLOW}
                  onValueChange={onLevelChange}
                >
                  <ContextMenuRadioItem value={FOLLOW} closeOnClick>
                    {t('explorer:cacheStrategyFollowGlobal', { strategy: levelName(globalLevel) })}
                  </ContextMenuRadioItem>
                  {LEVELS.map(([level, key]) => (
                    <ContextMenuRadioItem key={level} value={level} closeOnClick>
                      {t(key)}
                    </ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
          )
        }
        if (id === 'buildIndex') {
          return (
            <ContextMenuCheckboxItem
              key={id}
              checked={indexed}
              onCheckedChange={onIndexChange}
              closeOnClick
            >
              {Icon ? <Icon /> : null}
              {labels[id]}
            </ContextMenuCheckboxItem>
          )
        }
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
