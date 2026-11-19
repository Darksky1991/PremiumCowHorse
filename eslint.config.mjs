// 基于 electron-vite 官方模板的 ESLint 配置，追加 eslint-plugin-boundaries 以强制架构文档中的分层规则。
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import tseslint from '@electron-toolkit/eslint-config-ts'
import boundaries from 'eslint-plugin-boundaries'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig } from 'eslint/config'

const MAIN = 'apps/desktop/src/main'
const RENDERER = 'apps/desktop/src/renderer/src'

/** 元素分类：每一层（或每一个 feature / 模块 / 插件）是一个元素 */
const elements = [
  // 三端共用的包
  { type: 'shared', pattern: 'packages/shared' },
  { type: 'i18n', pattern: 'packages/i18n' },
  { type: 'ui', pattern: 'packages/ui' },
  { type: 'plugin-sdk', pattern: 'packages/plugin-sdk' },
  { type: 'plugin', pattern: 'plugins/*', capture: ['name'] },
  // 主进程（架构文档 5.2 节）
  { type: 'main-bootstrap', pattern: `${MAIN}/bootstrap` },
  { type: 'main-ipc', pattern: `${MAIN}/ipc` },
  { type: 'main-module', pattern: `${MAIN}/modules/*`, capture: ['name'] },
  { type: 'main-windows', pattern: `${MAIN}/windows` },
  { type: 'main-vfs', pattern: `${MAIN}/vfs` },
  { type: 'main-infra', pattern: `${MAIN}/infra` },
  { type: 'main-core', pattern: `${MAIN}/core` },
  { type: 'preload', pattern: 'apps/desktop/src/preload' },
  // 扫描进程（utilityProcess；不得 import electron）
  { type: 'scanner', pattern: 'apps/desktop/src/scanner' },
  // 渲染端（架构文档 5.3 节）
  { type: 'r-app', pattern: `${RENDERER}/app` },
  { type: 'r-feature', pattern: `${RENDERER}/features/*`, capture: ['name'] },
  { type: 'r-provider', pattern: `${RENDERER}/providers` },
  { type: 'r-data', pattern: `${RENDERER}/data` },
  { type: 'r-store', pattern: `${RENDERER}/stores` },
  { type: 'r-lib', pattern: `${RENDERER}/lib` },
  { type: 'r-style', pattern: `${RENDERER}/styles` }
]

const allow = (from, to) => ({
  from: { element: { type: from } },
  allow: { to: { element: { types: to } } }
})

/** 单个入口文件按「文件」分类（v7 中元素只描述目录） */
const files = [
  { pattern: `${MAIN}/index.ts`, category: 'main-entry' },
  { pattern: `${RENDERER}/main.tsx`, category: 'r-entry' },
  // vfs 中不依赖 electron 的文件：扫描进程只能 import 这些
  {
    pattern: `${MAIN}/vfs/{local-path,errors,location,path-name,fs-list}.ts`,
    category: 'vfs-portable'
  }
]

const allowFile = (category, to) => ({
  from: { file: { categories: category } },
  allow: { to: { element: { types: to } } }
})

/** 依赖方向：默认禁止，只放行下面列出的方向 */
const policies = [
  allow('i18n', ['shared']),
  // 插件只能依赖 SDK 与 UI，与将来的第三方插件走相同接口
  allow('plugin', ['plugin-sdk', 'ui']),
  // 主进程：ipc → modules → infra / core；模块之间不得互相 import（经构造函数注入）
  allowFile('main-entry', ['main-bootstrap']),
  allow('main-bootstrap', [
    'main-ipc',
    'main-module',
    'main-windows',
    'main-vfs',
    'main-infra',
    'main-core',
    'shared',
    'i18n'
  ]),
  allow('main-ipc', ['main-bootstrap', 'main-module', 'main-vfs', 'main-infra', 'shared']),
  allow('main-module', ['main-ipc', 'main-vfs', 'main-infra', 'main-core', 'shared']),
  // vfs：按 scheme 路由到 provider；vfs.ipc 使用路由的类型
  allow('main-vfs', ['main-ipc', 'main-core', 'main-infra', 'shared']),
  // main-vfs 只能以 ?modulePath 引用扫描进程入口（得到打包后的文件路径，不在主进程加载其代码）
  {
    from: { element: { type: 'main-vfs' } },
    allow: {
      to: { element: { type: 'scanner' } },
      dependency: { source: '../../scanner/main?modulePath' }
    }
  },
  allow('main-windows', ['main-module', 'main-infra', 'main-core', 'shared']),
  allow('main-infra', ['main-core', 'shared', 'i18n']),
  allow('main-core', ['shared']),
  allow('preload', ['shared']),
  allow('scanner', ['shared']),
  {
    from: { element: { type: 'scanner' } },
    allow: { to: { file: { categories: 'vfs-portable' } } }
  },
  // 渲染端：app → features → data / lib / stores；feature 之间不得互相 import
  allowFile('r-entry', ['r-app', 'r-provider', 'r-lib', 'r-style']),
  allow('r-app', ['r-feature', 'r-lib', 'ui', 'i18n', 'shared']),
  allow('r-feature', [
    'r-provider',
    'r-data',
    'r-store',
    'r-lib',
    'ui',
    'i18n',
    'shared',
    'plugin-sdk'
  ]),
  allow('r-provider', ['r-data', 'r-lib', 'ui', 'i18n', 'shared']),
  allow('r-data', ['r-lib', 'shared']),
  // 跨 feature 的 store 可以使用 shared 的纯函数与类型（如标签的 layoutReducer）
  allow('r-store', ['shared']),
  allow('r-lib', ['shared']),
  allow('r-style', ['ui'])
]

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      '**/release',
      'test-results',
      'playwright-report',
      '.claude',
      // shadcn 生成的组件保持上游原样，便于用 CLI 对比和更新
      'packages/ui/src/components'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: { version: 'detect' }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}', 'plugins/**/*.{ts,tsx}'],
    // 配置文件、类型声明文件与测试不属于运行时分层
    ignores: ['**/*.test.ts', '**/*.d.ts', '**/*.config.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: {
          noWarnOnMultipleProjects: true,
          project: [
            'apps/desktop/tsconfig.node.json',
            'apps/desktop/tsconfig.web.json',
            'packages/*/tsconfig.json'
          ]
        }
      },
      'boundaries/elements': elements,
      'boundaries/files': files
    },
    rules: {
      'boundaries/dependencies': [2, { default: 'disallow', policies }],
      // 新增文件必须归入某个已定义的元素，避免游离于分层之外
      'boundaries/no-unknown-files': 2
    }
  },
  {
    // 扫描进程运行在 utilityProcess 中，与它共用的 vfs 文件也一样：不得依赖 electron
    files: [
      'apps/desktop/src/scanner/**/*.ts',
      `${MAIN}/vfs/{local-path,errors,location,path-name,fs-list}.ts`
    ],
    rules: {
      'no-restricted-imports': [
        2,
        { paths: [{ name: 'electron', message: '扫描进程（utilityProcess）中不能使用 electron' }] }
      ]
    }
  },
  eslintConfigPrettier
)
