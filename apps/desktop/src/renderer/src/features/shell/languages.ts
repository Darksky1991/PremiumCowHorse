import type { Language } from '@pch/shared'

/** 语言名称始终用该语言自身书写，便于在看不懂当前界面语言时也能找到 */
export const LANGUAGE_NAMES: Record<Language, string> = {
  ja: '日本語',
  'zh-CN': '简体中文',
  en: 'English'
}
