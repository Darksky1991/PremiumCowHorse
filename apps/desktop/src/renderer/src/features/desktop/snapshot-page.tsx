import { useEffect, useMemo, useState, type JSX } from 'react'
import { CircleAlertIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { desktopIdOfUri, desktopLocation, type DesktopItem, type TabState } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import { Spinner } from '@pch/ui/components/spinner'
import {
  restoreDesktop,
  saveDesktop,
  useDesktopCurrent,
  useDesktopSnapshot
} from '@renderer/data/desktop'
import { notify } from '@renderer/stores/messages-store'
import { onTabRefresh, useTabsStore } from '@renderer/stores/tabs-store'
import { errorCode, errorText } from './error-text'
import { ItemChecklist } from './item-checklist'
import { formatSnapshotTime, kindKey, restoreSummary, snapshotTitle } from './snapshot-label'

export interface SnapshotPageProps {
  /** 显示桌面记录页（kind 为 desktop，uri 为 pch-desktop:<快照 id | current>）的标签 */
  tab: TabState
}

/** 清单的项目：id 为勾选用的字符串（现在：key；快照：String(项目 id)） */
interface PageData {
  items: { id: string; item: DesktopItem }[]
  /** 本轮无法读取的类别（只有「现在」有） */
  unreadable: string[]
  /** 页面副标题（快照的时间与种类；「现在」为 null） */
  subtitle: string | null
}

/**
 * 快照页（设计 5.7，内置视图，不是插件）：「現在」与快照共用同一个项目清单（默认全选）。
 * 快照页底部「選択した項目を復元」→ 结果汇总为应用消息；「現在」页底部「保存」→ 保存所选项目为手动快照。
 * 不访问文件系统；刷新（地址栏 / F5）重新取得数据。
 */
export function SnapshotPage({ tab }: SnapshotPageProps): JSX.Element {
  const { t } = useTranslation()
  const target = desktopIdOfUri(tab.uri)
  if (target === null) {
    return (
      <PageShell tab={tab} subtitle={null}>
        <p role="alert" className="text-sm text-muted-foreground">
          {t('errors:UNKNOWN')}
        </p>
      </PageShell>
    )
  }
  return target === 'current' ? <CurrentPage tab={tab} /> : <SavedPage tab={tab} id={target} />
}

function CurrentPage({ tab }: SnapshotPageProps): JSX.Element {
  const { t } = useTranslation()
  const query = useDesktopCurrent()
  const { refetch } = query
  useEffect(() => onTabRefresh(tab.id, () => void refetch()), [tab.id, refetch])
  const data = useMemo<PageData | undefined>(
    () =>
      query.data === undefined
        ? undefined
        : {
            items: query.data.items.map((i) => ({ id: i.key, item: i.item })),
            unreadable: query.data.unreadable,
            subtitle: null
          },
    [query.data]
  )
  return (
    <PageBody
      tab={tab}
      query={query}
      data={data}
      emptyText={t('desktop:emptyCurrent')}
      actionLabel={t('desktop:saveSelected')}
      onAction={async (ids) => {
        await saveDesktop(ids, null)
        notify('success', t('desktop:saved', { count: ids.length }))
      }}
    />
  )
}

function SavedPage({ tab, id }: SnapshotPageProps & { id: number }): JSX.Element {
  const { t, i18n } = useTranslation()
  const query = useDesktopSnapshot(id)
  const { refetch } = query
  const navigate = useTabsStore((s) => s.navigate)
  useEffect(() => onTabRefresh(tab.id, () => void refetch()), [tab.id, refetch])
  const language = i18n.language
  const data = useMemo<PageData | undefined>(
    () =>
      query.data === undefined
        ? undefined
        : {
            items: query.data.items.map((i) => ({ id: String(i.id), item: i.item })),
            unreadable: [],
            subtitle: [
              formatSnapshotTime(query.data.createdAt, language),
              query.data.name ?? t(`desktop:${kindKey(query.data.kind)}`)
            ].join(' · ')
          },
    [query.data, language, t]
  )
  return (
    <PageBody
      tab={tab}
      query={query}
      data={data}
      title={query.data === undefined ? undefined : snapshotTitle(query.data, t, language)}
      emptyText={t('desktop:emptySnapshot')}
      actionLabel={t('desktop:restoreSelected')}
      onAction={async (ids) => {
        const result = await restoreDesktop(id, ids.map(Number))
        const { level, message } = restoreSummary(result, t, language)
        notify(level, message)
        // 恢复后快照已被清空：本页的快照不存在了，把这个标签带到「現在」页（Ruling 17）；
        // 有连不上 / 启动失败的项目时快照保留（Ruling 14），留在本页并重新取得
        if (result.cleared) navigate(tab.id, desktopLocation('current', t('desktop:current')))
        else void refetch()
      }}
    />
  )
}

interface PageBodyProps {
  tab: TabState
  query: { isError: boolean; error: unknown; refetch: () => unknown }
  data: PageData | undefined
  title?: string
  emptyText: string
  actionLabel: string
  /** 对所选项目执行底部按钮的操作（抛出的错误由页面提示） */
  onAction: (ids: string[]) => Promise<void>
}

function PageBody({
  tab,
  query,
  data,
  title,
  emptyText,
  actionLabel,
  onAction
}: PageBodyProps): JSX.Element {
  const { t } = useTranslation()
  // 保存「不勾选」的项目：新出现的项目（「現在」随现场变化）默认勾选
  const [deselected, setDeselected] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const items = data?.items
  const selected = useMemo(
    () => new Set((items ?? []).map((i) => i.id).filter((id) => !deselected.has(id))),
    [items, deselected]
  )
  const onChange = (next: Set<string>): void =>
    setDeselected(new Set((items ?? []).map((i) => i.id).filter((id) => !next.has(id))))

  const run = async (): Promise<void> => {
    if (items === undefined) return
    setBusy(true)
    try {
      // 按清单顺序传出（勾选集合与清单可能在等待期间变化，以点击时的值为准）
      await onAction(items.map((i) => i.id).filter((id) => selected.has(id)))
    } catch (e) {
      notify('error', errorText(t, e))
    } finally {
      setBusy(false)
    }
  }

  // 快照已被删除：react-query 在重新取得失败后仍保留旧数据，要先判断，不再显示旧清单并禁用操作
  const gone = query.isError && errorCode(query.error) === 'DESKTOP_SNAPSHOT_NOT_FOUND'
  let body: JSX.Element
  if (gone) {
    body = (
      <p role="alert" className="text-sm text-muted-foreground">
        {t('desktop:snapshotGone')}
      </p>
    )
  } else if (query.isError && data === undefined) {
    const code = errorCode(query.error)
    body = (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-muted-foreground">
          {t(`errors:${code}`)}
        </p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          {t('preview:retry')}
        </Button>
      </div>
    )
  } else if (data === undefined || items === undefined) {
    body = <Spinner aria-label={t('preview:loading')} />
  } else {
    body = (
      <>
        {data.unreadable.length === 0 ? null : (
          <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('desktop:unreadable', {
              names: data.unreadable.map((c) => t(`desktop:category.${c}`)).join(' / ')
            })}
          </p>
        )}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ItemChecklist items={items} selected={selected} onChange={onChange} />
        )}
      </>
    )
  }

  return (
    <PageShell
      tab={tab}
      title={title}
      subtitle={data?.subtitle ?? null}
      footer={
        items === undefined || gone ? null : (
          <>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {t('desktop:selectedCount', { selected: selected.size, total: items.length })}
            </span>
            <Button disabled={busy || selected.size === 0} onClick={() => void run()}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {actionLabel}
            </Button>
          </>
        )
      }
    >
      {body}
    </PageShell>
  )
}

/** 页面外壳：标题、可滚动内容、SharePoint 说明与底部按钮栏 */
function PageShell({
  tab,
  title,
  subtitle,
  footer,
  children
}: {
  tab: TabState
  title?: string | undefined
  subtitle: string | null
  footer?: JSX.Element | null
  children: JSX.Element
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="truncate text-lg font-semibold">{title ?? tab.title}</h2>
            {subtitle === null ? null : (
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {children}
          <p className="text-xs text-muted-foreground">{t('desktop:sharePointNote')}</p>
        </div>
      </div>
      {footer == null ? null : (
        <div className="shrink-0 border-t py-3">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6">{footer}</div>
        </div>
      )}
    </div>
  )
}
