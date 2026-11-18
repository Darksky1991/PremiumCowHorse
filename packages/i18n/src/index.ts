import i18next, { type i18n } from 'i18next'
import type { Language } from '@pch/shared'
import ja from './locales/ja'
import zhCN from './locales/zh-CN'
import en from './locales/en'
import type { Namespace, Resource } from './types'

export type { Namespace, Resource } from './types'

export const resources: Record<Language, Resource> = { ja, 'zh-CN': zhCN, en }
export const namespaces = Object.keys(ja) as Namespace[]

/**
 * 主进程与渲染进程共用的 i18next 实例工厂。
 * 资源随代码打包、同步初始化，首帧即可取得正确文案。
 */
export function createI18n(language: Language, init?: (instance: i18n) => i18n): i18n {
  const instance = init ? init(i18next.createInstance()) : i18next.createInstance()
  void instance.init({
    lng: language,
    fallbackLng: 'en',
    resources,
    ns: namespaces,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    initAsync: false,
    returnNull: false
  })
  return instance
}
