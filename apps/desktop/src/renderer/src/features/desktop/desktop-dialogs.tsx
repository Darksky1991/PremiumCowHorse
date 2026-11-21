import { useId, useRef, useState, type FormEvent, type JSX, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { AppError } from '@pch/shared'
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
import { Field, FieldLabel } from '@pch/ui/components/field'
import { Input } from '@pch/ui/components/input'
import { Spinner } from '@pch/ui/components/spinner'
import { deleteDesktop, renameDesktop } from '@renderer/data/desktop'
import { notify } from '@renderer/stores/messages-store'

/** 与 desktop.rename 的 name 校验一致（最长 100 个字符） */
const MAX_NAME_LENGTH = 100

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 目标快照 id（打开时锁定，关闭动画期间保持） */
  id: number
}

function fail(t: (key: string) => string, e: unknown): void {
  notify('error', t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
}

/** 改名：空白 = 恢复为无名称（按种类显示） */
export function RenameSnapshotDialog({
  open,
  onOpenChange,
  id,
  initialName
}: DialogProps & { initialName: string }): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} initialFocus={inputRef}>
        {/* 内容在关闭后卸载，每次打开都以当前名称重新初始化 */}
        <RenameForm
          inputRef={inputRef}
          id={id}
          initialName={initialName}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function RenameForm({
  inputRef,
  id,
  initialName,
  onDone
}: {
  inputRef: RefObject<HTMLInputElement | null>
  id: number
  initialName: string
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const inputId = useId()
  const [value, setValue] = useState(initialName)
  const [pending, setPending] = useState(false)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (pending) return
    setPending(true)
    try {
      const name = value.trim()
      await renameDesktop(id, name === '' ? null : name)
      onDone()
    } catch (err) {
      fail(t, err)
      // 记录已被删除时无法重试
      if (err instanceof AppError && err.code === 'DESKTOP_SNAPSHOT_NOT_FOUND') onDone()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t('desktop:renameTitle')}</DialogTitle>
        <DialogDescription>{t('desktop:renameDescription')}</DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor={inputId}>{t('desktop:nameLabel')}</FieldLabel>
        <Input
          id={inputId}
          ref={inputRef}
          value={value}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
      </Field>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          {t('desktop:cancel')}
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {t('desktop:renameSubmit')}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** 删除确认：只删除记录本身 */
export function DeleteSnapshotDialog({ open, onOpenChange, id }: DialogProps): JSX.Element {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)

  const confirm = async (): Promise<void> => {
    setPending(true)
    try {
      await deleteDesktop(id)
      onOpenChange(false)
    } catch (e) {
      fail(t, e)
      if (e instanceof AppError && e.code === 'DESKTOP_SNAPSHOT_NOT_FOUND') onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('desktop:deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('desktop:deleteDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('desktop:cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={() => void confirm()}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {t('desktop:deleteSubmit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
