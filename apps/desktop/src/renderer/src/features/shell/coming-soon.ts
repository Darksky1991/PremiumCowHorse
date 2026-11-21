import { notify } from '@renderer/stores/messages-store'
import type { i18n } from 'i18next'

/** 尚未实现的入口统一给出提示，而不是静默无反应 */
export function notifyComingSoon(i18next: i18n): void {
  notify('info', i18next.t('welcome:comingSoon'))
}
