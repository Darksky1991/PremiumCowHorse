import type { AnyPreviewPlugin } from '@pch/plugin-sdk'
import { fallbackPlugin } from './fallback'
import { folderPlugin } from './folder'
import { htmlPlugin } from './html'
import { textPlugin } from './text'

/**
 * 内置预览插件（doc 5.1 / 9.4）：每个插件一个子目录，只依赖 @pch/plugin-sdk、@pch/ui 与纯逻辑包 @pch/text-engine（另允许 lucide-react 图标、@tanstack/react-virtual 虚拟滚动），
 * 子目录之间不互相 import（eslint 的模块边界规则强制）。注册顺序即同分时的优先顺序
 * （folder、html、markdown（M2 Task 8）、office（M2 Task 10）、text、fallback）。
 */
export const builtinPlugins: readonly AnyPreviewPlugin[] = [
  folderPlugin,
  htmlPlugin,
  textPlugin,
  fallbackPlugin
]
