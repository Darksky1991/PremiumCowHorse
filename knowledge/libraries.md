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
- 解决：主题 / 语言菜单保持默认（需求方试用后认为体验可以），e2e 中按 `Escape` 关闭菜单；「选中即生效并关闭」的菜单（工作区切换器，M1-2）在 `DropdownMenuRadioItem` 上传 `closeOnClick`。
- 预防：从 Radix 迁移的交互要按实际效果重新确认；Base UI 用 `render` 而不是 `asChild`。

### `react-refresh/only-export-components`

- 日期：2026-11-18
- 症状：lint 报 「Fast refresh only works when a file only exports components」。
- 原因：同一文件同时导出组件与常量 / hook，会破坏热更新。
- 解决：把常量、context、hook 拆到独立文件（如 `providers/theme-context.ts`、`features/shell/languages.ts`）。
- 预防：组件文件只导出组件。

### TanStack Query：Electron 中窗口聚焦刷新不触发；`staleTime: Infinity` 下重新挂载不重新获取

- 日期：2026-11-18（2026-11-19 修订：原「用 `'always'` 即可」的结论被 M1-2 最终审查推翻）
- 症状：目录列表需要「窗口重新获得焦点时刷新」。最初按计划写 `refetchOnWindowFocus: true` 不触发，改为 `'always'` 后以为生效（未做 e2e）；最终审查指出 Alt+Tab 切走再回来仍不会重新获取，且折叠后再展开、切回工作区时显示的是 gcTime（5 分钟）内的旧缓存。
- 原因：
  1. 事件来源：query-core 的 focusManager（`focusManager.ts`）默认**只监听 `visibilitychange`**。Electron 中切到其他窗口时页面一直可见，只有 `window` 的 `focus` / `blur`，focusManager 收不到任何通知，`'always'` 也无从触发。
  2. 过期判定：`true` 的含义是「若数据已过期（stale）则重新获取」，`refetchOnMount` 同理（默认 `true`）；全局 `staleTime: Infinity` 下数据永不过期，重新挂载与聚焦都不重新获取。
- 解决：`lib/query-client.ts` 用 `focusManager.setEventListener` 同时监听 `window` 的 `focus` 与 `visibilitychange`（回调不带参数，由 focusManager 按 `document.visibilityState` 判断）；目录查询（`data/vfs.ts` 的 `directoryQuery`）单独设 `staleTime: 2000`、`refetchOnMount: true`、`refetchOnWindowFocus: true`，全局默认不变。单元测试（`focusListenerSetup`、`directoryQuery` 的新鲜期）与 e2e（聚焦 / 折叠后再展开 / 切回工作区）覆盖，并做过篡改验证。
- 预防：在 Electron 中依赖「聚焦」的行为要先确认 focusManager 的事件来源；全局 `staleTime: Infinity` 时，需要「重新挂载 / 聚焦时重新获取」的查询单独设有限的 `staleTime`。`'always'` 只解决过期判定，不解决事件来源。e2e 中真实的 focus / blur 被 Playwright 的焦点模拟屏蔽（见 `testing.md`），用 `window.dispatchEvent(new Event('focus'))` 触发。

### TanStack Query：queryFn 的 `signal` 何时中止（取消主进程中的请求）

- 日期：2026-11-19
- 症状：（M1-2 最终审查 I5）queryFn 不使用 `signal`，展开慢速网络目录后立刻折叠，主进程仍继续 lstat 最长 30 秒、占满 libuv 线程池。
- 原因：query-core（5.107，`query.ts`）只在 queryFn 读取过 `signal`（`#abortSignalConsumed`）时，才会在最后一个观察者离开时真正取消请求；不读取则只停止重试，请求继续。
- 解决：queryFn 接收 `{ signal }`，abort 时发送 `vfs.cancel`（`data/vfs.ts` 的 `listDirectory`）。中止时机（均同步发生在同一 key 的新请求发出之前）：最后一个观察者离开（`removeObserver` → `cancel({ revert: true })`）、有数据时被新的获取取代（`fetch` 的 `cancelRefetch`，`invalidateQueries` / `refetch` 默认开启）、`resetQueries`（`reset()` → `destroy()` → `cancel({ silent: true })`）、缓存回收。被取消的请求随后的失败被忽略，不变成 error 状态。
- 预防：需要取消的 queryFn 必须读取 `signal`；「取消旧请求」与「新请求」共用 requestId 时，确认取消一定先于新请求发出，并在请求结束后移除 abort 监听器。

### TanStack Query：重新获取失败时保留旧 data，先看 data 会一直显示旧列表

- 日期：2026-11-18
- 症状：资源树中展开的目录在磁盘上被删除后，主进程已发出 `vfs.changed`、`vfs.list` 也返回 `FS_NOT_FOUND`，树中却一直显示旧的子项，按 F5 也不变（M1-2 Task 10 的 e2e 发现）。
- 原因：查询曾经成功过时，重新获取失败的结果是 `status: 'error'` 且**保留上一次的 `data`**（query-core 类型 `QueryObserverRefetchErrorResult` 的注释：「The data from before the failed refetch, which is kept」）。`useDirectories` 先判断 `data !== undefined`，错误被忽略。之前只测试过「首次获取就失败」的错误行。
- 解决：错误优先：`data/vfs.ts` 的 `directoryState()` 先看 `isError` 再看 `data`，有单元测试。
- 预防：把查询结果映射为界面状态时，明确「重新获取失败」该显示什么；错误相关的测试要覆盖「先成功、后失败」。

### Base UI：菜单关闭动画结束前再次点击触发器，菜单重新打开但焦点留在按钮上

- 日期：2026-11-18
- 症状：工作区切换器的 e2e 约 1/5 失败：选中菜单项后立刻再点切换器，紧接着的 `Escape` 不关闭菜单（`getByRole('menu')` 一直为 1），或点击菜单项时报 `element is not stable` / `element was detached from the DOM`。
- 原因（诊断用例确认了现象，未读源码确认内部机制）：选中项后菜单进入关闭动画（popup 带 `data-closed`、`data-ending-style`，仍在 DOM 中）；此时点击触发器，菜单重新打开，但焦点停在触发器按钮上，第一次 `Escape` 被忽略。单独「打开 → Esc」反复 13 次都正常。
- 解决：e2e 中每次打开菜单前 `await expect(page.getByRole('menu')).toHaveCount(0)`，打开后再 `toBeVisible()`（`e2e/app.spec.ts` 的 `openMenu`），连续 8 次通过。
- 预防：e2e 连续操作同一个菜单时，等上一个菜单从 DOM 中移除再打开。产品上用户很难在动画期间（约 100ms）再次点击，暂不处理。

### Base UI ContextMenu：阻止某些行打开菜单、关闭后焦点回到指定元素

- 日期：2026-11-18
- 症状：资源树的状态行（加载中 / 错误 / 空）不应有右键菜单；菜单与对话框关闭后焦点应回到树（否则 F2 / ↑↓ 失效）。
- 解决：`ContextMenu.Trigger` 上自定义的 `onContextMenu` 先于 Base UI 自己的处理器执行，调用 `e.preventBaseUIHandler()` 可阻止该次打开（`features/explorer/explorer-tree.tsx`）；在 Popup（`ContextMenuContent`）与对话框上设置 `finalFocus`（ref）指定关闭后的焦点。
- 预防：菜单项若带 `ContextMenuShortcut`，快捷键文字会并入菜单项的无障碍名称，见 testing.md。

### `react-hooks/incompatible-library`：`useVirtualizer()` 报 "Compilation Skipped: Use of incompatible library"

- 日期：2026-11-18
- 症状：eslint-plugin-react-hooks 7 的 recommended 规则对 `@tanstack/react-virtual` 的 `useVirtualizer` 给出警告。
- 原因：该规则面向 React Compiler，提示编译器会跳过该组件的自动 memo；本项目未启用 React Compiler，运行不受影响。
- 解决：在调用处 `// eslint-disable-next-line react-hooks/incompatible-library` 并注明理由（`features/explorer/explorer-tree.tsx`）。
- 预防：将来启用 React Compiler 时，确认虚拟列表组件的输出不传给被 memo 的子组件。另：`estimateSize` 只是初值，行高随密度变化时依赖 `measureElement` 实测（行元素需带 `data-index`）；`getItemKey` 用稳定的节点 id。

### 懒加载树「每发现一层多渲染一次」可能撞上 React 的渲染中 setState 上限

- 日期：2026-11-18
- 症状：（预防性，未实际触发）子目录的 URI 来自父目录的列表；若「需要列出的目录集合」只靠上一次渲染的结果逐层推进，重新挂载（切换工作区 / 侧栏视图）时多层已缓存的展开目录会连续触发渲染中 setState，深度十几层时可能超过 React 的重渲染上限。
- 解决：求集合时同时读取 TanStack Query 缓存（`queryClient.getQueryData`），一次求出所有已缓存层级（`features/explorer/tree-model.ts` 的 `resolveDirectoryUris`）。
- 预防：依赖「上一次结果」推进的派生 state，确认迭代次数有上界且与数据规模无关。

### shadcn：`spinner` 自带硬编码 `aria-label="Loading"`；`field` 依赖 `label`

- 日期：2026-11-18
- 症状：旁边已有本地化文字时，读屏会多读一次英文「Loading」；添加 `field` 时 CLI 额外生成 `label.tsx`。
- 解决：使用处传 `aria-hidden`（props 在后展开，可覆盖），不改组件；`label.tsx` 是 `field` 的依赖，保留。
- 预防：shadcn 组件保持 CLI 生成的原样，无障碍属性通过 props 覆盖。

### koffi 3：异步调用的 GetLastError 只能在回调内读取；指针是 BigInt；Electron 中不能用 `koffi.view`

- 日期：2026-11-19
- 症状：（预防性，实测确认）`fn.async(...)` 用 `util.promisify` 包装后，在 `await` 之后调用 `GetLastError()` 得到的不是失败调用的错误码。
- 原因：koffi 在工作线程上执行调用，只在调用回调期间把工作线程上的 LastError 恢复到主线程（`call.cc` 的 `AsyncCall::Complete`，回调返回后还原）；promise 的后续代码在回调之后的微任务中运行。
- 解决：在回调内同步调用 `GetLastError()`，与结果一起 resolve（`scanner/enum/win32-enumerator.ts` 的 `callAsync`）。其他要点：koffi 3 的指针是 BigInt（`INVALID_HANDLE_VALUE` 为 `0xFFFFFFFFFFFFFFFFn`，不是 `-1`）；`Buffer` 作为 `void *` 参数时直接传内存地址（不复制），异步调用期间保持引用即可；`koffi.view()` 会创建外部 ArrayBuffer，文档写明 Electron 禁止，不使用。
- 预防：koffi 的行为先读 `node_modules/koffi/doc` 与 `src/koffi/src/*.cc`，再用小脚本实测。

### node:sqlite：打开损坏的库失败后文件删不掉（`EPERM, Permission denied`）

- 日期：2026-11-19
- 症状：`index.db` 被写入垃圾内容后，`Cache.open` 抛出 `file is not a database`；随后 `rmSync(index.db)` 在 Windows 上报 `EPERM, Permission denied`，无法删除重建。
- 原因：`new DatabaseSync(file)` 本身不读文件头，第一条语句（`PRAGMA journal_mode = WAL`）才报错；此时连接已打开，若不 `close()`，文件句柄一直留在进程里，Windows 不允许删除被打开的文件。
- 解决：`scanner/cache/cache.ts` 的 `Cache.open` 在构造之后的任何失败都先 `db.close()` 再抛出；扫描进程删除 `index.db`、`-wal`、`-shm` 后重建一次（`scanner/main.ts` 的 `openCacheWithRecovery`），有测试。
- 预防：打开 node:sqlite 库后的初始化语句放进 try，失败时关闭连接；「删文件重建」的测试在 Windows 上跑，Linux 上可删除已打开的文件，测不出来。

### eslint-plugin-boundaries 7：按 import 写法（`?modulePath`）放行依赖

- 日期：2026-11-19
- 症状：想只允许 `main-vfs` 以 `import p from '../../scanner/main?modulePath'` 引用扫描进程入口，策略写 `dependency: { source: '**/scanner/main?modulePath' }` 不生效，仍报 `There is no policy allowing dependencies from elements of type "main-vfs" to elements of type "scanner"`。
- 原因：`source` 是 import 的原始写法，用 picomatch 匹配（`@boundaries/elements` 的 `isMatch`，未开 `dot`）；`**` 不匹配 `..` 这样的点开头路径段。TypeScript 解析器能把带 `?modulePath` 的路径解析到目标文件，所以目标元素确实是 `scanner`。
- 解决：`eslint.config.mjs` 中写确切的相对写法 `source: '../../scanner/main?modulePath'`（`?` 作为通配符恰好匹配字面的 `?`）；不带查询参数的普通 import 仍被拒绝（已用临时文件验证）。
- 预防：`source` 选择器先用确切写法；需要通配时注意 `..` 段。
