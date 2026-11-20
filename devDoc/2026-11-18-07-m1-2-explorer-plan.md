# M1-2 资源树 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧栏显示当前工作区的条目树（分组 + 真实目录懒加载、虚拟滚动），支持工作区切换与管理、拖放管理条目、右键菜单与目录变化感知。

**Architecture:** 主进程补齐 M1-1 审查遗留项，并增加目录监听（`vfs.watch` / `vfs.changed`）与系统操作 IPC。渲染端新增 `data/`（工作区、条目、目录的查询与事件桥接）、`features/explorer`（资源树）与 `features/workspace`（工作区切换器）。外壳 `features/shell` 改为插槽式，由 `app/` 组合各 feature。树的可见节点由纯函数从「条目 + 展开集合 + 目录列表」计算，再交给 `@tanstack/react-virtual` 渲染。

**Tech Stack:** Electron 45、React 19、TanStack Query、zustand、`@tanstack/react-virtual`（新依赖，已确认）、shadcn/ui（Base UI）、zod 4、Kysely、vitest、Playwright。

**Spec:** [`doc/PremiumCowHorse-架构设计方案.md`](../doc/PremiumCowHorse-架构设计方案.md) v1.6 第 5.3、7.1、7.2、8.1–8.3、12.1、12.2 节；约定见 [`CLAUDE.md`](../CLAUDE.md)；接口基础见 [M1-1 记录](./2026-11-18-06-m1-1-data-layer.md)。

## 已定决策（2026-11-18，需求方确认）

- **拖放只管理自定义条目，绝不对真实文件做任何操作**（移动、复制、删除、新建）。树内拖动用浏览器原生拖放。真实目录中的节点不接受放置。
- 列目录时解析符号链接 / 目录联接的目标类型。
- 并入本计划的 M1-1 暂缓项：路径规范化与网络类错误映射、移动 / 删除条目时在事务内读取、默认工作区可恢复默认名称。
- 本计划内的设计决定（实现者照此执行）：
  - 外壳插槽：`Shell` 接收 `sidebarViews` 与 `workspaceSwitcher`，由 `app/` 组合（feature 之间不互相 import）。
  - 条目可按本地路径或 URI 添加（「固定」真实子目录时用 URI）；默认标签取 `vfs.stat` 返回的名称（`displayName`）。
  - 复制路径提供「路径」与「URI」两种；映射盘符转 UNC 留到引入 koffi。
  - 变化感知：本地与网络路径都用 `fs.watch`；所有目录列表在窗口重新获得焦点时刷新；`remote.pollIntervalSec > 0` 时对 UNC 路径（URI 带主机名）轮询。映射盘符被视为本地（检测映射盘需要 Windows API）。
  - 「添加文件夹 / 文件」按钮使用系统对话框（新增 `system.selectPaths`）。
  - 重命名与删除使用对话框（Dialog / AlertDialog），删除确认中明确「不会删除真实文件」。
  - 展开状态保存在 `features/explorer` 的 zustand store，按工作区区分（M3 起纳入会话快照）。

## Global Constraints

- 不新增 `@tanstack/react-virtual` 以外的依赖；shadcn 组件经 CLI 添加（含 `.` 的用户目录需 `subst`，见 `knowledge/libraries.md`），生成后检查 `sonner.tsx` 无 `next-themes`、删除 CLI 生成的 `package-lock.json`。
- 不产生任何文件系统写操作：主进程不新增任何写文件 / 移动 / 删除的 API；渲染端拖放不设置 `DownloadURL` 等会让系统生成文件的数据。
- 分层（`eslint.config.mjs`）：feature 之间不互相 import；新 feature 目录自动归入 `r-feature`；`data/` 只依赖 `lib/` 与 `@pch/shared`。
- IPC 输入一律 zod 校验；新错误码三种语言文案齐全；界面文案三种语言齐全（ja 为类型基准）。
- shadcn 组件不手改样式，`className` 只用于布局；图标用 lucide-react；Base UI 用 `render` 而非 `asChild`。
- 每个任务结束：`pnpm typecheck && pnpm lint && pnpm test` 通过；涉及界面的任务另跑 `pnpm build && pnpm test:e2e`。
- 提交信息用英文 Conventional Commits；文档与注释用中文。

## Review Focus

1. **拖放误触发文件操作**：任何拖放组合（条目→条目、真实节点→根 / 分组、系统文件→任意位置、拖到真实目录节点上、拖出应用）之后，磁盘上的文件与目录完全不变。→ Task 7 单元测试（`resolveDrop` 对真实节点目标返回 null）与 Task 10 e2e（拖放前后对临时目录做完整快照比较）。
2. **大目录与慢速网络目录**：展开 1 万项的目录时界面不卡顿（虚拟滚动只渲染可见行）；展开一个超时的目录时显示错误行和「重试」，其他目录仍可操作。→ Task 6 测试（模型对 1 万项只产出可见行所需数据）与 Task 10 e2e（错误行）。
3. **目录在展开状态下被删除或改名**：该节点显示「找不到」错误行，不影响其他节点；监听自动解除。→ Task 3 测试（监听在目录删除后不抛错）与 Task 10 e2e。
4. **快速连续操作**：连续拖动排序、快速展开 / 折叠同一目录时，顺序与列表最终一致，不出现重复行（同一目录的列表请求以 `dir:<uri>` 为 requestId，新请求取代旧请求）。→ Task 1 测试（并发 move 后 sortOrder 连续）与 Task 6 测试（节点 id 唯一）。
5. **切换工作区与删除当前工作区**：删除当前工作区后自动切回默认工作区；切换后树、标题栏、欢迎页同时更新，旧工作区的监听被解除。→ Task 9 / Task 10 e2e。

---

### Task 1: 主进程遗留修正（路径规范化、错误映射、按 URI 添加、事务内读取、默认名称）

**Files:**

- Create: `apps/desktop/src/main/vfs/input-path.ts`、`vfs/input-path.test.ts`
- Modify: `vfs/errors.ts`（+测试 `vfs/errors.test.ts`）、`packages/shared/src/workspace/schema.ts`（+测试）、`packages/shared/src/errors/app-error.ts`、三种语言 `errors`、`modules/workspace/workspace.service.ts`（+测试）

**Interfaces:**

- Produces:
  - `function toFileUri(inputPath: string): string`（`vfs/input-path.ts`）：去掉首尾空白与一对首尾双引号；要求 `path.win32.isAbsolute` 且不是盘符相对路径（`C:foo`）；`pathToFileURL` 失败（如单独的 `\\server`）一律 `AppError('FS_INVALID_URI')`。
  - 错误码新增 `FS_UNAVAILABLE`（「位置无法访问」：ETIMEDOUT、ECONNRESET、ECONNREFUSED、ENETUNREACH、ENETDOWN、EHOSTUNREACH、EHOSTDOWN、EIO）、`WORKSPACE_NAME_REQUIRED`；`ERR_INVALID_FILE_URL_PATH`、`ERR_INVALID_FILE_URL_HOST`、`ERR_INVALID_URL`、`ERR_INVALID_ARG_VALUE` → `FS_INVALID_URI`。
  - `EntryAddInput` 的 folder / file 变体：`path` 与 `uri` **恰好提供一个**（`uri` 为字符串，由 VFS 校验）；`label` 可选。
  - `WorkspaceUpdateInput.name`：trim 后 0–100 字符；空字符串只允许用于 `default`（恢复本地化名称），其他工作区 → `WORKSPACE_NAME_REQUIRED`。
  - `WorkspaceService`：`addEntry` 的默认标签改为 `vfs.stat` 返回的 `name`；`updateEntry` / `removeEntry` / `moveEntry` 在事务内读取条目，`workspace.changed` 的 id 取自事务内读到的条目。

- [ ] **Step 1: 写失败的测试**：
  - `input-path.test.ts`：`'"C:\\案件 A"'` → URI 往返为 `C:\案件 A`；`'  C:\\x  '` 去空白；`'locales'`、`'C:foo'`、`'\\\\server'` → `FS_INVALID_URI`
  - `errors.test.ts`：`{ code: 'ETIMEDOUT' }`、`{ code: 'EIO' }` → `FS_UNAVAILABLE`；`{ code: 'ERR_INVALID_FILE_URL_PATH' }` → `FS_INVALID_URI`
  - schema：folder 变体同时给 `path` 与 `uri` → 失败；都不给 → 失败
  - service：按 URI 添加真实子目录成功且标签为目录名；把 `default` 改名为 `''` 成功（`name === ''`）；把其他工作区改名为 `''` → `WORKSPACE_NAME_REQUIRED`；对同级 [a, b, c, d] 并发执行 4 次 `moveEntry` 后 `sortOrder` 为 0..3 且不重复（Review Focus 4）
- [ ] **Step 2: 运行确认失败**：`pnpm vitest run apps/desktop/src/main packages/shared` → 新测试 FAIL
- [ ] **Step 3: 实现**（`WorkspaceService.write` 改为由回调返回 `{ workspaceId, result }`）
- [ ] **Step 4: 运行确认通过**；`pnpm typecheck && pnpm lint && pnpm test`
- [ ] **Step 5: 提交** `fix(main): normalize input paths, map network errors, read entries inside transactions`

### Task 2: 符号链接 / 目录联接的目标类型

**Files:**

- Modify: `packages/shared/src/vfs/types.ts`、`apps/desktop/src/main/vfs/providers/local.provider.ts`（+测试）

**Interfaces:**

- Produces: `FileEntry.target?: 'file' | 'directory' | null`——仅当 `kind === 'symlink'` 时存在；`null` 表示目标不存在（失效链接）。在 `statChild` 内对链接额外 `fs.stat` 一次（计入同一并发上限）。

- [ ] **Step 1: 写失败的测试**（临时目录，用 `fs.symlink(dir, link, 'junction')` 创建目录联接——Windows 下不需要管理员权限）：联接项 `kind: 'symlink', target: 'directory'`；指向已删除目录的联接 `target: null`；普通文件无 `target` 属性
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行确认通过**；全量检查
- [ ] **Step 5: 提交** `feat(main): resolve symlink and junction target kinds when listing`

### Task 3: 目录监听（`vfs.watch` / `vfs.changed`）

**Files:**

- Modify: `vfs/types.ts`、`vfs/providers/local.provider.ts`、`vfs/vfs.service.ts`、`vfs/vfs.ipc.ts`、`packages/shared/src/ipc/contract.ts`、`core/events.ts`、`bootstrap/container.ts`、`bootstrap/bootstrap.ts`
- Test: `vfs/vfs.service.test.ts`、`vfs/providers/local.provider.test.ts`

**Interfaces:**

- Produces:
  - `FileSystemProvider.watch?(uri: URL, onChange: () => void): { close(): void }`；`LocalProvider.watch` 用 `fs.watch(dir, { persistent: false })`，监听器 `error`（含目录被删除）时自行关闭、不抛出。
  - `VfsService` 构造选项增加 `onDirectoryChanged?: (uri: string) => void` 与 `watchDebounceMs?: number`（默认 300）；方法 `setWatched(ownerId: number, uris: string[]): void`（以集合替换该 owner 的监听集合，按 URI 引用计数，无 owner 引用时关闭）与 `releaseOwner(ownerId: number): void`。不支持监听的 scheme 静默忽略。
  - 通道 `vfs.watch`（`{ uris: string[] }`，最多 500 个；owner 为 `ctx.senderId`）；事件 `vfs.changed: { uri: string }`（`MainEvents` 与 `IpcEvents`，bootstrap 广播）；bootstrap 在 `web-contents-created` 时为每个 webContents 注册 `destroyed → vfs.releaseOwner(id)`。

- [ ] **Step 1: 写失败的测试**：
  - VfsService（假 provider 记录 watch / close 调用）：两个 owner 监听同一 URI 只建立一次监听；一个 owner 释放后监听仍在、两个都释放后关闭；`setWatched(1, [b])` 替换 `[a]` 时关闭 a；同一 URI 300ms 内多次变化只回调一次（vitest fake timers）
  - LocalProvider（真实临时目录）：监听后新建文件，2 秒内收到回调；监听中删除该目录不抛出未捕获异常（Review Focus 3）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行确认通过**；全量检查
- [ ] **Step 5: 提交** `feat(main): watch expanded directories and broadcast vfs.changed`

### Task 4: 系统操作 IPC

**Files:**

- Create: `apps/desktop/src/main/vfs/local-path.ts`、`vfs/local-path.test.ts`
- Modify: `modules/system/system.ipc.ts`（扩展其 `HandlersOf` 通道列表；`ipc/handlers.ts` 已汇总 system handler，无需改动）、`packages/shared/src/ipc/contract.ts`

**Interfaces:**

- Produces:
  - `function fileUriToLocalPath(uri: string): string`：非 `file:` → `FS_UNSUPPORTED_SCHEME`；无法转换 → `FS_INVALID_URI`
  - 通道：`system.revealInOs`（`{ uri }` → `shell.showItemInFolder`）、`system.openPath`（`{ uri }` → `shell.openPath`，返回非空错误字符串时抛 `AppError('UNKNOWN', detail)`）、`system.copyText`（`{ text }`，≤ 32768 字符 → `clipboard.writeText`）、`system.selectPaths`（`{ kind: 'folder' | 'file', multiple: boolean }` → `string[]`，取消时为空数组；对话框父窗口为调用方窗口）
- 这些 API 都不修改文件。e2e 中不调用 `revealInOs` / `openPath` / `selectPaths`（会在需求方桌面上打开窗口）。

- [ ] **Step 1: 写失败的测试** `local-path.test.ts`：`file:///C:/%E6%A1%88%E4%BB%B6` → `C:\案件`；`file://server/share/x` → `\\server\share\x`；`ftp://h/x` → `FS_UNSUPPORTED_SCHEME`；`'nope'` → `FS_INVALID_URI`
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现 helper 与 4 个 handler**
- [ ] **Step 4: 运行确认通过**；全量检查
- [ ] **Step 5: 提交** `feat(main): add reveal, open, copy and select-paths system IPC`

### Task 5: 渲染端数据层与外壳插槽

**Files:**

- Create: `apps/desktop/src/renderer/src/data/workspace.ts`、`data/entries.ts`、`data/vfs.ts`、`data/vfs.test.ts`
- Modify: `lib/query-keys.ts`、`lib/query-client.ts`、`features/shell/shell.tsx`、`features/shell/components/{side-bar,title-bar,welcome}.tsx`、`app/app.tsx`

**Interfaces:**

- Produces:
  - query key：`workspaces: ['workspace', 'list']`、`activeWorkspace: ['workspace', 'active']`、`entries(id): ['entry', 'list', id]`、`directory(uri): ['vfs', 'list', uri]`
  - 事件桥接：`workspace.changed` → 使 `['workspace']` 与 `entries(id)` 失效；`vfs.changed` → 使 `directory(uri)` 失效
  - `data/workspace.ts`：`useWorkspaces()`、`useActiveWorkspace()`、`useWorkspaceActions(): { create, update, remove, activate }`（各为 `UseMutationResult`）、`workspaceDisplayName(w: Workspace, defaultName: string): string`（`name` 为空时用 `defaultName`）
  - `data/entries.ts`：`useEntries(workspaceId)`、`useEntryActions(): { add, update, remove, move }`
  - `data/vfs.ts`：`useDirectories(uris: string[]): Map<string, DirectoryState>`（`useQueries`，requestId 为 `dir:<uri>`，`refetchOnWindowFocus: true`，UNC 且轮询设置 > 0 时 `refetchInterval`）、`useWatchDirectories(uris: string[]): void`（集合变化 200ms 防抖后调用 `vfs.watch`，卸载时传空集合）、`isNetworkUri(uri: string): boolean`（`file:` 且有主机名）
  - `type DirectoryState = { status: 'loading' } | { status: 'error'; code: ErrorCode } | { status: 'ready'; items: FileEntry[] }`（定义在 `data/vfs.ts`，供 explorer 使用）
  - `Shell` 的 props：`{ sidebarViews: Record<SidebarView, ReactNode>; workspaceSwitcher: ReactNode }`；`app/app.tsx` 组合（本任务中 explorer 视图先用现有空状态占位，切换器先用只读显示当前工作区名称的占位）；欢迎页标题显示 `workspaceDisplayName(active, t('defaultWorkspace'))`

- [ ] **Step 1: 写失败的测试** `data/vfs.test.ts`：`isNetworkUri('file://server/share')` 为 true，`'file:///C:/x'` 为 false
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现数据层、事件桥接与外壳插槽**
- [ ] **Step 4: 运行确认通过**；全量检查 + `pnpm build && pnpm test:e2e`（既有 e2e 全部通过；e2e 中欢迎页标题的期望值不变：默认工作区显示「Default」）
- [ ] **Step 5: 提交** `feat(renderer): add workspace, entry and directory data hooks; slot-based shell`

### Task 6: 资源树（模型与虚拟化渲染）

**Files:**

- Create: `apps/desktop/src/renderer/src/features/explorer/{index.ts, tree-model.ts, tree-model.test.ts, explorer-store.ts, explorer-view.tsx, explorer-tree.tsx, tree-row.tsx}`
- Modify: `apps/desktop/package.json`（`@tanstack/react-virtual`）、`app/app.tsx`、三种语言 `explorer` 命名空间

**Interfaces:**

- Consumes: Task 5 的 `useEntries`、`useDirectories`、`useWatchDirectories`、`DirectoryState`；Task 2 的 `FileEntry.target`
- Produces:
  - `type NodeKind = 'group' | 'folder' | 'file' | 'directory' | 'link-directory' | 'link-file' | 'link-broken'`
  - `interface TreeNode { id: string; parentId: string | null; depth: number; label: string; kind: NodeKind; source: 'entry' | 'fs'; entryId: string; uri: string | null; expandable: boolean; expanded: boolean; status?: 'loading' | 'error' | 'empty'; errorCode?: ErrorCode }`
  - `buildVisibleNodes(input: { entries: WorkspaceEntry[]; expanded: ReadonlySet<string>; directories: ReadonlyMap<string, DirectoryState>; showHidden: boolean }): TreeNode[]`：节点 id 为 `entry:<entryId>` 与 `fs:<entryId>:<相对路径>`（相对路径各段用 `/` 连接）；条目按 `sortOrder`；真实子项目录优先、名称按 `Intl.Collator('ja', { numeric: true })` 排序；展开中的目录若在加载 / 出错 / 为空，产出一行 `status` 节点（id 为 `<父 id>#status`）
  - `requiredDirectoryUris(input同上): string[]`：所有已展开且可展开节点的 URI（去重），即需要列出与监听的目录
  - `useExplorerStore`：`expanded: Record<workspaceId, string[]>`、`selected: Record<workspaceId, string | null>`、`toggle(workspaceId, nodeId)`、`select(workspaceId, nodeId)`
  - `ExplorerView`：标题行（「资源管理器」+ 刷新按钮）、无条目时空状态（「添加文件夹」→ `system.selectPaths` 后 `entry.add`）、`ExplorerTree`
  - `ExplorerTree`：`role="tree"`；行 `role="treeitem"`、`aria-level`、`aria-expanded`、`aria-selected`；行高 28px（紧凑密度下随 `--spacing` 缩小）；键盘：↑↓ 移动选择、→ 展开 / 进入首个子项、← 折叠 / 回到父项、Enter 展开或折叠、F5 刷新；状态行显示加载 / 「找不到」/「无法访问」/「空」与「重试」

- [ ] **Step 1: 写失败的测试** `tree-model.test.ts`：
  - 分组嵌套分组、folder 展开后显示真实子项且目录优先、日文数字排序（`第2章` 在 `第10章` 前）
  - `showHidden: false` 时隐藏 `.` 开头的项
  - 链接：`target: 'directory'` → `link-directory` 且可展开；`target: null` → `link-broken` 不可展开
  - 展开中目录为 loading / error（`FS_UNAVAILABLE`）/ 空 → 一行对应 `status` 节点
  - 1 万项的目录：结果长度 = 10000 + 祖先行数，所有 id 唯一（Review Focus 2、4）
  - `requiredDirectoryUris` 只包含已展开的可展开节点，折叠后其子孙不再出现
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现模型、store 与组件**（先 `shadcn docs` 查组件用法；外观完成后用 `scripts/os-screenshot.mjs` 看整窗截图）
- [ ] **Step 4: 运行确认通过**；全量检查 + build + e2e
- [ ] **Step 5: 提交** `feat(explorer): virtualized workspace tree with lazy directory listing`

### Task 7: 拖放（只管理条目）

**Files:**

- Create: `features/explorer/drag-drop.ts`、`drag-drop.test.ts`
- Modify: `features/explorer/explorer-tree.tsx`、`tree-row.tsx`

**Interfaces:**

- Consumes: Task 6 的 `TreeNode`；Task 5 的 `useEntryActions`；preload 的 `window.pch.getPathForFile`
- Produces:
  - `type DragSource = { type: 'entry'; entryId: string } | { type: 'fs'; uri: string } | { type: 'os'; paths: string[] }`
  - `type DropPosition = 'before' | 'after' | 'inside'`
  - `type DropAction = { type: 'move'; entryId: string; parentId: string | null; index: number } | { type: 'add'; parentId: string | null; items: Array<{ path: string } | { uri: string }> }`
  - `resolveDrop(source: DragSource, target: TreeNode | null, position: DropPosition, nodes: TreeNode[]): DropAction | null`：`target === null` 表示树的空白处（= 根末尾）；目标为真实节点（`source: 'fs'`）→ `null`；`inside` 只允许分组；拖到自身或自己的后代 → `null`；`before` / `after` 换算为目标父节点下的 index（同父节点时考虑自身被移除后的位置）
  - 拖动时只设置自定义 MIME `application/x-pch-node`（JSON），不设置 `text/uri-list`、`DownloadURL`；落点高亮：上 25% 为 before、下 25% 为 after、中间且为分组时为 inside
- [ ] **Step 1: 写失败的测试** `drag-drop.test.ts`：条目拖到同级另一条目之前 / 之后的 index；拖进分组；拖到自身后代 → null；任意来源拖到真实节点上 → null（Review Focus 1）；真实子目录拖到根 → `add` 且 `items: [{ uri }]`；系统文件拖到分组内 → `add` 且 `items: [{ path }]`；拖到空白处 → 根末尾
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行确认通过**；全量检查
- [ ] **Step 5: 提交** `feat(explorer): drag and drop to manage entries without touching files`

### Task 8: 右键菜单与条目操作

**Files:**

- Create: `features/explorer/{node-context-menu.tsx, rename-dialog.tsx, remove-entry-dialog.tsx, new-group-dialog.tsx}`
- Modify: `packages/ui`（shadcn 添加 `context-menu`、`dialog`、`alert-dialog`、`input`、`field`、`spinner`）、`features/explorer/tree-row.tsx`、三种语言文案

**Interfaces:**

- Consumes: Task 4 的 `system.*`；Task 5 的 `useEntryActions`
- Produces（菜单项按节点类型显示）：
  - 分组：新建分组（子分组）、重命名、移除
  - folder / file 条目：在资源管理器中显示、用系统应用打开（file）、复制路径、复制 URI、重命名、移除
  - 真实子项：在资源管理器中显示、用系统应用打开（文件）、复制路径、复制 URI、固定到工作区根部（= `entry.add` with `uri`）
  - 树空白处：新建分组、添加文件夹…、添加文件…
  - 键盘：F2 重命名、Delete 移除（仅条目）
  - 移除确认文案明确「只移除条目，不会删除磁盘上的文件或文件夹」
- [ ] **Step 1: 写失败的测试**：本任务以 e2e 覆盖（Task 10），此处先写 e2e 用例：右键条目 → 重命名 → 新名称显示；右键条目 → 移除 → 确认 → 条目消失且磁盘文件仍存在；右键真实子目录 → 复制路径 → 主进程剪贴板内容等于该路径（`app.evaluate(({ clipboard }) => clipboard.readText())`）
- [ ] **Step 2: 运行确认失败**：`pnpm build && pnpm test:e2e -g "context menu"` → FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行确认通过**；全量检查 + build + e2e
- [ ] **Step 5: 提交** `feat(explorer): context menu actions for entries and folders`

### Task 9: 工作区切换器与管理

**Files:**

- Create: `apps/desktop/src/renderer/src/features/workspace/{index.ts, workspace-switcher.tsx, workspace-dialogs.tsx}`
- Modify: `app/app.tsx`、`features/shell/components/title-bar.tsx`（移除占位下拉菜单）、三种语言 `workspace` 命名空间

**Interfaces:**

- Consumes: Task 5 的 `useWorkspaces`、`useActiveWorkspace`、`useWorkspaceActions`、`workspaceDisplayName`
- Produces：标题栏按钮显示当前工作区名称；下拉菜单：工作区列表（当前项打勾，点击切换）、新建工作区…、重命名当前工作区…、恢复默认名称（仅默认工作区且已改名时）、删除当前工作区…（默认工作区不显示）；删除当前工作区后切回默认工作区
- [ ] **Step 1: 写失败的 e2e**：新建「案件A」→ 标题栏与欢迎页显示「案件A」；切回默认 → 显示「Default」；重命名默认为「共用」再恢复默认名称；删除「案件A」→ 回到默认工作区（Review Focus 5）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行确认通过**；全量检查 + build + e2e
- [ ] **Step 5: 提交** `feat(workspace): workspace switcher with create, rename and delete`

### Task 10: 资源树 e2e 与文档

**Files:**

- Modify: `e2e/app.spec.ts`（或拆出 `e2e/explorer.spec.ts`，共用 `launch` 时抽到 `e2e/support.ts`）
- Modify: `doc/`（5.3、7.1、8.2、8.3「已实现」标注）、`devDoc/2026-11-18-08-m1-2-explorer.md`、`knowledge/`（如有新坑）

- [ ] **Step 1: 写 e2e**（临时目录 `案件/設計書/仕様.xlsx` 等，经 IPC 添加 folder 条目后操作界面）：
  - 展开 folder → 显示真实子项；在磁盘上新建文件 → 无需手动刷新即出现（监听）；删除展开中的子目录 → 显示「找不到」状态行（Review Focus 3）
  - 键盘 ↓ / → / ← 导航与展开
  - 拖动条目排序；把真实子目录拖到根 → 新增固定条目；**拖放前后对临时目录做递归快照（路径 + 大小 + mtime）比较，完全一致**（Review Focus 1）
  - 一个指向不存在路径的 folder 条目（创建后删除目标目录）展开时显示错误行与「重试」（Review Focus 2）
- [ ] **Step 2: `pnpm build && pnpm test:e2e`** → 全部 PASS（对写完即通过的用例做一次临时篡改确认有效）
- [ ] **Step 3: 系统级截屏确认外观**（浅色 / 深色各一张整窗）
- [ ] **Step 4: 更新 doc / devDoc（含 Review Focus 结果）/ knowledge / devDoc README**
- [ ] **Step 5: 全量检查** 后提交 `docs: record M1-2 explorer`

**未自动化的验证（如实记录）：** 从系统资源管理器真实拖入文件——Playwright 无法产生带真实路径的系统拖放（`getPathForFile` 对合成的 File 返回空字符串）。由 `resolveDrop` 的单元测试覆盖逻辑，并在完成后请需求方实际拖入确认。
