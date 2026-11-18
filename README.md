# PremiumCowHorse

面向对日 IT 保守（运维）人员的工作区式文件管理器。设计见 [架构设计方案](./PremiumCowHorse-架构设计方案.md)。

## 环境

- Node.js 24+，pnpm 12（`npm i -g pnpm@12`）
- Windows 为主要目标平台

## 常用命令（在仓库根目录执行）

| 命令             | 作用                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| `pnpm install`   | 安装依赖（会下载 Electron 二进制）                                       |
| `pnpm dev`       | 开发模式（electron-vite）：渲染端热更新，主进程 / preload 改动后自动重启 |
| `pnpm build`     | 类型检查 + 生产构建，产物在 `apps/desktop/out`                           |
| `pnpm start`     | 以生产构建预览运行                                                       |
| `pnpm dist:dir`  | 打包为免安装目录 `apps/desktop/release/<版本>/win-unpacked`              |
| `pnpm dist`      | 打包 NSIS 安装程序（需先配置 7-Zip，见下文）                             |
| `pnpm typecheck` | 全部包类型检查                                                           |
| `pnpm lint`      | ESLint（含模块边界规则）                                                 |
| `pnpm format`    | Prettier 格式化                                                          |
| `pnpm test`      | 单元测试（vitest）                                                       |
| `pnpm test:e2e`  | Electron 端到端测试（Playwright，需先 `pnpm build`）                     |

开发数据保存在 `%APPDATA%\PremiumCowHorse-dev`，与正式版分开。开发窗口中 F12 打开 DevTools。
日志位于 `<userData>\logs\main.log`（含渲染端未捕获的错误），用户反馈问题时请附上此文件。

## 目录

```
apps/desktop            Electron 应用（electron-vite 官方目录约定）
  src/main              主进程：bootstrap / ipc / modules / windows / infra / core
  src/preload           preload（sandbox，只暴露 window.pch）
  src/renderer          渲染端：app / features / providers / data / lib / stores
packages/shared         IPC 契约、设置 schema、错误模型（三端共用）
packages/i18n           ja / zh-CN / en 语言资源与 i18next 工厂
packages/ui             shadcn/ui（Base UI）组件与主题 CSS
packages/plugin-sdk     预览插件契约
e2e                     Playwright Electron 测试
```

分层规则由 `eslint.config.mjs` 中的 `eslint-plugin-boundaries` 强制执行：例如主进程模块之间、渲染端 feature 之间不得互相 import，
插件只能依赖 `plugin-sdk` 与 `ui`。新增目录需先在该文件中登记所属的层。

## 数据库迁移

数据库为 `node:sqlite` + Kysely。修改表结构时：在 `apps/desktop/src/main/infra/db/migrations/` 新增迁移文件（文件名递增，发布后不得修改），
在 `migrations/index.ts` 中登记，并同步更新 `schema.ts` 中的类型。

## 打包安装程序：7-Zip

electron-builder 自带的 7-Zip 24.09 被公司漏洞管理（TVM）判定为漏洞版本并封锁。请通过公司软件中心安装最新版 7-Zip（25.01 以上），
然后设置 electron-builder 官方提供的环境变量，指向安装后的 `7z.exe`：

```powershell
[Environment]::SetEnvironmentVariable('ELECTRON_BUILDER_7ZIP_PATH', 'C:\Program Files\7-Zip\7z.exe', 'User')
```

NSIS 已通过 `electron-builder.yml` 的 `toolsets.nsis` 使用 3.12 版本（默认的 3.0.4.1 含 CVE-2023-37378）。

## 已知注意事项

- **shadcn CLI 与带点号的路径**：shadcn CLI 在 `C:\Users\xxx.yyy\...` 这类含 `.` 的路径下会报
  `EPERM: mkdir 'C:\Users\xxx'`。可临时映射盘符后在 `packages/ui` 中执行：
  `subst P: <仓库路径>` → `cd P:\packages\ui` → `npx shadcn@latest add <组件>` → `subst P: /D`。
  添加组件后检查 `sonner.tsx` 是否又引入了 `next-themes`（本项目不使用，主题由调用方传入）。
- **Base UI 菜单**：单选 / 复选菜单项选中后默认不关闭菜单（`closeOnClick` 默认 false），这是 Base UI 的默认行为。
- **依赖审计**：`pnpm audit` 目前报告的 picomatch / minimatch 问题只存在于 shadcn CLI 与 electron-builder 等构建工具，
  不进入安装包；待上游发布修复版本后升级。
