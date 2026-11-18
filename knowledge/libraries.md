# 第三方库

### zod 4：`.partial()` 之后 `.default()` 仍然生效

- 日期：2026-11-18
- 症状：只更新一个设置项，其他设置全部被重置为默认值（单元测试发现）。
- 原因：zod 4 中 `schema.partial()` 不会去掉字段上的 `.default()`，未传的键被填成默认值。
- 解决：`SettingsPatch` 逐字段 `field.unwrap().optional()` 构造（`packages/shared/src/settings/schema.ts`），并有回归测试。
- 预防：对带默认值的 schema 做部分更新时，测试「未传的键不出现在结果中」。

### Kysely 0.29：`Migrator is not a constructor`

- 日期：2026-11-18
- 症状：`new Migrator(...)` 报 `TypeError: Migrator is not a constructor`。
- 原因：0.29 把迁移 API 移到了子入口；主入口导出的 `Migrator` 只是一个提示类型。
- 解决：`import { Migrator, type Migration } from 'kysely/migration'`。
- 预防：0.x 版本升级时先读 CHANGELOG / 类型定义；不要凭记忆写 import 路径。

### Kysely 的 SQLite 单连接互斥锁在 RuntimeDriver 里

- 日期：2026-11-18
- 症状：读 `SqliteDriver` 源码时发现 `acquireConnection` 直接返回同一连接、没有锁，一度误判事务不安全。
- 原因：锁在上一层：SQLite 适配器声明 `supportsMultipleConnections = false`，`RuntimeDriver` 据此启用 `ConnectionMutex`。
- 解决：以测试为准：`apps/desktop/src/main/infra/db/client.test.ts` 的并发测试证明事务期间的外部写入不会被一起回滚。
- 预防：判断库的并发/事务行为时，以可运行的测试为准，不要只看一层源码下结论。

### node:sqlite 与 Kysely `SqliteDialect` 的接口差异

- 日期：2026-11-18
- 症状：直接把 `DatabaseSync` 传给 `SqliteDialect` 不能工作。
- 原因：Kysely 按 better-sqlite3 的接口设计：参数以数组传入、语句有 `reader` 属性；node:sqlite 参数需展开传入、没有 `reader`。
- 解决：`infra/db/client.ts` 的 `adapt()`：`reader = stmt.columns().length > 0`，`all/run/iterate` 展开参数。
- 预防：—

### shadcn CLI：`EPERM: operation not permitted, mkdir 'C:\Users\yongjun'`

- 日期：2026-11-18
- 症状：`shadcn add` / `init` 在「Updating files」阶段失败，路径在用户名的 `.` 处被截断。
- 原因：CLI 解析路径时把第一个 `.` 之后的部分当成扩展名去掉（用户目录为 `yongjun.fu`）。
- 解决：临时映射无点号的盘符：`subst P: <仓库路径>` → 在 `P:\packages\ui` 执行 `npx shadcn@latest add <组件>` → `subst P: /D`。
- 预防：添加组件后检查：①`sonner.tsx` 又引入了 `next-themes`（本项目不用，主题由调用方传入）；②`@base-ui/react` 是否已写入 `packages/ui` 的依赖（曾漏写）；③删除 CLI 生成的 `package-lock.json`（本项目用 pnpm）。

### Base UI 菜单的单选 / 复选项点击后不关闭

- 日期：2026-11-18
- 症状：e2e 中选完主题后点击语言按钮超时：`<div data-base-ui-inert> intercepts pointer events`。
- 原因：Base UI 的 `Menu.RadioItem` / `CheckboxItem` 默认 `closeOnClick=false`（Radix 是选中即关闭）。
- 解决：保持默认（需求方试用后认为体验可以）；e2e 中按 `Escape` 关闭菜单。
- 预防：从 Radix 迁移的交互要按实际效果重新确认；Base UI 用 `render` 而不是 `asChild`。

### `react-refresh/only-export-components`

- 日期：2026-11-18
- 症状：lint 报 「Fast refresh only works when a file only exports components」。
- 原因：同一文件同时导出组件与常量 / hook，会破坏热更新。
- 解决：把常量、context、hook 拆到独立文件（如 `providers/theme-context.ts`、`features/shell/languages.ts`）。
- 预防：组件文件只导出组件。
