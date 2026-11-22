import { useId, useRef, useState, type FormEvent, type JSX, type RefObject } from 'react'
import { ChevronDownIcon, ServerCogIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppError, formatSftpUri, type ConnectionDto } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@pch/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@pch/ui/components/dropdown-menu'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel
} from '@pch/ui/components/field'
import { Input } from '@pch/ui/components/input'
import { Spinner } from '@pch/ui/components/spinner'
import { useConnectionHome, useConnections } from '@renderer/data/connections'
import { useEntryActions } from '@renderer/data/entries'
import { useUiStore } from '@renderer/stores/ui-store'
import { normalizeRemotePath } from './remote-path'

export interface AddRemoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  /** 关闭后焦点回到的元素（资源树或空状态） */
  finalFocus: RefObject<HTMLElement | null>
}

/** 身份下拉的值：登录用户用空串表示（身份名不会是空串，IDENTITY_PATTERN） */
const LOGIN = ''

/**
 * 「添加远程文件夹」（设计 devDoc/2026-11-22-37 第 5.8 节）：选连接（旁边「管理连接」跳到「远程连接」视图）、
 * 读取的身份（登录用户 + 连接登记的身份）、路径（默认：登录用户为其主目录，其他身份为 /）。
 * 确认 → entry.add（主进程校验连接、身份与「是目录」），失败时按错误码在对话框内显示、不关闭。
 * 条目加在工作区根部，标签为路径最后一段（主进程的默认值）
 */
export function AddRemoteDialog({
  open,
  onOpenChange,
  workspaceId,
  finalFocus
}: AddRemoteDialogProps): JSX.Element {
  const pathRef = useRef<HTMLInputElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} initialFocus={pathRef} finalFocus={finalFocus}>
        {/* 内容在关闭后卸载：每次打开都从第一个连接、登录用户、主目录开始 */}
        <AddRemoteForm
          pathRef={pathRef}
          workspaceId={workspaceId}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function AddRemoteForm({
  pathRef,
  workspaceId,
  onDone
}: {
  pathRef: RefObject<HTMLInputElement | null>
  workspaceId: string
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const ids = {
    connection: useId(),
    identity: useId(),
    path: useId(),
    pathHint: useId(),
    pathError: useId()
  }
  const { data: connections } = useConnections()
  const { add } = useEntryActions()
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [identityValue, setIdentityValue] = useState(LOGIN)
  /** 用户输入的路径；null = 未输入（显示默认路径） */
  const [pathDraft, setPathDraft] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const connection: ConnectionDto | undefined =
    connections?.find((c) => c.id === chosenId) ?? connections?.[0]
  // 登记的身份可能在对话框打开期间被删除：不在其中时回到登录用户；
  // 与登录用户同名的身份视为登录用户（URI 不写 userinfo，设计 5.1）
  const identity =
    identityValue !== LOGIN &&
    connection?.identities.includes(identityValue) === true &&
    identityValue !== connection.username
      ? identityValue
      : null
  const home = useConnectionHome(connection?.id, identity)
  const path = pathDraft ?? home.data ?? ''
  const normalized = normalizeRemotePath(path)
  const pathError = submitted && normalized === null ? t('explorer:remotePathInvalid') : undefined
  // 默认路径（主目录）取得之前不提交：否则以空路径报「无效」
  const loadingHome = pathDraft === null && connection !== undefined && home.isPending

  const changeConnection = (id: string): void => {
    setChosenId(id)
    setIdentityValue(LOGIN)
    setPathDraft(null)
    setFailure(null)
  }
  const changeIdentity = (value: string): void => {
    setIdentityValue(value)
    setPathDraft(null)
    setFailure(null)
  }
  const manageConnections = (): void => {
    useUiStore.getState().showView('connections')
    onDone()
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setSubmitted(true)
    if (connection === undefined || loadingHome || pending) return
    if (normalized === null) return
    setPending(true)
    setFailure(null)
    try {
      await add.mutateAsync({
        kind: 'folder',
        workspaceId,
        parentId: null,
        uri: formatSftpUri({ connectionId: connection.id, identity, path: normalized })
      })
      onDone()
    } catch (err) {
      setFailure(t(`errors:${err instanceof AppError ? err.code : 'UNKNOWN'}`))
    } finally {
      setPending(false)
    }
  }

  const homeFailure =
    pathDraft === null && home.isError
      ? t(`errors:${home.error instanceof AppError ? home.error.code : 'UNKNOWN'}`)
      : null

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t('explorer:addRemoteTitle')}</DialogTitle>
        <DialogDescription>{t('explorer:addRemoteDescription')}</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor={ids.connection}>{t('explorer:remoteConnection')}</FieldLabel>
          <div className="flex gap-2">
            {connection === undefined ? (
              <p className="min-w-0 flex-1 self-center text-sm text-muted-foreground">
                {t('explorer:remoteNoConnections')}
              </p>
            ) : (
              <div className="min-w-0 flex-1">
                <Picker
                  id={ids.connection}
                  value={connection.id}
                  options={(connections ?? []).map((c) => ({ value: c.id, label: c.name }))}
                  onChange={changeConnection}
                />
              </div>
            )}
            <Button type="button" variant="outline" onClick={manageConnections}>
              <ServerCogIcon data-icon="inline-start" />
              {t('explorer:manageConnections')}
            </Button>
          </div>
        </Field>
        {connection === undefined ? null : (
          <>
            <Field>
              <FieldLabel htmlFor={ids.identity}>{t('explorer:remoteIdentity')}</FieldLabel>
              <Picker
                id={ids.identity}
                value={identity ?? LOGIN}
                options={[
                  {
                    value: LOGIN,
                    label: t('explorer:remoteLoginUser', { name: connection.username })
                  },
                  ...connection.identities.map((name) => ({ value: name, label: name }))
                ]}
                onChange={changeIdentity}
              />
            </Field>
            <Field data-invalid={pathError !== undefined}>
              <FieldLabel htmlFor={ids.path}>{t('explorer:remotePath')}</FieldLabel>
              <Input
                id={ids.path}
                ref={pathRef}
                value={path}
                spellCheck={false}
                autoComplete="off"
                placeholder="/"
                aria-invalid={pathError !== undefined}
                aria-describedby={pathError === undefined ? ids.pathHint : ids.pathError}
                onChange={(e) => {
                  setPathDraft(e.target.value)
                  setFailure(null)
                }}
              />
              {loadingHome ? (
                <FieldDescription id={ids.pathHint} className="flex items-center gap-2">
                  <Spinner aria-hidden />
                  {t('explorer:remoteHomeLoading')}
                </FieldDescription>
              ) : homeFailure !== null ? (
                <FieldError id={ids.pathHint}>{homeFailure}</FieldError>
              ) : identity !== null ? (
                <FieldDescription id={ids.pathHint}>
                  {t('explorer:remoteIdentityHint')}
                </FieldDescription>
              ) : null}
              {pathError === undefined ? null : (
                <FieldError id={ids.pathError}>{pathError}</FieldError>
              )}
            </Field>
          </>
        )}
        {failure === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          {t('explorer:cancel')}
        </DialogClose>
        <Button type="submit" disabled={connection === undefined || loadingHome || pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {t('explorer:add')}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** 单选的下拉（按钮显示当前项）：选项少、需要跟随按钮宽度时用菜单的单选组实现 */
function Picker({
  id,
  value,
  options,
  onChange
}: {
  id: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
}): JSX.Element {
  const current = options.find((o) => o.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button id={id} type="button" variant="outline" className="w-full justify-between" />
        }
      >
        <span className="truncate">{current?.label ?? ''}</span>
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-(--anchor-width)">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as string)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} closeOnClick>
              <span className="truncate">{o.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
