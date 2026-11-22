import { useEffect, useState, type JSX } from 'react'
import { CircleAlertIcon, PlusIcon, ServerIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import type { ConnectionDto } from '@pch/shared'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@pch/ui/components/alert-dialog'
import { Button } from '@pch/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@pch/ui/components/empty'
import { Spinner } from '@pch/ui/components/spinner'
import {
  fetchConnectionReferenceCount,
  useConnectionActions,
  useConnections
} from '@renderer/data/connections'
import { notify } from '@renderer/stores/messages-store'
import { ConnectionDialog } from './connection-dialog'
import { hostPort } from './connection-form'
import { errorCode, errorText } from './error-text'
import { HostKeyDetails } from './host-key-prompt'
import { connectionStatus, toneClassName } from './status'
import { TestResultPanel, type TestState } from './test-result'

type Editing = { connection: ConnectionDto | undefined }

/**
 * 侧栏「远程连接」视图（设计 5.8）：每行显示状态点、名称、状态、`用户名@主机:端口`、切换身份；
 * 「测试」「编辑」「删除」，认证锁定时「重新连接」、主机密钥变化时「信任新的密钥」（显示新旧指纹）。
 * 测试结果显示在该行下方
 */
export function ConnectionsView(): JSX.Element {
  const { t } = useTranslation()
  const connections = useConnections()
  const actions = useConnectionActions()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState<ConnectionDto | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [trusting, setTrusting] = useState<ConnectionDto | null>(null)
  const [trustOpen, setTrustOpen] = useState(false)
  const [tests, setTests] = useState<Record<string, TestState>>({})

  const setTest = (id: string, state: TestState | null): void =>
    setTests((s) => {
      const next = { ...s }
      if (state === null) delete next[id]
      else next[id] = state
      return next
    })

  const runTest = async (id: string): Promise<void> => {
    setTest(id, { status: 'running' })
    try {
      const result = await actions.test.mutateAsync(id)
      setTest(id, { status: 'done', result })
    } catch (e) {
      setTest(id, { status: 'error', error: e })
    }
  }

  const openEditor = (connection: ConnectionDto | undefined): void => {
    setEditing({ connection })
    setEditOpen(true)
  }

  const reconnect = (id: string): void =>
    actions.reconnect.mutate(id, { onError: (e) => notify('error', errorText(t, e)) })

  const list = connections.data

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 px-4">
        <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {t('connections:title')}
        </h2>
        <Button
          variant="outline"
          size="xs"
          className="shrink-0"
          onClick={() => openEditor(undefined)}
        >
          <PlusIcon data-icon="inline-start" />
          {t('connections:add')}
        </Button>
      </div>
      {connections.isError ? (
        <p role="alert" className="flex items-start gap-2 px-4 py-2 text-xs text-muted-foreground">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {errorText(t, connections.error)}
        </p>
      ) : list === undefined ? (
        <div className="px-4 py-2">
          <Spinner aria-label={t('preview:loading')} />
        </div>
      ) : list.length === 0 ? (
        <Empty className="min-h-0 flex-1 border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ServerIcon />
            </EmptyMedia>
            <EmptyTitle>{t('connections:emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('connections:emptyHint')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => openEditor(undefined)}>
              <PlusIcon data-icon="inline-start" />
              {t('connections:add')}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul
          aria-label={t('connections:listLabel')}
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2"
        >
          {list.map((c) => (
            <ConnectionRow
              key={c.id}
              connection={c}
              test={tests[c.id]}
              onTest={() => void runTest(c.id)}
              onCloseTest={() => setTest(c.id, null)}
              onEdit={() => openEditor(c)}
              onDelete={() => {
                setDeleting(c)
                setDeleteOpen(true)
              }}
              onReconnect={() => reconnect(c.id)}
              onTrust={() => {
                setTrusting(c)
                setTrustOpen(true)
              }}
            />
          ))}
        </ul>
      )}
      {editing === null ? null : (
        <ConnectionDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          connection={editing.connection}
          onSaved={(saved) => setTest(saved.id, null)}
        />
      )}
      {deleting === null ? null : (
        <DeleteConnectionDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          connection={deleting}
          onDeleted={() => setTest(deleting.id, null)}
        />
      )}
      {trusting === null ? null : (
        <TrustKeyDialog open={trustOpen} onOpenChange={setTrustOpen} connection={trusting} />
      )}
    </div>
  )
}

function ConnectionRow({
  connection: c,
  test,
  onTest,
  onCloseTest,
  onEdit,
  onDelete,
  onReconnect,
  onTrust
}: {
  connection: ConnectionDto
  test: TestState | undefined
  onTest: () => void
  onCloseTest: () => void
  onEdit: () => void
  onDelete: () => void
  onReconnect: () => void
  onTrust: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const status = connectionStatus(c)
  const address = `${c.username}@${hostPort(c.host, c.port)}`
  const statusText = t(`connections:status.${status.kind}`)
  return (
    <li className="rounded-md px-2 py-1.5 hover:bg-accent/50">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={cn('size-2 shrink-0 rounded-full', toneClassName[status.tone])}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={c.name}>
          {c.name}
        </span>
        <span
          className={cn(
            'max-w-[50%] shrink-0 truncate text-xs',
            status.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
          )}
          title={statusText}
        >
          {statusText}
        </span>
      </div>
      <div className="flex flex-col pl-4 text-xs text-muted-foreground">
        <span className="truncate" title={address}>
          {address}
        </span>
        {c.identities.length === 0 ? null : (
          <span className="truncate" title={c.identities.join(' ')}>
            {t('connections:identitiesLine', { list: c.identities.join('  ') })}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1 pt-1 pl-3">
        {status.action === 'reconnect' ? (
          <Button variant="outline" size="xs" onClick={onReconnect}>
            {t('connections:reconnect')}
          </Button>
        ) : status.action === 'trustNewKey' ? (
          <Button variant="outline" size="xs" onClick={onTrust}>
            {t('connections:trustNewKey')}
          </Button>
        ) : null}
        <Button variant="ghost" size="xs" disabled={test?.status === 'running'} onClick={onTest}>
          {t('connections:test')}
        </Button>
        <Button variant="ghost" size="xs" onClick={onEdit}>
          {t('connections:edit')}
        </Button>
        <Button variant="ghost" size="xs" onClick={onDelete}>
          {t('connections:delete')}
        </Button>
      </div>
      {test === undefined ? null : (
        <div className="pl-4">
          <TestResultPanel state={test} identities={c.identities} onClose={onCloseTest} />
        </div>
      )}
    </li>
  )
}

/** 删除确认：显示引用它的条目数（渲染端遍历各工作区的条目统计）；条目保留 */
function DeleteConnectionDialog({
  open,
  onOpenChange,
  connection,
  onDeleted
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection: ConnectionDto
  onDeleted: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { remove } = useConnectionActions()

  const confirm = async (): Promise<void> => {
    try {
      await remove.mutateAsync(connection.id)
      onDeleted()
      onOpenChange(false)
    } catch (e) {
      notify('error', errorText(t, e))
      if (errorCode(e) === 'CONN_NOT_FOUND') onOpenChange(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('connections:deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="block font-medium text-foreground">{connection.name}</span>
            <ReferenceCount connectionId={connection.id} />
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('connections:cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => void confirm()}
          >
            {remove.isPending ? <Spinner data-icon="inline-start" aria-hidden /> : null}
            {t('connections:deleteSubmit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** 对话框打开时（内容挂载时）统计一次 */
function ReferenceCount({ connectionId }: { connectionId: string }): JSX.Element {
  const { t } = useTranslation()
  const [count, setCount] = useState<number | 'error' | null>(null)
  useEffect(() => {
    let active = true
    fetchConnectionReferenceCount(connectionId).then(
      (n) => active && setCount(n),
      () => active && setCount('error')
    )
    return () => {
      active = false
    }
  }, [connectionId])
  return (
    <span className="block">
      {count === null
        ? t('connections:deleteCounting')
        : count === 'error'
          ? t('connections:deleteCountFailed')
          : count === 0
            ? t('connections:deleteNoRefs')
            : t('connections:deleteRefs', { count })}
    </span>
  )
}

/** 「信任新的密钥」：显示原来与新的指纹，确认后保存新密钥 */
function TrustKeyDialog({
  open,
  onOpenChange,
  connection
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection: ConnectionDto
}): JSX.Element {
  const { t } = useTranslation()
  const { trustHostKey } = useConnectionActions()
  const confirm = (): void =>
    trustHostKey.mutate(connection.id, {
      onSuccess: () => onOpenChange(false),
      onError: (e) => {
        notify('error', errorText(t, e))
        onOpenChange(false)
      }
    })
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('connections:trustTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('connections:trustDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <p className="text-xs font-medium">{t('connections:oldKey')}</p>
            {connection.hostKey ? (
              <HostKeyDetails hostKey={connection.hostKey} />
            ) : (
              <p className="text-xs text-muted-foreground">{t('connections:hostKeyNone')}</p>
            )}
          </div>
          {connection.presentedHostKey ? (
            <div className="grid gap-1">
              <p className="text-xs font-medium text-destructive">{t('connections:newKey')}</p>
              <HostKeyDetails hostKey={connection.presentedHostKey} />
            </div>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('connections:cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={trustHostKey.isPending} onClick={confirm}>
            {trustHostKey.isPending ? <Spinner data-icon="inline-start" aria-hidden /> : null}
            {t('connections:trustSubmit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
