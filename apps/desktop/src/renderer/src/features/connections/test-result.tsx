import type { JSX } from 'react'
import { CircleCheckIcon, CircleDashedIcon, CircleXIcon, XIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConnectionTestResult } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import { Spinner } from '@pch/ui/components/spinner'
import { errorText } from './error-text'
import { testRows, type TestRow } from './test-steps'

export type TestState =
  | { status: 'running' }
  | { status: 'done'; result: ConnectionTestResult }
  | { status: 'error'; error: unknown }

export function TestResultPanel({
  state,
  identities,
  onClose
}: {
  state: TestState
  identities: readonly string[]
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <section
      aria-label={t('connections:testResult')}
      aria-busy={state.status === 'running'}
      className="relative mt-1.5 rounded-md border bg-background px-2 py-1.5 text-xs"
    >
      {state.status === 'running' ? null : (
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute top-0.5 right-0.5"
          aria-label={t('connections:closeResult')}
          title={t('connections:closeResult')}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      )}
      {state.status === 'running' ? (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Spinner aria-hidden />
          {t('connections:testing')}
        </p>
      ) : state.status === 'error' ? (
        <p role="alert" className="pr-6 text-destructive">
          {errorText(t, state.error)}
        </p>
      ) : (
        <ul className="flex flex-col gap-1 pr-6">
          {testRows(state.result, identities).map((row) => (
            <StepRow key={row.key} row={row} />
          ))}
        </ul>
      )}
    </section>
  )
}

function StepRow({ row }: { row: TestRow }): JSX.Element {
  const { t } = useTranslation()
  const { step } = row
  const label = t(`connections:step.${row.kind}`, { identity: row.identity })
  const info = step?.info
  const detail =
    step && !step.ok && step.error
      ? errorText(t, step.error)
      : info?.home !== undefined
        ? t('connections:homeInfo', { path: info.home })
        : info?.sftpServerPath !== undefined
          ? t('connections:identityInfo', {
              path: info.sftpServerPath,
              mode: t(info.mode === 'pty' ? 'connections:modePty' : 'connections:modeNopty')
            })
          : null
  const statusText =
    step === null
      ? t('connections:stepSkipped')
      : step.ok
        ? t('connections:stepOk')
        : t('connections:stepFailed')
  return (
    <li data-ok={step === null ? undefined : String(step.ok)} className="flex min-w-0 gap-1.5">
      {step === null ? (
        <CircleDashedIcon aria-hidden className="mt-px size-3.5 shrink-0 text-muted-foreground" />
      ) : step.ok ? (
        <CircleCheckIcon aria-hidden className="mt-px size-3.5 shrink-0 text-emerald-600" />
      ) : (
        <CircleXIcon aria-hidden className="mt-px size-3.5 shrink-0 text-destructive" />
      )}
      <span className="min-w-0 flex-1">
        <span className={step === null ? 'text-muted-foreground' : 'font-medium'}>{label}</span>
        <span className="sr-only"> {statusText}</span>
        {detail === null ? null : (
          <span
            className={
              step && !step.ok
                ? 'block break-words text-destructive'
                : 'block break-all text-muted-foreground'
            }
          >
            {detail}
          </span>
        )}
      </span>
    </li>
  )
}
