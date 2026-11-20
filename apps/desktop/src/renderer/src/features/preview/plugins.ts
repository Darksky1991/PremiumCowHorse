import { definePreviewPlugin, type AnyPreviewPlugin } from '@pch/plugin-sdk'
import { getBootstrap } from '@renderer/lib/ipc'

/** 渲染即抛错的组件（e2e 用） */
function CrashOnRender(): never {
  throw new Error('e2e: preview plugin failed to render')
}

/**
 * 仅 e2e：验证插件崩溃只影响自己的标签（Review Focus 3）。
 * `.crash` 渲染时抛错，`.crashload` 懒加载失败。只在 bootstrap 的 e2eCrashPlugin 为 true 时注册
 * （主进程只在未打包且 PCH_E2E_CRASH_PLUGIN=1 时设置），正式使用中不会出现在注册表里。
 */
const e2eCrashPlugins: readonly AnyPreviewPlugin[] = [
  definePreviewPlugin({
    manifest: {
      id: 'pch.e2e.crash',
      name: 'name',
      version: '0.0.0',
      match: { kinds: ['file'], extensions: ['crash'] }
    },
    i18n: { en: { name: 'E2E crash' } },
    load: async () => ({ default: CrashOnRender })
  }),
  definePreviewPlugin({
    manifest: {
      id: 'pch.e2e.crash-load',
      name: 'name',
      version: '0.0.0',
      match: { kinds: ['file'], extensions: ['crashload'] }
    },
    i18n: { en: { name: 'E2E crash on load' } },
    load: () => Promise.reject(new Error('e2e: preview plugin failed to load'))
  })
]

/** 注册表使用的插件列表：内置插件（由 app/ 传入），e2e 时追加测试插件 */
export function previewPlugins(builtin: readonly AnyPreviewPlugin[]): readonly AnyPreviewPlugin[] {
  return getBootstrap()?.e2eCrashPlugin ? [...builtin, ...e2eCrashPlugins] : builtin
}
