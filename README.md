# PremiumCowHorse

面向对日 IT 保守（运维）人员的工作区式文件管理器。

- 设计（最新事实依据）：[doc/PremiumCowHorse-架构设计方案.md](./doc/PremiumCowHorse-架构设计方案.md)
- 开发记录：[devDoc/](./devDoc/)　｜　踩坑与知识：[knowledge/](./knowledge/)　｜　AI 协作约定：[CLAUDE.md](./CLAUDE.md)

## 环境

- Node.js 24+，pnpm 12（`npm i -g pnpm@12`）
- Windows 为主要目标平台
- 打包需要 7-Zip 25.01 以上（见下文「打包」）

## 常用命令（在仓库根目录执行）

| 命令             | 作用                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`   | 安装依赖（会下载 Electron 二进制）                                                                                                |
| `pnpm dev`       | 开发模式（electron-vite）：渲染端热更新，主进程 / preload 改动后自动重启                                                          |
| `pnpm build`     | 类型检查 + 生产构建（electron-vite，再加 Markdown 查看脚本的单独 vite 构建 `vite.markdown.config.ts`），产物在 `apps/desktop/out` |
| `pnpm start`     | 以生产构建预览运行（`electron-vite preview`；**不会**构建 Markdown 查看脚本，需先 `pnpm build`，否则 Markdown 无法显示）          |
| `pnpm dist`      | 打包 zip 免安装文件夹版 `apps/desktop/release/<版本>/*.zip`                                                                       |
| `pnpm dist:dir`  | 只生成未压缩的目录 `apps/desktop/release/<版本>/win-unpacked`（调试用）                                                           |
| `pnpm typecheck` | 全部包类型检查                                                                                                                    |
| `pnpm lint`      | ESLint（含模块边界规则）                                                                                                          |
| `pnpm format`    | Prettier 格式化                                                                                                                   |
| `pnpm test`      | 单元测试（vitest）                                                                                                                |
| `pnpm test:e2e`  | Electron 端到端测试（Playwright，需先 `pnpm build`）                                                                              |

开发数据保存在 `%APPDATA%\PremiumCowHorse-dev`，与正式版分开。开发窗口中 F12 打开 DevTools。
日志位于 `<userData>\logs\main.log`（含渲染端未捕获的错误），用户反馈问题时请附上此文件。
目录缓存位于 `<userData>\cache\index.db`（扫描进程使用，可在应用退出后随时删除，下次启动重建）。

文本引擎的基准测试（生成 200MB 数据，默认跳过）：`PCH_BENCH=1 pnpm vitest run packages/text-engine`（PowerShell：`$env:PCH_BENCH=1; pnpm vitest run packages/text-engine`）

系统级截屏（含窗口按钮、边框等系统绘制部分，需先 `pnpm build`）：
`node scripts/os-screenshot.mjs <输出.png> [light|dark] [ja|zh-CN|en]`

远程目录（SFTP，M4）的测试：

- **e2e 不需要真实服务器**：`e2e/connections.spec.ts`、`e2e/remote.spec.ts` 在测试进程内启动假 SFTP 服务器（真实的 `ssh2` Server，只监听 `127.0.0.1`，临时目录映射为服务器的 `/`；`e2e/sftp-support.ts` → `apps/desktop/src/main/modules/connection/testing/fake-sftp-server.ts`），随 `pnpm test:e2e` 运行。假服务器没有 `exec`，sudo 身份切换只在单元测试（脚本化的假通道）与下面的 WSL 实机测试中覆盖。
- **WSL 实机测试（默认跳过）**：经真实的连接池连接本机 WSL 的 4 个实例（Ubuntu / Debian / AlmaLinux / openSUSE，sshd 端口 2201–2204），覆盖 sudo 场景矩阵并数服务器日志中的失败次数（约 2.5 分钟）：
  ```bash
  PCH_WSL_SFTP=1 pnpm vitest run apps/desktop/src/main/modules/connection/wsl.test.ts
  ```
  PowerShell：`$env:PCH_WSL_SFTP=1; pnpm vitest run apps/desktop/src/main/modules/connection/wsl.test.ts`。前提：各实例已按 [scripts/wsl-sftp/README.md](./scripts/wsl-sftp/README.md) 执行过 `setup.sh` 并安装最新的 `pch-scenario`，且 sshd 正在监听（`powershell -File scripts/wsl-sftp/start-sshd.ps1`）。测试会切换 sudoers 场景，结束时恢复为 `pch-scenario all quiet`。

## 目录

```
apps/desktop            Electron 应用（electron-vite 官方目录约定）
  src/main              主进程：bootstrap / ipc / modules / windows / infra / core
  src/scanner           扫描进程（utilityProcess）：目录枚举（koffi）、缓存 index.db、调度
  src/preload           preload（sandbox，只暴露 window.pch）
  src/renderer          渲染端：app / features / providers / data / lib / stores
packages/shared         IPC 契约、设置 schema、错误模型（三端共用）
packages/i18n           ja / zh-CN / en 语言资源与 i18next 工厂
packages/ui             shadcn/ui（Base UI）组件与主题 CSS
packages/plugin-sdk     预览插件契约
packages/text-engine    文本预览的纯逻辑（行索引、按行读取等；不依赖任何包）
e2e                     Playwright Electron 测试
scripts                 开发辅助脚本（系统级截屏；wsl-sftp/：M4 的 WSL SFTP / sudo 试验环境）
doc / devDoc / knowledge  设计文档 / 开发记录 / 踩坑与知识
```

分层规则由 `eslint.config.mjs` 中的 `eslint-plugin-boundaries` 强制执行：例如主进程模块之间、渲染端 feature 之间不得互相 import，
插件只能依赖 `plugin-sdk`、`ui` 与 `text-engine`。新增目录需先在该文件中登记所属的层。

## 数据库迁移

数据库为 `node:sqlite` + Kysely。修改表结构时：在 `apps/desktop/src/main/infra/db/migrations/` 新增迁移文件（文件名递增，发布后不得修改），
在 `migrations/index.ts` 中登记，并同步更新 `schema.ts` 中的类型。

## 打包

分发形式为 **zip 免安装文件夹版**：解压到任意目录，运行其中的 `PremiumCowHorse.exe`（不需要安装与管理员权限）。用户数据位于
`%APPDATA%\PremiumCowHorse`，替换新版本时直接覆盖程序目录即可。不提供安装程序与 portable 单文件 exe（后者每次启动需 24–31 秒，原因见 doc 16.4 节）。

electron-builder 自带的 7-Zip 24.09 被公司漏洞管理（TVM）封锁。请安装 7-Zip 25.01 以上（例：`winget install 7zip.7zip`），
然后设置 electron-builder 官方提供的环境变量（设置后需重开终端）：

```powershell
[Environment]::SetEnvironmentVariable('ELECTRON_BUILDER_7ZIP_PATH', 'C:\Program Files\7-Zip\7z.exe', 'User')
```

## 已知注意事项

详见 [knowledge/](./knowledge/)，常见的几条：

- **shadcn CLI 与带点号的路径**：在 `C:\Users\xxx.yyy\...` 下会报 `EPERM: mkdir 'C:\Users\xxx'`，需临时映射盘符执行（步骤见 `knowledge/libraries.md`）。
- **Base UI 菜单**：单选 / 复选菜单项选中后默认不关闭菜单（`closeOnClick` 默认 false）。
- **依赖审计**：`pnpm audit` 报告的 picomatch / minimatch 问题只存在于 shadcn CLI 与 electron-builder 等构建工具，不进入产物；待上游修复后升级。
