import { useId, useRef, useState, type FormEvent, type JSX, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { notify } from '@renderer/stores/messages-store'
import { AppError, type Workspace, type WorkspaceColor } from '@pch/shared'
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@pch/ui/components/dialog'
import { Field, FieldError, FieldLabel, FieldTitle } from '@pch/ui/components/field'
import { Input } from '@pch/ui/components/input'
import { Spinner } from '@pch/ui/components/spinner'
import { Textarea } from '@pch/ui/components/textarea'
import { useActiveWorkspace, useWorkspaceActions } from '@renderer/data/workspace'
import { ColorSwatches } from './color-swatches'
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  createAndActivate,
  descriptionValue,
  removeWorkspace
} from './workspace-flows'

function errorMessage(t: (key: string) => string, e: unknown): string {
  return t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`)
}

interface NameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  submitLabel: string
  initialValue: string
  /** 提交 trim 后的名称；true = 成功（关闭对话框），false = 失败（保持打开，错误由调用方提示） */
  onSubmit: (name: string) => Promise<boolean>
}

/** 新建与重命名共用的「输入工作区名称」对话框；空白不可提交 */
function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initialValue,
  onSubmit
}: NameDialogProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} initialFocus={inputRef}>
        {/* 内容在关闭后卸载，每次打开都重新以 initialValue 初始化 */}
        <NameForm
          inputRef={inputRef}
          title={title}
          description={description}
          submitLabel={submitLabel}
          initialValue={initialValue}
          onSubmit={onSubmit}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function NameForm({
  inputRef,
  title,
  description,
  submitLabel,
  initialValue,
  onSubmit,
  onDone
}: Omit<NameDialogProps, 'open' | 'onOpenChange'> & {
  inputRef: RefObject<HTMLInputElement | null>
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const inputId = useId()
  const [value, setValue] = useState(initialValue)
  const [pending, setPending] = useState(false)
  const name = value.trim()
  const blank = name === ''

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (blank || pending) return
    setPending(true)
    try {
      if (await onSubmit(name)) onDone()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <Field data-invalid={blank}>
        <FieldLabel htmlFor={inputId}>{t('workspace:name')}</FieldLabel>
        <Input
          id={inputId}
          ref={inputRef}
          value={value}
          maxLength={MAX_NAME_LENGTH}
          aria-invalid={blank}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
        {blank ? <FieldError>{t('workspace:nameRequired')}</FieldError> : null}
      </Field>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          {t('workspace:cancel')}
        </DialogClose>
        <Button type="submit" disabled={blank || pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

interface OpenProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 新建工作区：创建后自动切换过去 */
export function NewWorkspaceDialog({ open, onOpenChange }: OpenProps): JSX.Element {
  const { t } = useTranslation()
  const { create, activate } = useWorkspaceActions()

  const submit = (name: string): Promise<boolean> =>
    createAndActivate(
      {
        create: (n) => create.mutateAsync({ name: n }),
        activate: (id) => activate.mutateAsync(id),
        onCreateError: (e) => notify('error', errorMessage(t, e)),
        onActivateError: () => notify('error', t('workspace:createdNotActivated'))
      },
      name
    )

  return (
    <NameDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('workspace:createTitle')}
      description={t('workspace:createDescription')}
      submitLabel={t('workspace:create')}
      initialValue=""
      onSubmit={submit}
    />
  )
}

/** 重命名工作区；target.displayName 为预填的名称（默认工作区未改名时是本地化的默认名） */
export function RenameWorkspaceDialog({
  open,
  onOpenChange,
  target,
  displayName
}: OpenProps & { target: Workspace; displayName: string }): JSX.Element {
  const { t } = useTranslation()
  const { update } = useWorkspaceActions()

  const submit = async (name: string): Promise<boolean> => {
    if (name === displayName) return true
    try {
      await update.mutateAsync({ id: target.id, name })
      return true
    } catch (e) {
      notify('error', errorMessage(t, e))
      // 工作区在对话框打开期间已被删除：无法重试，关闭对话框（错误已提示）
      return e instanceof AppError && e.code === 'WORKSPACE_NOT_FOUND'
    }
  }

  return (
    <NameDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('workspace:renameTitle')}
      description={t('workspace:renameDescription')}
      submitLabel={t('workspace:save')}
      initialValue={displayName}
      onSubmit={submit}
    />
  )
}

/**
 * 编辑工作区（工作区一览的「編集…」）：名称、说明、颜色（与选择器编辑卡片同一套颜色选择）。
 * 只提交变化了的字段；名称不可为空（默认工作区恢复本地化名称另有「既定の名前に戻す」）。
 * target.displayName 为预填的名称（默认工作区未改名时是本地化的默认名）
 */
export function EditWorkspaceDialog({
  open,
  onOpenChange,
  target,
  displayName
}: OpenProps & { target: Workspace; displayName: string }): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} initialFocus={inputRef}>
        {/* 内容在关闭后卸载，每次打开都以最新的值重新初始化 */}
        <EditForm
          inputRef={inputRef}
          target={target}
          displayName={displayName}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function EditForm({
  inputRef,
  target,
  displayName,
  onDone
}: {
  inputRef: RefObject<HTMLInputElement | null>
  target: Workspace
  displayName: string
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { update } = useWorkspaceActions()
  const ids = useId()
  const [name, setName] = useState(displayName)
  const [description, setDescription] = useState(target.description ?? '')
  const [color, setColor] = useState<WorkspaceColor | null>(target.color)
  const [pending, setPending] = useState(false)
  const trimmed = name.trim()
  const blank = trimmed === ''

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (blank || pending) return
    const desc = descriptionValue(description)
    const patch = {
      ...(trimmed === displayName ? {} : { name: trimmed }),
      ...(desc === target.description ? {} : { description: desc }),
      ...(color === target.color ? {} : { color })
    }
    if (Object.keys(patch).length === 0) {
      onDone()
      return
    }
    setPending(true)
    try {
      await update.mutateAsync({ id: target.id, ...patch })
      onDone()
    } catch (err) {
      notify('error', errorMessage(t, err))
      // 工作区在对话框打开期间已被删除：无法重试，关闭对话框（错误已提示）
      if (err instanceof AppError && err.code === 'WORKSPACE_NOT_FOUND') onDone()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t('workspace:editTitle')}</DialogTitle>
        <DialogDescription>{t('workspace:editDescription')}</DialogDescription>
      </DialogHeader>
      <Field data-invalid={blank}>
        <FieldLabel htmlFor={`${ids}-name`}>{t('workspace:fieldName')}</FieldLabel>
        <Input
          id={`${ids}-name`}
          ref={inputRef}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          aria-invalid={blank}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
        {blank ? <FieldError>{t('workspace:nameRequired')}</FieldError> : null}
      </Field>
      <Field>
        <FieldLabel htmlFor={`${ids}-desc`}>{t('workspace:fieldDescription')}</FieldLabel>
        <Textarea
          id={`${ids}-desc`}
          rows={3}
          className="max-h-40 resize-none"
          value={description}
          placeholder={t('workspace:descriptionPlaceholder')}
          maxLength={MAX_DESCRIPTION_LENGTH}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field>
        <FieldTitle id={`${ids}-color`}>{t('workspace:fieldColor')}</FieldTitle>
        <ColorSwatches
          value={color}
          onChange={setColor}
          labelledBy={`${ids}-color`}
          gap="var(--popover)"
        />
      </Field>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          {t('workspace:cancel')}
        </DialogClose>
        <Button type="submit" disabled={blank || pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {t('workspace:save')}
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * 删除工作区的确认框：只删除工作区及其条目，绝不删除磁盘上的文件或文件夹。
 * 目标是当前工作区（或当前工作区尚未知）时先切到默认工作区（removeWorkspace）；工作区一览中删除其他工作区时不切换。
 * 确认后在删除完成前保持打开（显示进度）：一览页的删除经 ui-store 由常驻的标题栏切换器渲染本对话框，
 * 切到默认工作区时一览页卸载也不影响它（M2-F2）
 */
export function DeleteWorkspaceDialog({
  open,
  onOpenChange,
  target,
  displayName
}: OpenProps & { target: Pick<Workspace, 'id'>; displayName: string }): JSX.Element {
  const { t } = useTranslation()
  const { remove, activate } = useWorkspaceActions()
  const { data: active } = useActiveWorkspace()
  const [pending, setPending] = useState(false)

  const confirm = async (): Promise<void> => {
    setPending(true)
    try {
      // 当前工作区先切到默认工作区再删除；target.id 与当前工作区在点击时锁定
      const closed = await removeWorkspace(
        {
          activate: (id) => activate.mutateAsync(id),
          remove: (id) => remove.mutateAsync(id),
          onError: (e) => notify('error', errorMessage(t, e))
        },
        target.id,
        active?.id
      )
      if (closed) onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('workspace:deleteTitle', { name: displayName })}</AlertDialogTitle>
          <AlertDialogDescription>{t('workspace:deleteDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('workspace:cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={() => void confirm()}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {t('workspace:delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
