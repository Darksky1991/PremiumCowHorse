import { toast } from 'sonner'
import type { i18n } from 'i18next'

/** 尚未实现的入口统一给出提示，而不是静默无反应 */
export function notifyComingSoon(i18next: i18n): void {
  toast.info(i18next.t('welcome:comingSoon'))
}
