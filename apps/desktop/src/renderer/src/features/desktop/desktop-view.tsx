import { useState, type JSX } from 'react'
import {
  CircleAlertIcon,
  EllipsisIcon,
  MonitorIcon,
  PencilIcon,
  SaveIcon,
  Trash2Icon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import { desktopLocation, desktopIdOfUri, type DesktopSnapshotSummary } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@pch/ui/components/context-menu'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@pch/ui/components/dropdown-menu'
import { Spinner } from '@pch/ui/components/spinner'
import { saveDesktop, useDesktopCurrent, useDesktopSnapshots } from '@renderer/data/desktop'
import { useSetting, useUpdateSettings } from '@renderer/data/settings'
import { useActiveWorkspace } from '@renderer/data/workspace'
import { notify } from '@renderer/stores/messages-store'
import { selectActiveTab, useTabsStore } from '@renderer/stores/tabs-store'
import { errorText } from './error-text'
import { DeleteSnapshotDialog, RenameSnapshotDialog } from './desktop-dialogs'
import { formatSnapshotTime, isBeforeRestart, kindKey, snapshotTitle } from './snapshot-label'

type Pending = { type: 'rename' | 'delete'; snapshot: DesktopSnapshotSummary }

/**
 * 侧栏「桌面记录」视图（设计 5.7）：标题行（「今すぐ保存」保存当前现场的全部项目；
 * 「…」菜单中的「終了時に確認する」开关 = 设置 desktop.askOnExit，「次回から確認しない」之后在这里重新打开）、
 * 固定的「現在」行、快照列表（时间倒序，标注种类、「重启前」与项目数）。
 * 单击在当前标签打开快照页；改名 / 删除（确认）在行内按钮与右键菜单中
 */
export function DesktopView(): JSX.Element {
  const { t, i18n } = useTranslation()
  const { data: workspace } = useActiveWorkspace()
  const workspaceId = workspace?.id
  const snapshots = useDesktopSnapshots()
  const current = useDesktopCurrent()
  const openHere = useTabsStore((s) => s.openHere)
  const activeId = useTabsStore((s) => {
    const uri = selectActiveTab(workspaceId)(s)?.uri
    return uri === undefined ? null : desktopIdOfUri(uri)
  })
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [open, setOpen] = useState(false)

  const list = snapshots.data
  // 本次登录的时刻：来自 desktop.current（取得前不标记）
  const logonAt = current.data?.logonAt ?? null

  const saveNow = async (): Promise<void> => {
    const keys = (current.data?.items ?? []).map((i) => i.key)
    if (keys.length === 0) {
      notify('info', t('desktop:nothingToSave'))
      return
    }
    setSaving(true)
    try {
      await saveDesktop(keys, null)
      notify('success', t('desktop:saved', { count: keys.length }))
    } catch (e) {
      notify('error', errorText(t, e))
    } finally {
      setSaving(false)
    }
  }

  const openPage = (id: number | 'current', title: string): void => {
    if (workspaceId === undefined) return
    openHere(workspaceId, desktopLocation(id, title))
  }

  const ask = (type: Pending['type'], snapshot: DesktopSnapshotSummary): void => {
    setPending({ type, snapshot })
    setOpen(true)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 px-4">
        <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {t('desktop:title')}
        </h2>
        <Button
          variant="outline"
          size="xs"
          className="shrink-0"
          disabled={saving}
          onClick={() => void saveNow()}
        >
          {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
          {t('desktop:saveNow')}
        </Button>
        <DesktopMenu />
      </div>
      <ul aria-label={t('desktop:listLabel')} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <li>
          <button
            type="button"
            aria-current={activeId === 'current' ? 'page' : undefined}
            onClick={() => openPage('current', t('desktop:current'))}
            className={cn(
              'flex w-full min-w-0 cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none select-none hover:bg-accent/50 focus-visible:outline-1 focus-visible:outline-ring',
              activeId === 'current' && 'bg-accent text-accent-foreground'
            )}
          >
            <MonitorIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">{t('desktop:current')}</span>
            {current.data === undefined ? null : (
              <span className="shrink-0 text-xs text-muted-foreground">
                {t('desktop:itemCount', { count: current.data.items.length })}
              </span>
            )}
          </button>
        </li>
        {snapshots.isError ? (
          <li
            role="alert"
            className="flex items-start gap-2 px-2 py-2 text-xs text-muted-foreground"
          >
            <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {errorText(t, snapshots.error)}
          </li>
        ) : list === undefined ? (
          <li className="px-2 py-2">
            <Spinner aria-label={t('preview:loading')} />
          </li>
        ) : list.length === 0 ? (
          <li className="px-2 py-3 text-xs text-muted-foreground">{t('desktop:noSnapshots')}</li>
        ) : (
          list.map((s) => (
            <SnapshotRow
              key={s.id}
              snapshot={s}
              beforeRestart={isBeforeRestart(s, logonAt)}
              active={activeId === s.id}
              language={i18n.language}
              onOpen={() => openPage(s.id, snapshotTitle(s, t, i18n.language))}
              onRename={() => ask('rename', s)}
              onDelete={() => ask('delete', s)}
            />
          ))
        )}
      </ul>
      {pending === null ? null : pending.type === 'rename' ? (
        <RenameSnapshotDialog
          open={open}
          onOpenChange={setOpen}
          id={pending.snapshot.id}
          initialName={pending.snapshot.name ?? ''}
        />
      ) : (
        <DeleteSnapshotDialog open={open} onOpenChange={setOpen} id={pending.snapshot.id} />
      )}
    </div>
  )
}

/** 标题行的「…」菜单：退出时是否询问（设置 desktop.askOnExit，读写经设置数据层） */
function DesktopMenu(): JSX.Element {
  const { t } = useTranslation()
  const askOnExit = useSetting('desktop.askOnExit')
  const update = useUpdateSettings()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0"
            aria-label={t('desktop:moreActions')}
            title={t('desktop:moreActions')}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuCheckboxItem
          checked={askOnExit ?? true}
          disabled={askOnExit === undefined}
          onCheckedChange={(checked) =>
            update.mutate(
              { 'desktop.askOnExit': checked },
              { onError: (e) => notify('error', errorText(t, e)) }
            )
          }
        >
          {t('desktop:askOnExit')}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SnapshotRow({
  snapshot,
  beforeRestart,
  active,
  language,
  onOpen,
  onRename,
  onDelete
}: {
  snapshot: DesktopSnapshotSummary
  beforeRestart: boolean
  active: boolean
  language: string
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const label = snapshot.name ?? t(`desktop:${kindKey(snapshot.kind)}`)
  const time = formatSnapshotTime(snapshot.createdAt, language)
  const actions = [
    { key: 'rename', label: t('desktop:renameMenu'), Icon: PencilIcon, run: onRename },
    { key: 'delete', label: t('desktop:deleteMenu'), Icon: Trash2Icon, run: onDelete }
  ]
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <li
            className={cn(
              'group relative rounded-md hover:bg-accent/50',
              active && 'bg-accent text-accent-foreground'
            )}
          />
        }
      >
        <button
          type="button"
          aria-current={active ? 'page' : undefined}
          title={`${time}\n${label}`}
          onClick={onOpen}
          className="flex w-full min-w-0 cursor-default flex-col gap-0.5 rounded-md px-2 py-1.5 text-left outline-none select-none focus-visible:outline-1 focus-visible:outline-ring"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-[13px] font-medium">{time}</span>
            {beforeRestart ? (
              <span className="shrink-0 rounded-sm border px-1 text-[11px] leading-4 text-muted-foreground">
                {t('desktop:beforeRestart')}
              </span>
            ) : null}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{label}</span>
            <span className="shrink-0">
              · {t('desktop:itemCount', { count: snapshot.itemCount })}
            </span>
          </span>
        </button>
        {/* 行内操作：悬停或键盘焦点在行内时显示（与右键菜单是同一份） */}
        <div className="absolute top-1/2 right-1 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-accent group-focus-within:flex group-hover:flex">
          {actions.map(({ key, label: actionLabel, Icon, run }) => (
            <Button
              key={key}
              variant="ghost"
              size="icon-xs"
              aria-label={actionLabel}
              title={actionLabel}
              onClick={run}
            >
              <Icon />
            </Button>
          ))}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        {actions.map(({ key, label: actionLabel, Icon, run }) => (
          <ContextMenuItem
            key={key}
            variant={key === 'delete' ? 'destructive' : 'default'}
            onClick={run}
          >
            <Icon />
            {actionLabel}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
