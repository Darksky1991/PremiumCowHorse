# CLAUDE.md

PremiumCowHorse：面向对日 IT 保守（运维）人员的工作区式文件管理器（Electron + React，Windows 为主）。与需求方用**中文**沟通。

## 事实依据（按优先级）

1. **代码与可运行的检查结果**：唯一能证明「现在是什么样」的东西。
2. **[`doc/`](doc/)**：设计文档，项目的最新事实依据（目标结构 + 已实现部分）。动手前先读相关章节。
3. **[`knowledge/`](knowledge/)**：踩过的坑。开始相关工作前按关键字（报错原文、包名、工具名）搜索。
4. [`devDoc/`](devDoc/)：历史记录，只用于追溯「为什么」，不作为现状依据。
5. [`README.md`](README.md)：环境与命令。

doc 与代码不一致时，以代码为准核实，然后修正 doc（或在实现有误时修正代码），不要按 doc 臆测代码。

## 防止幻觉

- **不凭记忆断言第三方库的 API、import 路径、默认值、版本**。读 `node_modules` 中的类型定义 / 源码 / CHANGELOG，或官方文档后再写。本项目已出过的例子：Kysely 0.29 把 `Migrator` 移到 `kysely/migration`；zod 4 的 `.partial()` 保留默认值；Base UI 用 `render` 而非 `asChild`。
- **只看一层源码不下结论**：行为以可运行的测试为准（例：Kysely 的互斥锁在 RuntimeDriver 而非 SqliteDriver）。
- **报告中区分「已验证」与「未验证」**：说「完成 / 通过 / 可用」之前必须实际运行过对应检查并看到结果；没跑过的明确写「未验证」。
- **系统绘制的东西页面截图看不到**（窗口按钮、边框）；系统处理的交互 Playwright 的页面事件验证不了（双击标题栏）。用 `scripts/os-screenshot.mjs` 与系统级鼠标事件验证，不要把肉眼确认推给需求方。
- 结构性改动（技术栈、布局、打包）后看**整窗**截图，不只看局部。
- 命令输出与预期矛盾时，先查清原因（`systematic-debugging`），不要猜测性修改。

## 工作流程

1. 读 `doc/` 相关章节与 `knowledge/`。
2. 实现。新依赖、偏离 `doc/` 的设计、不可逆操作 → 先向需求方说明并确认。
3. 验证（见下文清单）。
4. **同一次改动中**更新文档：
   - 设计或实现结构有变化 → 更新 `doc/`（文首版本号与变更摘要；目标结构与「已实现」分开写）。
   - 每个任务写一份 `devDoc/YYYY-MM-DD-NN-主题.md`，并在 `devDoc/README.md` 的表中登记。
   - 遇到非显而易见的问题 → 在 `knowledge/` 对应文件追加条目（症状 / 原因 / 解决 / 预防）；结论被推翻时修改原条目。
   - 命令或环境变化 → 更新 `README.md`；工作约定变化 → 更新本文件。
5. 只在需求方要求时提交 / 推送。提交信息遵循 Conventional Commits。

## 选型原则

- **依赖包、架构、设计**有可选项时，优先采用官方推荐 / 默认 / 代表演进方向的选项（如 shadcn 的 Base UI、electron-vite 官方模板）。因安全原因偏离时写明理由。
- **交互行为**不适用上面这条：以实际效果、从使用者立场判断。
- 不要固守最初的设计：发现更合理的方案时，提出来请需求方审核。

## 验证清单

```bash
pnpm typecheck      # 全部包
pnpm lint           # 含模块边界规则（eslint-plugin-boundaries）
pnpm test           # vitest
pnpm build          # 类型检查 + electron-vite build
pnpm test:e2e       # Playwright Electron（需先 build）
```

- UI 改动：e2e 覆盖行为；外观用截图确认（含系统绘制部分时用 `node scripts/os-screenshot.mjs <out.png> [light|dark] [ja|zh-CN|en]`）。
- 打包改动：`pnpm dist` 后实际解压运行，用 `--user-data-dir=<临时目录>` 避免污染正式数据。
- 结束后检查残留进程（`Get-Process electron`、`PremiumCowHorse`）。

## 架构要点（详见 doc/）

- `apps/desktop`：electron-vite 目录约定 `src/{main,preload,renderer}`；`packages/{shared,i18n,ui,plugin-sdk}`。
- **分层由 lint 强制**（`eslint.config.mjs`）：主进程 `ipc → modules → infra/core`，模块之间不互相 import；渲染端 `app → features → providers/data/stores/lib`，feature 之间不互相 import；新目录先在 `eslint.config.mjs` 登记。
- **IPC**：契约在 `packages/shared/src/ipc/contract.ts`（zod 校验输入），传输只有 `pch:invoke` / `pch:event` 两个通道。新增通道：契约 → 主进程 handler（漏写编译失败）→ 渲染端 `call()`。
- **安全**：`sandbox: true`、`contextIsolation`；preload 只暴露 `window.pch`，不能用 Node API（如 `Buffer`）；CSP 不允许内联脚本；不向页面暴露 `ipcRenderer`。
- **设置**：唯一定义在 `packages/shared/src/settings/schema.ts`；数据库只存与默认值不同的键。
- **数据库**：node:sqlite + Kysely；改表结构 = 新增迁移文件（发布后不得修改）+ 更新 `schema.ts` 类型。
- **i18n**：ja / zh-CN / en 三种语言必须同时添加（日语资源为类型基准）；用户可见文案不在主进程拼接。
- shadcn 组件（`packages/ui/src/components`）保持 CLI 生成的原样，不手改样式；`className` 只用于布局。

## 环境约束（Windows / 企业终端）

- pnpm 12：带安装脚本的依赖需在 `pnpm-workspace.yaml` 的 `allowBuilds` 中声明。
- 公司漏洞管理（TVM）会封锁有已知漏洞的程序版本：打包需 `ELECTRON_BUILDER_7ZIP_PATH` 指向 7-Zip 25.01+；新增会下载可执行程序的工具前先确认版本。不要尝试绕过封锁。
- shadcn CLI 在含 `.` 的用户目录路径下失败 → `subst` 临时盘符（见 `knowledge/libraries.md`）。
- 开发数据：`%APPDATA%\PremiumCowHorse-dev`；e2e 用 `PCH_USER_DATA_DIR` 指定临时目录。
- Shell：Git Bash 与 PowerShell 均可用；系统代码页为 cp932，Python 输出中文需 `PYTHONIOENCODING=utf-8`。长 heredoc 易解析失败，批量修改改用脚本文件。
