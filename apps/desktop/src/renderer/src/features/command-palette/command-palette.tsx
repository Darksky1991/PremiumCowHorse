import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { FileIcon, FolderIcon, LayersIcon, TerminalIcon, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  Command
} from '@pch/ui/components/command'
import { useConnectionNames } from '@renderer/data/connections'
import { useActiveWorkspace, useWorkspaceActions } from '@renderer/data/workspace'
import { displayPath } from '@renderer/lib/display-path'
import { beginFocusReturn, type FocusReturn } from '@renderer/lib/focus-return'
import { formatShortcut } from '@renderer/lib/shortcut'
import { useNavigationStore } from '@renderer/stores/navigation-store'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { paletteKeyGuard } from './palette-keys'
import { usePaletteItems, type PaletteItem } from './use-palette-items'

/**
 * 命令面板（Ctrl+K / Ctrl+Shift+P / 标题栏搜索按钮）：最近使用、工作区、命令、文件四组。
 * 过滤与排序全部在 buildPaletteGroups（cmdk 的 shouldFilter 关闭，D5）；
 * 使用项目的 Dialog（role=dialog），打开期间 overlay-tracker 会冻结网页视图。
 */
export function CommandPalette(): JSX.Element {
  const open = useUiStore((s) => s.paletteOpen)
  const setOpen = useUiStore((s) => s.setPaletteOpen)
  const { t } = useTranslation('palette')
  // 焦点回到原处：打开时记住（订阅 store，早于 Dialog 抢走焦点），Esc / 点外部 / 再按 Ctrl+K 关闭时还回；
  // 选择了某一项（打开标签、切换工作区、执行命令…）则由该动作决定焦点去向
  const chosen = useRef(false)
  useEffect(() => {
    let back: FocusReturn | null = null
    return useUiStore.subscribe((state, prev) => {
      if (state.paletteOpen === prev.paletteOpen) return
      if (state.paletteOpen) {
        chosen.current = false
        back = beginFocusReturn()
      } else {
        if (!chosen.current) back?.restore()
        back = null
      }
    })
  }, [])
  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t('title')}
      description={t('description')}
      className="sm:max-w-xl"
    >
      {open ? (
        <PaletteBody
          close={() => {
            chosen.current = true
            setOpen(false)
          }}
        />
      ) : null}
    </CommandDialog>
  )
}

function PaletteBody({ close }: { close: () => void }): JSX.Element {
  const { t } = useTranslation(['palette', 'commands', 'common'])
  const [query, setQuery] = useState('')
  const { data: active } = useActiveWorkspace()
  const activeId = active?.id
  const { activate } = useWorkspaceActions()
  const connectionNames = useConnectionNames()
  const groups = usePaletteItems(query, activeId, (key) => t(key))

  // 选中项：首项变化（输入、最近使用 / 文件结果晚于首次渲染到达）时回到首项；用户移动后保持
  const firstKey = groups[0]?.items[0]?.key ?? ''
  const [picked, setPicked] = useState({ anchor: firstKey, value: firstKey })
  const selected = picked.anchor === firstKey ? picked.value : firstKey

  const choose = (item: PaletteItem): void => {
    close()
    switch (item.kind) {
      case 'recent': {
        if (activeId === undefined) return
        const { uri, kind, title } = item.item
        useTabsStore.getState().openHere(activeId, { uri, kind, title }, { source: 'palette' })
        return
      }
      case 'file': {
        if (activeId === undefined) return
        const { hit } = item
        // 与搜索视图相同的定位（切到资源管理器并在树中选中），再在标签中打开
        useTabsStore.getState().openHere(
          activeId,
          {
            uri: hit.uri,
            kind: hit.kind === 'directory' ? 'directory' : 'file',
            title: hit.name
          },
          { source: 'palette' }
        )
        useNavigationStore.getState().requestReveal(activeId, hit.uri)
        useUiStore.getState().showView('explorer')
        return
      }
      case 'workspace':
        activate.mutate(item.workspace.id)
        return
      case 'command':
        item.command.run()
        return
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // 输入法变换中的 Enter / 方向键属于输入法：不执行选中项、不移动
    if (paletteKeyGuard(e.nativeEvent) === 'block') e.preventDefault()
  }

  return (
    <Command
      shouldFilter={false}
      loop
      vimBindings={false}
      value={selected}
      onValueChange={(value) => setPicked({ anchor: firstKey, value })}
      onKeyDown={onKeyDown}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t('palette:placeholder')}
        aria-label={t('palette:title')}
      />
      <CommandList>
        <CommandEmpty>{t('palette:empty')}</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.id} heading={t(`palette:${group.id}`)}>
            {group.items.map((item) => (
              <CommandItem key={item.key} value={item.key} onSelect={() => choose(item)}>
                <ItemBody item={item} connectionNames={connectionNames} />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  )
}

function ItemBody({
  item,
  connectionNames
}: {
  item: PaletteItem
  connectionNames: Readonly<Record<string, string>>
}): JSX.Element {
  const Icon: LucideIcon =
    item.kind === 'command'
      ? TerminalIcon
      : item.kind === 'workspace'
        ? LayersIcon
        : item.kind === 'recent'
          ? item.item.kind === 'directory'
            ? FolderIcon
            : FileIcon
          : item.hit.kind === 'directory'
            ? FolderIcon
            : FileIcon
  const detail =
    item.kind === 'recent'
      ? displayPath(item.item.uri, connectionNames)
      : item.kind === 'file'
        ? item.description
        : null
  return (
    <>
      <Icon />
      <span className="min-w-0 shrink-0 truncate">{item.title}</span>
      {detail === null || detail === '' ? null : (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{detail}</span>
      )}
      {item.kind === 'command' && item.shortcut !== undefined ? (
        <CommandShortcut>{formatShortcut(item.shortcut)}</CommandShortcut>
      ) : null}
    </>
  )
}
