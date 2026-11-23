import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { FolderOpenIcon, XIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConnectionDto } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import { Checkbox } from '@pch/ui/components/checkbox'
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
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle
} from '@pch/ui/components/field'
import { Input } from '@pch/ui/components/input'
import { RadioGroup, RadioGroupItem } from '@pch/ui/components/radio-group'
import { Spinner } from '@pch/ui/components/spinner'
import { saveConnection, useConnections } from '@renderer/data/connections'
import { call } from '@renderer/lib/ipc'
import { notify } from '@renderer/stores/messages-store'
import {
  buildSaveInput,
  identityError,
  initialForm,
  secretKept,
  sudoSecretKept,
  type ConnectionForm,
  type ConnectionFormErrorKey
} from './connection-form'
import { errorCode, errorText } from './error-text'
import { HostKeyDetails } from './host-key-prompt'
import { TrustKeyDialog } from './trust-key-dialog'

interface ConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 编辑的连接（打开时的快照）；undefined = 新建 */
  connection: ConnectionDto | undefined
  /** 保存成功（编辑后旧的测试结果作废） */
  onSaved?: (saved: ConnectionDto) => void
}

/**
 * 新建 / 编辑连接（设计 5.8）：名称、主机、端口、用户名、认证方式（密码 / 私钥：路径 + 口令）、
 * 切换身份（标签输入）、sudo 密码（同登录密码 / 另外设置）、sftp-server 路径（自动 / 指定）、
 * 已信任的主机密钥（只读 +「信任新的密钥」）。机密输入框编辑时为空，留空 = 不变
 */
export function ConnectionDialog({
  open,
  onOpenChange,
  connection,
  onSaved
}: ConnectionDialogProps): JSX.Element {
  const nameRef = useRef<HTMLInputElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} initialFocus={nameRef} className="sm:max-w-lg">
        {/* 内容在关闭后卸载，每次打开都以当前连接重新初始化 */}
        <ConnectionFormBody
          nameRef={nameRef}
          connection={connection}
          onDone={(saved) => {
            onSaved?.(saved)
            onOpenChange(false)
          }}
          onGone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function ConnectionFormBody({
  nameRef,
  connection,
  onDone,
  onGone
}: {
  nameRef: RefObject<HTMLInputElement | null>
  connection: ConnectionDto | undefined
  onDone: (saved: ConnectionDto) => void
  onGone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [form, setForm] = useState<ConnectionForm>(() => initialForm(connection))
  const [draft, setDraft] = useState('')
  const [submitted, setSubmitted] = useState(false)
  // 保存不经 useMutation（明文机密不能留在 MutationCache 中）：进行中状态自己保存，ref 防止连按
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const draftRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof ConnectionForm>(key: K, value: ConnectionForm[K]): void =>
    setForm((f) => ({ ...f, [key]: value }))

  const draftError = identityError(draft, form.identities)
  const checked = buildSaveInput(form, connection)
  const errors = submitted && !checked.ok ? checked.errors : {}
  const err = (key: keyof ConnectionForm): string | undefined => {
    const e: ConnectionFormErrorKey | undefined = errors[key]
    return e === undefined ? undefined : t(`connections:formError.${e}`)
  }

  const addDraft = (): boolean => {
    const name = draft.trim()
    if (name === '' || draftError !== null) return name === ''
    set('identities', [...form.identities, name])
    setDraft('')
    return true
  }

  const onDraftKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addDraft()
    } else if (e.key === 'Backspace' && draft === '' && form.identities.length > 0) {
      set('identities', form.identities.slice(0, -1))
    }
  }

  const browseKey = async (): Promise<void> => {
    try {
      const [path] = await call('system.selectPaths', { kind: 'file', multiple: false })
      if (path !== undefined) set('keyPath', path)
    } catch (e) {
      notify('error', errorText(t, e))
    }
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (savingRef.current) return
    setSubmitted(true)
    // 输入中但还没按回车的身份：合法则一并保存，不合法则停在输入框
    const pendingName = draft.trim()
    if (pendingName !== '' && draftError !== null) {
      draftRef.current?.focus()
      return
    }
    const next =
      pendingName === '' ? form : { ...form, identities: [...form.identities, pendingName] }
    const built = buildSaveInput(next, connection)
    if (!built.ok) return
    savingRef.current = true
    setSaving(true)
    try {
      const saved = await saveConnection(built.input)
      onDone(saved)
    } catch (err) {
      notify('error', errorText(t, err))
      if (errorCode(err) === 'CONN_NOT_FOUND') onGone()
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const keepSecret = secretKept(form, connection)

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {t(connection ? 'connections:editTitle' : 'connections:newTitle')}
        </DialogTitle>
        <DialogDescription>{t('connections:dialogDescription')}</DialogDescription>
      </DialogHeader>
      {/* 字段较多：中间部分滚动，标题与按钮固定 */}
      <div className="-mx-4 max-h-[60vh] overflow-y-auto px-4 py-1">
        <FieldGroup className="gap-4">
          <TextField
            label={t('connections:name')}
            value={form.name}
            onChange={(v) => set('name', v)}
            error={err('name')}
            inputRef={nameRef}
            placeholder={t('connections:namePlaceholder')}
            maxLength={100}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-start gap-3">
            <TextField
              label={t('connections:host')}
              value={form.host}
              onChange={(v) => set('host', v)}
              error={err('host')}
              maxLength={255}
            />
            <TextField
              label={t('connections:port')}
              value={form.port}
              onChange={(v) => set('port', v)}
              error={err('port')}
              inputMode="numeric"
              maxLength={5}
            />
          </div>
          <TextField
            label={t('connections:username')}
            value={form.username}
            onChange={(v) => set('username', v)}
            error={err('username')}
            maxLength={32}
          />

          <Choice
            legend={t('connections:auth')}
            value={form.auth}
            onChange={(v) => set('auth', v)}
            options={[
              { value: 'password', label: t('connections:authPassword') },
              { value: 'key', label: t('connections:authKey') }
            ]}
          />
          {form.auth === 'key' ? (
            <KeyPathField
              value={form.keyPath}
              onChange={(v) => set('keyPath', v)}
              onBrowse={() => void browseKey()}
              error={err('keyPath')}
            />
          ) : null}
          <TextField
            label={t(form.auth === 'password' ? 'connections:password' : 'connections:passphrase')}
            type="password"
            value={form.secret}
            onChange={(v) => set('secret', v)}
            error={err('secret')}
            placeholder={
              keepSecret
                ? t('connections:secretSaved')
                : form.auth === 'key'
                  ? t('connections:passphraseNone')
                  : undefined
            }
            autoComplete="new-password"
            maxLength={1024}
          />
          {form.auth === 'key' && keepSecret ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.clearSecret}
                disabled={form.secret !== ''}
                onCheckedChange={(v) => set('clearSecret', v)}
              />
              {t('connections:clearPassphrase')}
            </label>
          ) : null}

          <IdentityTags
            identities={form.identities}
            onRemove={(name) =>
              set(
                'identities',
                form.identities.filter((i) => i !== name)
              )
            }
            draft={draft}
            onDraftChange={setDraft}
            onDraftKeyDown={onDraftKeyDown}
            draftRef={draftRef}
            error={draftError === null ? undefined : t(`connections:formError.${draftError}`)}
          />

          <Choice
            legend={t('connections:sudo')}
            value={form.sudoMode}
            onChange={(v) => set('sudoMode', v)}
            options={[
              // 私钥认证时没有登录密码可用：不提交 sudo 密码（只适用于 NOPASSWD）
              {
                value: 'login',
                label: t(form.auth === 'key' ? 'connections:sudoNone' : 'connections:sudoSame')
              },
              { value: 'separate', label: t('connections:sudoSeparate') }
            ]}
            description={t('connections:sudoHint')}
          >
            {form.sudoMode === 'separate' ? (
              <TextField
                label={t('connections:sudo')}
                hideLabel
                type="password"
                value={form.sudoSecret}
                onChange={(v) => set('sudoSecret', v)}
                error={err('sudoSecret')}
                placeholder={sudoSecretKept(connection) ? t('connections:secretSaved') : undefined}
                autoComplete="new-password"
                maxLength={1024}
              />
            ) : null}
          </Choice>

          <Choice
            legend={t('connections:sftpServer')}
            value={form.sftpMode}
            onChange={(v) => set('sftpMode', v)}
            options={[
              { value: 'auto', label: t('connections:sftpAuto') },
              { value: 'custom', label: t('connections:sftpCustom') }
            ]}
          >
            {form.sftpMode === 'custom' ? (
              <TextField
                label={t('connections:sftpServer')}
                hideLabel
                value={form.sftpServerPath}
                onChange={(v) => set('sftpServerPath', v)}
                error={err('sftpServerPath')}
                placeholder="/usr/libexec/openssh/sftp-server"
                maxLength={255}
              />
            ) : null}
          </Choice>

          {connection ? <HostKeySection id={connection.id} fallback={connection} /> : null}
        </FieldGroup>
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          {t('connections:cancel')}
        </DialogClose>
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner data-icon="inline-start" aria-hidden /> : null}
          {t('connections:save')}
        </Button>
      </DialogFooter>
    </form>
  )
}

function TextField({
  label,
  hideLabel = false,
  value,
  onChange,
  error,
  inputRef,
  type = 'text',
  placeholder,
  inputMode,
  autoComplete = 'off',
  maxLength
}: {
  label: string
  hideLabel?: boolean
  value: string
  onChange: (value: string) => void
  error: string | undefined
  inputRef?: RefObject<HTMLInputElement | null>
  type?: 'text' | 'password'
  placeholder?: string
  inputMode?: 'numeric'
  autoComplete?: string
  maxLength?: number
}): JSX.Element {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <Field data-invalid={error !== undefined}>
      {/* 附在单选下方的输入框：标签就是单选组的标题，不重复显示 */}
      {hideLabel ? null : <FieldLabel htmlFor={id}>{label}</FieldLabel>}
      <Input
        id={id}
        ref={inputRef}
        type={type}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        spellCheck={false}
        maxLength={maxLength}
        aria-label={hideLabel ? label : undefined}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(e) => onChange(e.target.value)}
      />
      {error === undefined ? null : <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  )
}

/** 单选（两项横排），选中项下方可放附加输入 */
function Choice<V extends string>({
  legend,
  value,
  onChange,
  options,
  description,
  children
}: {
  legend: string
  value: V
  onChange: (value: V) => void
  options: { value: V; label: string }[]
  description?: string
  children?: ReactNode
}): JSX.Element {
  const id = useId()
  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label">{legend}</FieldLegend>
      {description === undefined ? null : <FieldDescription>{description}</FieldDescription>}
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as V)}
        className="grid-cols-2 gap-x-4"
      >
        {options.map((o) => (
          <Field key={o.value} orientation="horizontal">
            <RadioGroupItem value={o.value} id={`${id}-${o.value}`} />
            <FieldLabel htmlFor={`${id}-${o.value}`}>{o.label}</FieldLabel>
          </Field>
        ))}
      </RadioGroup>
      {children}
    </FieldSet>
  )
}

function KeyPathField({
  value,
  onChange,
  onBrowse,
  error
}: {
  value: string
  onChange: (value: string) => void
  onBrowse: () => void
  error: string | undefined
}): JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  const errorId = `${id}-error`
  return (
    <Field data-invalid={error !== undefined}>
      <FieldLabel htmlFor={id}>{t('connections:keyPath')}</FieldLabel>
      {/* 校验失败时 Field 整体变红；「参照…」按钮保持正文颜色 */}
      <div className="flex gap-2 text-foreground">
        <Input
          id={id}
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : errorId}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button type="button" variant="outline" onClick={onBrowse}>
          <FolderOpenIcon data-icon="inline-start" />
          {t('connections:browse')}
        </Button>
      </div>
      <FieldDescription>{t('connections:keyHint')}</FieldDescription>
      {error === undefined ? null : <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  )
}

/** 切换身份的标签输入：回车添加、逐个删除（Backspace 删除最后一个），每项即时校验 */
function IdentityTags({
  identities,
  onRemove,
  draft,
  onDraftChange,
  onDraftKeyDown,
  draftRef,
  error
}: {
  identities: readonly string[]
  onRemove: (name: string) => void
  draft: string
  onDraftChange: (value: string) => void
  onDraftKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  draftRef: RefObject<HTMLInputElement | null>
  error: string | undefined
}): JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  const errorId = `${id}-error`
  return (
    <Field data-invalid={error !== undefined}>
      <FieldLabel htmlFor={id}>{t('connections:identities')}</FieldLabel>
      {identities.length === 0 ? null : (
        <ul aria-label={t('connections:identities')} className="flex flex-wrap gap-1.5">
          {identities.map((name) => (
            <li
              key={name}
              className="inline-flex h-6 items-center gap-0.5 rounded-md border bg-muted pl-2 font-mono text-xs text-foreground"
            >
              {name}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('connections:removeIdentity', { name })}
                title={t('connections:removeIdentity', { name })}
                onClick={() => onRemove(name)}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        ref={draftRef}
        value={draft}
        placeholder={t('connections:identityPlaceholder')}
        spellCheck={false}
        autoComplete="off"
        maxLength={32}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={onDraftKeyDown}
      />
      <FieldDescription>{t('connections:identitiesHint')}</FieldDescription>
      {error === undefined ? null : <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  )
}

/**
 * 已信任的主机密钥（只读）；服务器出示了不同的密钥时显示新密钥与「信任新的密钥」
 * （经与行内相同的确认框，显示新旧指纹后才信任）
 */
function HostKeySection({ id, fallback }: { id: string; fallback: ConnectionDto }): JSX.Element {
  const { t } = useTranslation()
  const { data } = useConnections()
  const [trustOpen, setTrustOpen] = useState(false)
  const live = data?.find((c) => c.id === id) ?? fallback
  return (
    <div className="grid gap-2">
      <FieldTitle>{t('connections:hostKey')}</FieldTitle>
      {live.hostKey ? (
        <HostKeyDetails hostKey={live.hostKey} />
      ) : (
        <p className="text-xs text-muted-foreground">{t('connections:hostKeyNone')}</p>
      )}
      {live.presentedHostKey ? (
        <div className="grid gap-2 rounded-md border border-destructive/40 p-2">
          <p className="text-xs font-medium text-destructive">
            {t('connections:hostKeyPresented')}
          </p>
          <HostKeyDetails hostKey={live.presentedHostKey} />
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setTrustOpen(true)}>
              {t('connections:trustNewKey')}
            </Button>
          </div>
        </div>
      ) : null}
      <TrustKeyDialog open={trustOpen} onOpenChange={setTrustOpen} connection={live} />
    </div>
  )
}
