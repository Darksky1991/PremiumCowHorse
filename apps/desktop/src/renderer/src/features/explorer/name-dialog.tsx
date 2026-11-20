import { useId, useRef, useState, type FormEvent, type JSX, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
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
import { Field, FieldError, FieldLabel } from '@pch/ui/components/field'
import { Input } from '@pch/ui/components/input'
import { Spinner } from '@pch/ui/components/spinner'

/** 与 entry.add / entry.update 的 label 校验一致（trim 后 1~200 个字符） */
const MAX_NAME_LENGTH = 200

export interface NameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  fieldLabel: string
  submitLabel: string
  /** 输入框的初始值（打开时预填并全选） */
  initialValue: string
  /** 提交 trim 后的名称；返回 true 表示成功（对话框关闭），false 表示失败（保持打开，错误由调用方提示） */
  onSubmit: (name: string) => Promise<boolean>
  /** 关闭后焦点回到的元素（资源树，保证键盘操作继续可用） */
  finalFocus: RefObject<HTMLElement | null>
}

/** 重命名与新建分组共用的「输入一个名称」对话框；空白名称不可提交 */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  fieldLabel,
  submitLabel,
  initialValue,
  onSubmit,
  finalFocus
}: NameDialogProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} initialFocus={inputRef} finalFocus={finalFocus}>
        {/* 内容在关闭后卸载，每次打开都重新以 initialValue 初始化 */}
        <NameForm
          inputRef={inputRef}
          title={title}
          description={description}
          fieldLabel={fieldLabel}
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
  fieldLabel,
  submitLabel,
  initialValue,
  onSubmit,
  onDone
}: Pick<
  NameDialogProps,
  'title' | 'description' | 'fieldLabel' | 'submitLabel' | 'initialValue' | 'onSubmit'
> & {
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
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <Field data-invalid={blank}>
        <FieldLabel htmlFor={inputId}>{fieldLabel}</FieldLabel>
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
        {blank ? <FieldError>{t('explorer:nameRequired')}</FieldError> : null}
      </Field>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          {t('explorer:cancel')}
        </DialogClose>
        <Button type="submit" disabled={blank || pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
