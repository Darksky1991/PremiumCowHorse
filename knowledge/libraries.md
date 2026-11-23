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
- 解决：临时映射无点号的盘符：`subst P: <仓库路径>` → 在 `P:\packages\ui` 执行 `npx shadcn@latest add <组件>` → `subst P: /D`。2026-11-19 补充：在 `P:` 下用 `pnpm exec shadcn add` **仍然失败**（同一报错；pnpm 从 `node_modules` 的符号链接解析到真实路径 `C:\Users\yongjun.fu\...`），必须用 `npx`；为与 `packages/ui` 依赖中的版本一致，写成 `npx --yes shadcn@<版本> add <组件> --yes`（当时为 4.23.0）。
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
- 现状（2026-11-19）：上面的「解决」**已不再使用**——目录的新鲜度改由扫描进程负责（`fs.watch` 删除），目录查询改回 `staleTime: Infinity`、`refetchOnWindowFocus: false`，`focusListenerSetup` 与 2 秒新鲜期已删除；窗口焦点由主进程的 BrowserWindow `focus` / `blur` 事件告知扫描进程。两条原因（focusManager 只听 `visibilitychange`；`staleTime: Infinity` 下 `refetchOnMount: true` 只对已失效的查询生效）仍然成立：后者正好用来让「折叠期间收到 `vfs.changed` 的目录」在再次展开时重新列出（`data/vfs.test.ts`）。

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

### TanStack Query：无观察者的查询被 gcTime 回收，「尚未加载」被误判为「项已不在」

- 日期：2026-11-20
- 症状：资源树中选中某目录下的项，收起其所在的分组抽屉，5 分钟以上后再展开：选中跳到抽屉标题，原来的选中丢失（整体审查发现，M1-3b 最终修复）。
- 原因：收起的抽屉内的目录查询没有观察者，TanStack Query 在 `gcTime`（默认 5 分钟）后回收缓存；重新展开时目录只显示「加载中」状态行，选中项暂时不在节点列表中。「选中项不在列表中」被按「已被删除」处理（回退到上一次的位置并写回 store），加载完成后已无法恢复。
- 解决：判断「被挡住」时，最近的可见祖先已展开但其子项只有「加载中 / 出错」状态行，也视为被挡住、不写回 store（`features/explorer/selection.ts` 的 `hiddenSelectionIndex`）。
- 预防：凡是根据「某项是否在查询结果派生的列表中」做不可逆处理（写回 store、清除选择）的逻辑，都要区分「已加载且没有」与「尚未加载 / 加载失败」；不要假设展开过的目录一直有缓存。

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

### Base UI Dialog：没有 Trigger、由快捷键打开（焦点在 body）时，`initialFocus` 的 ref 没有生效

- 日期：2026-11-23
- 症状：工作区选择器（受控 `open`、无 `Dialog.Trigger`）由 Alt+W 打开时，焦点停在弹出层本身（`div[role=dialog]`），不在 `initialFocus` 指定的筛选框；由按钮点击打开时正常。焦点停在弹出层后，挂在内部 `div` 上的 `onKeyDown` 收不到按键（Esc 两级、方向键全部失效）。
- 原因（部分核实）：`FloatingFocusManager` 在打开后的 microtask 里解析 `initialFocus`，`enqueueFocus` 的 `shouldFocus` 在「焦点已移入弹出层内的其他元素」时放弃移动；本例中弹出层自身先获得了焦点（`focusin` 记录只有 `DIV#dialog`，没有 `INPUT`），所以放弃。弹出层为何先获得焦点没有追到底（与打开前焦点在 body 有关，点击按钮打开时不发生）。
- 解决：面板挂载后在下一帧 `requestAnimationFrame(() => input.focus())` 补一次；按键处理挂在 `DialogContent`（弹出层）上而不是内部元素（`features/workspace/picker/workspace-picker.tsx`）。e2e `workspace-picker.spec.ts` 断言 Alt+W 打开后筛选框获得焦点。
- 预防：受控、无 Trigger 的对话框要分别验证「点击打开」与「快捷键打开」的初始焦点；对话框级的按键处理挂在弹出层上。

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

### eslint-plugin-boundaries 7：默认不拦第三方包与 Node 内置模块

- 日期：2026-11-20
- 症状：新增纯逻辑包 `packages/text-engine`（要求不依赖任何包），在其中写 `import { readFileSync } from 'node:fs'`，`boundaries/dependencies`（`default: 'disallow'`）不报错；`import '@pch/shared'` 才报错。
- 原因：boundaries 的策略只作用于被分类为元素的工作区文件；`node:fs`、`zod` 这类外部依赖不属于任何元素，`default: 'disallow'` 管不到。
- 解决：`eslint.config.mjs` 对 `packages/text-engine/src/**`（测试除外）另加 `no-restricted-imports`（`patterns: [{ regex: '^(?!\\.{1,2}/)' }]`，只允许相对路径）与 `no-restricted-globals`（`process`、`Buffer`、`require`、`window`、`document` 等）；用临时文件验证 `node:fs` / `zod` / `process` / `document` 均被拒绝。
- 预防：要求「不依赖任何包」的目录不能只靠 boundaries；另加 import / 全局变量限制并用临时文件验证。

### shadcn ToggleGroup：选中项在侧栏上几乎看不出来（改用 Tabs）

- 日期：2026-11-19
- 症状：搜索视图的类型筛选（全部 / 文件 / 文件夹）用 `toggle-group`（`variant="outline"`、`spacing={0}`）实现后，整窗截图中看不出哪一项被选中，浅色、深色都如此。
- 原因：`toggle` 的选中样式是 `aria-pressed:bg-muted`；neutral 主题下 `--muted`（oklch 0.97）与侧栏背景 `--sidebar`（oklch 0.985）几乎相同。组件按约定不手改样式。
- 解决：改用 shadcn `tabs`（`TabsList` 为 `bg-muted`，选中的 `TabsTrigger` 为 `bg-background` + 阴影，侧栏上对比明显）；只切换结果列表的内容，不使用 `TabsContent`。已删除未使用的 `toggle` / `toggle-group`。e2e 中按 `role="tab"` + `aria-selected` 断言。
- 预防：在 `bg-sidebar` 上使用以 `bg-muted` 表示状态的组件时，先看整窗截图再决定。

### node:sqlite / SQLite：「按优先级取下一个目录」的查询要靠部分索引 + `INDEXED BY` + 批量候选

- 日期：2026-11-19
- 症状：后台缓存队列每选一个目录查一次 `index.db`（`Cache.nextUnlisted` / `oldestChecked`：范围 + 层数上限过滤，按 `(depth, uri)` 或 `checked_at` 排序，LIMIT N）。最初的实现在整卷范围上是 O(行数)：文件库 30 万行约 240–430ms，每 0.5 秒一次，相当于持续占用一个核的一大部分。
- 原因：SQLite 对「主键范围 + 额外过滤 + 另一列排序 + LIMIT」选择按主键范围扫描再 `USE TEMP B-TREE FOR ORDER BY`，要读完整个范围才能排序；层数只能从 URI 算，无法进索引。
- 解决：`scanner/cache/cache-schema.ts` 加生成列 `depth` 与两个互不重叠的部分索引 `dirs_unlisted (depth, uri) WHERE checked_at IS NULL`、`dirs_checked (checked_at, uri, depth) WHERE checked_at IS NOT NULL`；先探测范围大小（数到 2000 为止），范围小走主键范围 + 排序，范围大用 `INDEXED BY` 强制按队列索引顺序扫描 + LIMIT（`cache.ts` 的 `queueQuery`）。整卷、层数不限降到约 0.2–0.3ms（30 万行，内存库 / 文件库）。残余：整卷而层数上限很小（`maxDepth` 1）时，符合条件的行在 `checked_at` 顺序中很稀疏，`oldestChecked` 仍要扫很多行（内存库约 15ms，文件库约 25–45ms），所以后台队列（`schedule/background-queue.ts`）一次取一批候选（④ 200 个、其余 50 个）在内存中逐个消费，平摊到每次选择约 0.04–0.2ms（数字与条件见 `devDoc/2026-11-19-09-cache-strategy.md`）。
- 预防：会被频繁调用的 SQLite 查询，用接近真实的数据形状、**文件库**（不只是内存库）测最坏的范围与过滤条件；用 `EXPLAIN QUERY PLAN` 在单元测试中断言计划（不出现裸 `SCAN` / `TEMP B-TREE`）；高频选择优先「批量取、内存中消费」，而不是每次一条查询。报告性能数字时写明内存库 / 文件库、行数、范围与层数上限。

### SQLite：`INTEGER PRIMARY KEY AUTOINCREMENT` 的表上，冲突的 `INSERT … ON CONFLICT` 也会消耗编号

- 日期：2026-11-19
- 症状：`dirs` 改用整数编号后，对已存在的子目录每次刷新都执行 `INSERT … ON CONFLICT(uri) DO UPDATE`，`sqlite_sequence.seq` 随之增长，编号出现大量空洞（实测：5 次冲突的插入使下一个编号从 2 跳到 7）。
- 原因：SQLite 在检查 UNIQUE 约束之前就已分配 rowid，AUTOINCREMENT 记录了这次分配；没有 AUTOINCREMENT 时是 `max(rowid)+1`，不留痕迹。
- 解决：`scanner/cache/cache.ts` 的 `upsertDir` 先按 `uri` 查编号，不存在才 `INSERT … RETURNING id`，存在则 `UPDATE`。保留 AUTOINCREMENT 的原因：不复用编号，目录删除后以同一 URI 重建一定得到新编号，残留的 `parent_id` 不会指向别的目录。
- 预防：AUTOINCREMENT 表的「存在则更新」用先查后写，不要用冲突式插入；用 `INSERT … SELECT … WHERE NOT EXISTS` 也不会消耗编号（无行产生）。

### `react-hooks/static-components`：从缓存取出的 `React.lazy` 组件被报 "Cannot create components during render"

- 日期：2026-11-19
- 症状：预览容器在渲染中按插件取出懒加载组件（`const C = lazyComponentOf(plugin)`，内部用 Map 缓存 `lazy(plugin.load)`），再 `<C />`，eslint-plugin-react-hooks 7 报 `Error: Cannot create components during render`。
- 原因：该规则（面向 React Compiler）把「渲染中由函数调用得到、再作为 JSX 类型使用的值」一律视为在渲染中创建的组件，看不出背后有缓存。
- 解决：不在渲染中取组件，改为缓存 `plugin.load()` 的 Promise，用 React 19 的 `use(promise)` 在 Suspense 中等待模块，再渲染模块的默认导出（`features/preview/preview-container.tsx` 的 `PluginBody`）；加载失败时 `use` 抛出拒绝原因，由外层错误边界接住。
- 预防：动态选择组件时缓存「数据（模块 Promise）」而不是「组件」；Promise 必须缓存（每次渲染新建 Promise 会无限挂起）。

### `TextDecoder`：默认 `ignoreBOM: false` 会在每次（非 stream）`decode` 的开头去掉 U+FEFF

- 日期：2026-11-20
- 症状：按行解码时，每行都用同一个 `TextDecoder` 调用 `decode(lineBytes)`；以 U+FEFF 开头的行（以及文件开头的 BOM）被悄悄去掉，「是否跳过 BOM」不受调用方控制。
- 原因：WHATWG Encoding 规范中 UTF-8 / UTF-16 解码器在每个新流的开头吞掉 BOM；非 stream 的 `decode()` 每次都开始新流。
- 解决：`packages/text-engine/src/decode.ts` 用 `new TextDecoder(label, { ignoreBOM: true })`，文件开头的 BOM 由调用方按 `detectEncoding` 的 `bomLength` 用 `skipBytesAtStart` 跳过。
- 预防：分段 / 按行解码时总是显式写 `ignoreBOM`；被截断的行用 `decode(bytes, { stream: true })` 再 `decode()` 丢弃残缺字符（flush 会产生 U+FFFD）。

### 编码判断：「能被 GB18030 fatal 解码」不能用来排除其他编码（UTF-16LE 的假名恰好是合法的四字节序列）

- 日期：2026-11-20
- 症状：无 BOM 的纯日文 UTF-16LE（如「ファイル」= `D5 30 A1 30 A4 30 EB 30`）被判成「字节编码解释得通」，UTF-16 判断失败。
- 原因：GB18030 的四字节形式是「81–FE, 30–39, 81–FE, 30–39」，UTF-16LE 的片假名 / 平假名（U+30xx）的字节正好是「任意, 0x30」交替，`TextDecoder('gb18030', { fatal: true })` 能解码成功（得到增补平面的字符）。ASCII 与 Shift_JIS 片假名按 UTF-16LE 读也常落在 CJK 区（`'ex'` = U+7865）。
- 解决：`packages/text-engine/src/utf16-guess.ts` 的纯中日文路径要求「UTF-8 不合法，且 Shift_JIS / EUC-JP / GB18030 / Big5 都不合法或常用字区打分不为正」；GB18030 的四字节在打分中计 -0.5。
- 预防：GB18030 几乎接受任意高位字节序列，排除候选时要看打分，不能只看 fatal 解码是否成功。
- 补充（审查第 1 轮）：windows-1252 的短英文（含 1 个重音字母或弯引号）也曾被判成纯中日文 UTF-16——小写字母两两组成的单元落在 U+6100–7AFF。windows-1252 总能解码，改为「打分为正且 ASCII 文本字符占字节 ≥ 60%」时视为字节编码解释得通（`looksWestern`）。

### React：`onWheel` 是 passive 监听，`preventDefault()` 无效（自绘滚动要用原生监听）

- 日期：2026-11-20
- 症状：文本插件自绘分页（纵向不用原生滚动），在 JSX 的 `onWheel` 里调用 `e.preventDefault()` 不能阻止外层 / 默认滚动，Chromium 控制台提示 "Unable to preventDefault inside passive event listener invocation"。
- 原因：React DOM 在根容器上以 `{ passive: true }` 注册 `wheel` / `touchstart` / `touchmove`（`react-dom-client.development.js` 的 `addTrappedEventListener`：这三个事件名且浏览器支持 passive 时 `listenerWrapper = !0`）。React 19.3 仍是如此。
- 解决：在 `useEffect` 中对元素 `addEventListener('wheel', handler, { passive: false })`，卸载时移除（`plugins/builtin/src/text/text-view.tsx`）。`Shift` + 滚轮或横向滚动不调用 `preventDefault`，交给原生的横向滚动。
- 预防：需要拦截滚轮 / 触摸的组件一律用原生监听；只读取 `deltaY` 而不拦截时 `onWheel` 可以照用。

### TanStack Query：`mutateAsync` / `refetchQueries` 返回时，用 `useQuery` 的组件还没有按新数据渲染

- 日期：2026-11-21
- 症状：从工作区一览切换工作区，`await activate.mutateAsync(id)` 之后立即对旧工作区的标签执行 tabs-store（zustand）的后退，旧标签在界面上短暂退回之前的位置（e2e 用 MutationObserver 在地址栏 / 标签栏记录到了旧位置的文字），之后才换成新工作区。
- 原因：两层延迟。① 界面显示哪个工作区取决于 `useActiveWorkspace()` 的查询，它要等主进程的 `workspace.changed` → `invalidateQueries` → 再调用一次 `workspace.active` 才更新，`activate` 的 IPC 返回时还没开始。② 即使先 `await refetchQueries(...)`，`@tanstack/query-core` 5.107 的 `notifyManager` 默认用 `setTimeout(cb, 0)` 通知观察者（`notifyManager.js` 的 `defaultScheduler = systemSetTimeoutZero`），Promise 返回时组件仍拿着旧数据；而 zustand 的 `set` 同步通知订阅者，React 19 在微任务中渲染——于是先渲染了「旧工作区 + 后退后的标签」。
- 解决：不在「切换的 Promise 返回后」做依赖界面已切换的操作，改为在因切换而卸载的组件（工作区一览）的 effect 清理中做：清理在新界面提交之后执行，用 `queryClient.getQueryData` 读到的已是新值（`features/workspace/workspaces-page.tsx` + `data/workspace.ts` 的 `useReadActiveWorkspaceId`）。
- 预防：需要「界面已显示新状态之后」再执行的副作用，挂在渲染结果上（effect / 卸载清理），不要挂在 mutation 或 refetch 的 Promise 上；混用 TanStack Query 与 zustand 时注意两者的通知时机不同。

### koffi 3：`struct` / `proto` 同名重复定义抛 `Duplicate type name`（第二次加载静默落入退路）

- 日期：2026-11-21（2026-11-22 复现核对）
- 症状（M3 Task 5）：`loadListWindows()` / `getLogonTime()` 每次调用都重新声明 `RECT`、`WTSINFOW`、`EnumWindowsProc` 等，第一次正常，第二次调用时 `loadListWindows()` 返回 null、`getLogonTime()` 悄悄改用 shell 进程创建时刻的退路，没有明显报错（异常被各自的 try/catch 吞掉）。
- 原因：koffi 的类型注册表是进程全局的，`koffi.struct('X', …)` / `koffi.proto('… X(…)')` 对已存在的名字抛 `Duplicate type name 'X'`（koffi 3.3.8，Node 26 实测）。
- 解决：原生声明在进程内只做一次（`modules/desktop/window-list.ts`、`logon.ts` 用模块级变量缓存声明结果，失败也只记一次）。
- 预防：koffi 的声明放在模块级的「首次使用时初始化」函数里，不要放在每次调用的路径上；单元测试里多次调用加载函数，确认第二次的结果与第一次相同。

### sudo `-S`：密码后紧接着写入后续输入，输错一次会被记为 2 次失败

- 日期：2026-11-22
- 症状（M4 先行试验）：经 SSH 命令通道执行 `sudo -k -S su - app1`，写入密码后立刻写入要交给目标 shell 的命令行；密码错误时 sudo 日志为 `2 incorrect password attempts`。
- 原因：sudo 认证失败后重新提示并从标准输入读下一行，已写入的命令行被当成第二次密码。认证成功时 sudo 不输出任何东西，无法据输出判断何时可以写后续输入。「先 `sudo -v` 再 `sudo -n`」也不可行：没有 tty 时 sudo 不缓存凭据（`a password is required`）。
- 解决：认证成功后才写后续输入。判定办法：另开通道轮询进程表，sudo（`exec` 前打印 `$$` 得到其 PID）的子孙中出现 `su` 即成功（PAM 认证在 sudo 进程内完成，成功后才 fork）；再次出现提示即失败，立即关闭通道。Debian 13、AlmaLinux 9、openSUSE Leap 16.1、Ubuntu 26.04（sudo-rs）实测失败只记 1 次（`devDoc/2026-11-22-37-m4-sftp-design.md` 第 5.4、7 节）。
- 预防：自动输入密码的流程都要考虑「输错时多余的输入被当成密码」；开了 `pam_faillock` 的环境连续 3 次失败即锁号。

### sudo-rs（Ubuntu 26.04 默认）：提示格式不同、不支持 `requiretty`

- 日期：2026-11-22
- 症状：`sudo -p 'PCHPW:'` 的提示显示为 `[sudo: PCHPW:] Password: `；sudoers 中写 `Defaults:pchuser requiretty` 报 `unknown setting: 'requiretty'`。
- 原因：Ubuntu 26.04 的 `sudo` 是 Rust 重写的 sudo-rs（0.2.13），与传统 sudo 不完全兼容。
- 解决：检测提示时用「包含标记」而非「等于标记」；`requiretty` 只会出现在传统 sudo 的环境。
- 预防：对 sudo 输出的解析按 sudo / sudo-rs 两种实现都验证。
- 补充（2026-11-23，M4 Task 14a / 14-fix 实机）：
  - **拒绝的措辞不同、且不先提示密码**：sudoers 不允许时 sudo-rs 0.2.13 直接输出 `sudo: I'm sorry pchuser. I'm afraid I can't do that` 并以 1 退出（`LC_ALL=C sudo -k -S -p PCHP su - app2` 实测，未提示密码）；传统 sudo 先提示、交出密码后才报 `Sorry, user pchuser is not allowed to execute '/usr/bin/su - app2' as root …`。只匹配传统措辞时 sudo-rs 的拒绝落入「通道提前关闭」（`CONN_SUDO_FAILED`）。`sudo-switch.ts` 的 `DENIED_PATTERN` 已加入固定部分 `I'm afraid I can't do that`（不匹配泛泛的 `sorry`），并有跨 chunk 的单元测试。
  - **不支持 `Defaults logfile=`**（同 `requiretty` / `targetpw`）：`visudo -cf` 拒绝。数失败次数改用 journald 中 PAM 的 `pam_unix(sudo:auth): authentication failure` 行（`journalctl --since @<秒>`；sudo-rs 与传统 sudo 都记），见 `scripts/wsl-sftp/README.md`。

### ssh2：不设置 `hostVerifier` 时自动接受任何主机密钥；没有在 exec 通道上走 SFTP 的公开 API

- 日期：2026-11-22
- 症状 / 事实：`ssh2` 1.17.0 README：`hostVerifier` 默认「auto-accept if hostVerifier is not set」；`client.sftp()` 只能经 `sftp` 子系统开通道（`lib/client.js` 的 `reqSubsystem`）。
- 解决：始终设置 `hostVerifier`（支持 `(key, callback)` 异步确认）。要在 `sudo su - x` 之后的命令通道上走 SFTP，借用内部类 `ssh2/lib/protocol/SFTP.js`：它只通过 `client._protocol.channelData(id, data)` 写出、经 `push(data)` 收入，可桥接到任意双工流（`scripts/wsl-sftp/reference/sudo-sftp-spike.mjs` 的 `sftpOverStream`）。文件名按 UTF-8 编解码（`readString(true)` / `utf8Write`），非 UTF-8 文件名无法往返。
- 预防：借用内部 API 时固定精确版本，并用测试覆盖；升级 `ssh2` 时先跑这些测试。

### ssh2 `utils.generateKeyPairSync('ed25519')`：约 1/256 生成畸形密钥（`Malformed OpenSSH private key`）

- 日期：2026-11-22
- 症状（M4 Task 5）：`ssh-session.test.ts` 偶发失败，单独连跑 5 次约失败 1 次：`Error: Malformed OpenSSH private key`，栈指向假服务器 `startFakeSftpServer` 中对刚生成的主机密钥调用 `utils.parseKey`（`keyParser.js` 第 728 行，`parseOpenSSHPrivKeys`）。
- 原因：`ssh2` 1.17.0 的 `lib/keygen.js` 第 290–297 行从 SPKI DER 的 BIT STRING 取 ed25519 公钥时「去掉**所有**前导 0x00」。本意只是去掉 BIT STRING 的「未用位数」字节（恒为 0x00），但公钥本身以 0x00 开头时（概率 1/256）也被截掉，生成 31 字节的公钥，ssh2 自己的解析器要求 32 字节（第 726–728 行的长度判断）而拒绝。实测 10 000 个中 46 个畸形，公钥长度全为 31。**解析器没有问题**：真实 `ssh-keygen`（Windows 自带 OpenSSH）生成的公钥以 0x00 开头的密钥（未加密 / 加密）都能被 `parseKey` 正确解析。ECDSA 不受影响（公钥点以 0x04 开头）。
- 解决：测试夹具改用 `modules/connection/testing/test-keys.ts` 的 `generateEd25519KeyPair()`，按根因检查输出（公钥必须是 32 字节），只丢弃有缺陷的输出；另以测试固定「公钥以 0x00 开头的合法密钥能被 `parsePrivateKey` 接受」。
- 预防：产品代码不要用 `ssh2` 的 `generateKeyPairSync` 生成 ed25519 密钥（需要时用 `node:crypto` 生成后自行按 OpenSSH 格式组装）；随机生成的夹具要考虑「低概率的边界值」，在测试中大量生成并逐个校验，避免偶发失败。升级 `ssh2` 时确认该问题是否已修复。

### ssh2 `readyTimeout`：计时覆盖认证阶段（与主机密钥确认的等待）；与保活超时同为 `client-timeout`

- 日期：2026-11-23
- 症状（M4 Task 1 核实、整体审查 I1）：`readyTimeout`（默认 20000 ms）超时时 `error.level = 'client-timeout'`、消息 `Timed out while waiting for handshake`；保活超时的 level 也是 `client-timeout`（消息 `Keepalive timeout`）。用户在主机密钥确认框前犹豫、或服务器认证很慢（PAM 失败有约 2 秒延迟）时，同样以握手超时结束。
- 原因：`ssh2` 1.17.0 `lib/client.js` 的 `startTimeout`（第 1110–1118 行）在连接时开始计时，只在 `USERAUTH_SUCCESS`（第 368 行）或握手层错误时清除——计时包含异步 `hostVerifier` 的等待与整个认证阶段。
- 解决：按 `message` 区分握手超时（`FS_TIMEOUT`）与保活超时（断开）；主机密钥尚未信任的首次连接把 `readyTimeout` 设为 `max(vfs.timeoutSec.remote × 1000, 300_000)`（`connection-pool.ts` 的 `FIRST_CONNECT_READY_MS`，R5）；**已交出密码之后**、`ready` 之前的超时 / 断开不当作「断开」，而按认证失败锁定（`ssh-session.ts`，detail `undetermined after password (…)`，否则后台退避探测会以同一个可能错误的密码反复提交）。
- 预防：不要把 `readyTimeout` 理解为「TCP + 密钥交换」的超时；涉及「交出密码后结果未定」的分支一律按失败处理（反目标：账号被锁）。

### OpenSSH 的会话命令：SIGPIPE 为默认处理（Debian 13 实测）；服务器上的轮询循环仍要自己能结束

- 日期：2026-11-23
- 症状 / 担心（M4 整体审查 I2b）：身份切换时在服务器上常驻 `while :; do ps …; echo PCHEND; sleep 0.15; done` 轮询进程表。客户端关闭通道后，循环只能靠写失败时的 SIGPIPE 结束；若会话命令继承了被忽略的 SIGPIPE（systemd 服务默认 `IgnoreSIGPIPE=yes`），内建 `echo` 写失败只返回非零，循环会在客户服务器上永久运行。
- 事实（实测）：Debian 13（OpenSSH_10.0p2 Debian-7+deb13u4）以 `bash -c "trap '' PIPE; … exec /usr/sbin/sshd -D -e -p 2299 …"` 启动临时 sshd（监听进程 `SigIgn: 0000000000001000`，SIGPIPE 被忽略），会话中的轮询 bash 为 `SigIgn: 0x4`——**OpenSSH 的会话子进程恢复了 SIGPIPE 的默认处理**，关闭通道后无残留（修前也是 0 个）。在轮询命令前加 `trap '' PIPE;` 模拟「继承了被忽略的 SIGPIPE」时（SigIgn `0x1004`），修前 6.5 秒后残留 1 个循环。WSL 中的 sshd 由脚本直接启动、不经 systemd，systemd 下的 sshd 与其他发行版未用这种方法验证。
- 解决：`sudo-switch.ts` 的 `pollCommand`：`i=0; while [ $i -lt N ]; do ps -eo pid=,ppid=,comm= || exit; echo PCHEND || exit; sleep S; i=$((i+1)); done`，N = ceil(2 × 切换超时 / 间隔)（150 ms、15 秒 → 200 次 ≈ 30 秒）。修后模拟情形也无残留；`wsl.test.ts` 断言切换后 `pgrep -a -f '[P]CHEND'` 为空。
- 预防：在别人的服务器上启动的循环必须「写失败即退出 + 次数上限」，不依赖信号的默认处理。

### ssh2 的 `.ppk`：只支持 PPK v2（RSA / DSA），未加密的 `.ppk` 不能传口令

- 日期：2026-11-22
- 症状（M4 Task 1）：PuTTY 0.75+ 默认导出的 PPK v3、以及 Ed25519 的 `.ppk`，`utils.parseKey` 返回 `Error: Unsupported key format`；对未加密（`Encryption: none`）的 PPK v2 传入任何非空口令返回 `Error: PPK private key integrity check failed`。
- 原因：`ssh2` 1.17.0 `lib/protocol/keyParser.js` 的 PPK 解析正则只认 `PuTTY-User-Key-File-2: ssh-(rsa|dss)` 与 `Encryption: aes256-cbc|none`；口令参与 Private-MAC 的计算。`parseKey` 以**返回** `Error` 表示失败（不抛出），对 OpenSSH 新格式可能返回数组。
- 解决：先不带口令解析，提示需要口令（加密）时再带口令；不支持的格式映射为 `CONN_KEY_INVALID`（本机错误，不连接、不锁定），界面提示用 PuTTYgen 转换为 OpenSSH 格式。
- 预防：加密的 PPK v2（`aes256-cbc`）与真实 PuTTYgen 导出的文件未验证（无样本）；遇到用户的 `.ppk` 问题先确认版本行与 `Encryption:` 行。

### shadcn Button 的 `transition-all` 会过渡继承来的 `visibility`：刚显示的按钮 `focus()` 无效

- 日期：2026-11-23
- 症状（M5 Task 13）：减少动效时选择器的删除确认不翻转、只用 `invisible`（visibility: hidden）切换可见的一面；翻到背面后 `cancelRef.current.focus()`（effect 中、甚至下一帧 rAF 中）都不生效，焦点落到 body；500 ms 后手动 `focus()` 却成功，`getComputedStyle` 也是 visible。
- 原因：shadcn `Button` 带 `transition-all`，祖先的 `visibility` 变化经继承也被按钮过渡（默认 150 ms）；过渡起点按钮仍是 hidden，不可获得焦点。
- 解决：要切换显示的一面用 `hidden`（display: none，不参与 `transition-all`），不用 `invisible`。
- 预防：用 `visibility` 显隐含 shadcn 按钮 / 输入框的区域、并在显隐后立即移动焦点时，改用 display 或在过渡结束后再移焦点；不要靠 rAF 碰运气。
