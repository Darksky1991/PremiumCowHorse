# 技术栈复审与 P0 改进

- 日期：2026-11-18
- 里程碑：M0
- 相关提交：`8c2e26b`（首次提交）

## 目标

复审 M0 的架构、技术栈、项目构成与部署产物，按「keep simple、合理分层、低耦合、可扩展」改进；在 M1 之前处理 P0 项。

## 做了什么

- 技术栈（需求方确认）：
  - Next.js 静态导出 + tsup + 自写 dev 脚本 → electron-vite（官方脚手架 react-ts 模板为基准）；
  - Drizzle + sqlite-proxy → Kysely + node:sqlite（TS 迁移随主进程打包）；
  - shadcn/ui 底层 Radix → Base UI（shadcn 当前默认）。
- P0：IPC 单通道（`pch:invoke` / `pch:event`，白名单只在主进程契约）；ESLint + Prettier + eslint-plugin-boundaries（分层规则可执行）；根错误边界 + 渲染端错误写入 `main.log`；CSP 去掉内联脚本。
- 打包：Electron Fuses；渲染端产物进入 asar；按用户安装的 NSIS（后在 03 中改为 zip）；NSIS 工具包 3.12。
- 依赖审计：`pnpm audit` 2 项（picomatch、minimatch），均在构建工具中，不进入产物，暂不处理。
- 架构文档更新到 v1.2。

## 关键决策与理由

- 选型原则：依赖包有可选项时优先官方推荐 / 默认 / 演进方向（需求方提出）。偏离模板的三处均出于 Electron 安全指南：`sandbox: true`、不用 `@electron-toolkit/preload`、用 `app://` 代替 `loadFile`。
- Kysely 的单连接互斥锁在 RuntimeDriver（一度只读 SqliteDriver 误判），以并发测试为准。
- electron-vite 默认不压缩产物，保持默认。

## 验证

- 格式、lint（含分层规则，4 类违规写法实测被拦截）、类型检查、29 个单元测试、5 个 e2e、`pnpm dev`、免安装目录版实际启动均通过。

## 过程中的问题

- 公司 TVM 封锁 electron-builder 自带的 7-Zip 24.09：需求方用 winget 安装 7-Zip 26.06，设置 `ELECTRON_BUILDER_7ZIP_PATH` 后打包成功。
- 开发库残留 Drizzle 时期的表导致迁移失败，删除开发库解决。
- 详见 `knowledge/`。
