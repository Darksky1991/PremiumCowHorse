# M1-1 数据层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主进程提供工作区与条目的持久化和业务规则、本地文件系统的读取（VFS + LocalProvider），并通过类型化 IPC 暴露给渲染端；本计划不含任何界面。

**Architecture:** 新增 `workspace` 主进程模块（repo → service → ipc）与 `vfs/` 层（`FileSystemProvider` 接口、`LocalProvider`、按 scheme 路由并支持取消 / 超时的 `VfsService`）。数据经 Kysely 迁移 `0002` 建表并写入默认工作区（id `default`）。变更通过主进程事件总线发出 `workspace.changed`，由 bootstrap 广播给渲染端。

**Tech Stack:** Electron 45（Node 24）、TypeScript、zod 4、Kysely + node:sqlite、vitest、Playwright（Electron）。

**Spec:** [`doc/PremiumCowHorse-架构设计方案.md`](../doc/PremiumCowHorse-架构设计方案.md) 第 2.3、5.2、6.3、6.6、7.1、7.2（LocalProvider）、8.1、13 节；项目约定见 [`CLAUDE.md`](../CLAUDE.md)。

## M1 拆分与已定决策（2026-11-18，需求方确认）

- M1 拆为三个子计划，每个完成后都是可运行、可测试的软件：**M1-1 数据层（本计划）**、M1-2 资源树、M1-3 标签与目录视图。M1-2 / M1-3 的计划在 M1-1 完成后基于实际接口编写。
- 标签状态在 M1 即由主进程 layoutReducer 持有（单窗口）；M1 实现最小插件体系；内置插件为单个 `plugins/builtin` 包；目录变更感知用 `fs.watch`；新依赖 `@tanstack/react-virtual`（M1-2 引入）。详见 doc v1.4。
- 本计划内的设计决定（实现者照此执行）：
  - 默认工作区 id 固定为 `default`，由迁移写入，`name` 为空字符串，界面显示本地化的默认名称（zh「默认」/ ja「デフォルト」/ en「Default」）；不可删除，可改名（改名后显示新名称）。
  - 「当前工作区」指用户当前正在使用的工作区（不是某个工作区的名称）：每次切换时记录 `last_opened_at`，取最大者，因此重启后回到上次使用的工作区；从未切换过时为 `default`。不新增设置项。
  - 添加 folder / file 条目的输入是 **本地路径**，由主进程用 `node:url` 的 `pathToFileURL` 转为 URI（不自写路径↔URI 转换）；M4 再扩展为接受远程 URI。
  - 条目的父节点只能是同一工作区的 `group` 或根（`null`）。删除 group 时连同所有后代一起删除。
  - 排序：新增条目追加到同级末尾；移动时在一个事务内重排目标同级的 `sort_order` 为 0..n-1。
  - Windows 的「隐藏」属性 Node 无 API 读取：M1 中 `hidden` 只判断以 `.` 开头的名称，读取系统隐藏属性留到引入 koffi 时（doc 3.6）。

## Global Constraints

- Node API 仅限 Electron 45 内置的 Node 24；不新增依赖。
- 分层由 `eslint.config.mjs` 强制：主进程 `ipc → modules → vfs / infra / core`，模块之间不互相 import。
- IPC：契约在 `packages/shared/src/ipc/contract.ts`，输入一律 zod 校验；`Handlers` 必须覆盖全部通道（漏写编译失败）。
- 错误码在 `packages/shared` 的 `ERROR_CODES`，每个错误码在 ja / zh-CN / en 的 `errors` 命名空间都有文案；主进程不拼接用户可见文案。
- 数据库：改表结构 = 新迁移文件（已发布的迁移不得修改）+ 更新 `infra/db/schema.ts`；时间戳为 UNIX 毫秒；JSON 列存 TEXT。
- ID 用 `crypto.randomUUID()`。
- 文件名 kebab-case；Prettier（单引号、无分号、行宽 100）。
- 每个任务结束时 `pnpm typecheck && pnpm lint && pnpm test` 全部通过。

## Review Focus

1. **含日文、空格、`#`、`%` 的路径**：添加为条目后 URI 可往返（`fileURLToPath(uri) === 原路径`），列出目录得到的子项 URI 能再次 `stat`。→ Task 4 测试。
2. **UNC 路径（`\\server\share\dir`）**：转换为 `file://server/share/dir` 并能被 LocalProvider 正确还原为 UNC。→ Task 4 测试（只测转换往返，不依赖真实共享）。
3. **目录中个别子项无法读取**（权限不足、列出过程中被删除、损坏的符号链接）：整个列表不能失败，只跳过或降级该项。→ Task 4 测试（用列出后立即删除的文件模拟）。
4. **把 group 移动到自己的后代下**：必须拒绝（`ENTRY_INVALID_PARENT`），数据不变。→ Task 3 测试。
5. **删除含多层子项的 group 与并发操作**：整棵子树在一个事务内删除；与此同时进行的其他写入不受影响（依赖 Kysely 的单连接互斥锁，已有并发测试的先例）。→ Task 3 测试。

---

### Task 1: 共享领域类型、输入 schema 与错误码

**Files:**

- Create: `packages/shared/src/workspace/types.ts`、`packages/shared/src/workspace/schema.ts`、`packages/shared/src/workspace/schema.test.ts`
- Create: `packages/shared/src/vfs/types.ts`
- Modify: `packages/shared/src/index.ts`（导出以上模块）、`packages/shared/src/errors/app-error.ts`（`ERROR_CODES`）
- Modify: `packages/i18n/src/locales/{ja,zh-CN,en}.ts`（`errors` 命名空间）

**Interfaces:**

- Produces（`packages/shared`）:
  - `DEFAULT_WORKSPACE_ID = 'default'`
  - `interface Workspace { id: string; name: string; description: string | null; color: string | null; sortOrder: number; archived: boolean; lastOpenedAt: number | null; createdAt: number; updatedAt: number }`
  - `type EntryKind = 'group' | 'folder' | 'file'`；`interface EntryMeta { note?: string; icon?: string; color?: string }`
  - `interface WorkspaceEntry { id: string; workspaceId: string; parentId: string | null; kind: EntryKind; label: string; uri: string | null; sortOrder: number; meta: EntryMeta | null; createdAt: number; updatedAt: number }`
  - zod：`WorkspaceCreateInput`（`name` trim 后 1–100 字符、`description?` ≤500、`color?` ≤32）、`WorkspaceUpdateInput`（`id` + 上述可选字段，`description` / `color` 可为 `null`）、`EntryAddInput`（按 `kind` 区分：`group` → `{ workspaceId, parentId: string | null, label }`；`folder` / `file` → `{ workspaceId, parentId, path: string, label?: string }`）、`EntryUpdateInput`（`{ id, label?, meta? }`）、`EntryMoveInput`（`{ id, parentId: string | null, index: int ≥ 0 }`）。全部 `strictObject`，`label` trim 后 1–200 字符。
  - `type FileKind = 'file' | 'directory' | 'symlink'`；`interface FileStat { uri: string; name: string; kind: FileKind; size: number; mtime: number }`；`interface FileEntry extends FileStat { hidden: boolean }`
  - 新错误码：`WORKSPACE_NOT_FOUND`、`WORKSPACE_DEFAULT_PROTECTED`、`ENTRY_NOT_FOUND`、`ENTRY_INVALID_PARENT`、`ENTRY_KIND_MISMATCH`、`FS_NOT_FOUND`、`FS_PERMISSION_DENIED`、`FS_NOT_A_DIRECTORY`、`FS_INVALID_URI`、`FS_UNSUPPORTED_SCHEME`、`FS_CANCELLED`、`FS_TIMEOUT`

- [ ] **Step 1: 写失败的测试 `schema.test.ts`**：`WorkspaceCreateInput` 拒绝空白名称（`'   '`）与 101 字符名称、接受 `'案件A'`；`EntryAddInput` 拒绝 `kind: 'folder'` 缺 `path`、拒绝 `kind: 'group'` 带 `path`、拒绝未知键；`EntryMoveInput` 拒绝 `index: -1`。
- [ ] **Step 2: 运行确认失败**：`pnpm vitest run packages/shared/src/workspace` → FAIL（模块不存在）
- [ ] **Step 3: 实现类型与 schema，追加错误码与三种语言的文案**（i18n 的类型以 ja 为基准，三份必须同时补齐）
- [ ] **Step 4: 运行确认通过**：`pnpm vitest run` → 全部 PASS（含 `resources.test.ts` 的键一致性）；`pnpm typecheck` 通过
- [ ] **Step 5: 提交** `feat(shared): add workspace, entry and vfs domain types`

### Task 2: 迁移 0002 与仓储（repo）

**Files:**

- Create: `apps/desktop/src/main/infra/db/migrations/0002-workspaces.ts`；Modify: `migrations/index.ts`、`infra/db/schema.ts`
- Create: `apps/desktop/src/main/modules/workspace/workspace.repo.ts`、`entry.repo.ts`、`workspace.repo.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `Workspace`、`WorkspaceEntry`、`DEFAULT_WORKSPACE_ID`；`openDatabase(':memory:', logger)`
- Produces:
  - 表 `workspaces`、`workspace_entries` 与索引 `idx_entries_ws_parent`，结构照 doc 第 13 节；迁移同时插入 `{ id: 'default', name: '', sort_order: 0, archived: 0, created_at/updated_at: 迁移执行时刻 }`
  - `class WorkspaceRepo { list(): Promise<Workspace[]>（按 sort_order, created_at）; get(id): Promise<Workspace | undefined>; insert(w: Workspace): Promise<void>; update(id, patch: Partial<Pick<Workspace, 'name' | 'description' | 'color' | 'archived' | 'lastOpenedAt'>>): Promise<void>; delete(id): Promise<void> }`
  - `class EntryRepo { listByWorkspace(workspaceId): Promise<WorkspaceEntry[]>（按 parent_id, sort_order）; get(id); insert(e: WorkspaceEntry); update(id, patch: Partial<Pick<WorkspaceEntry, 'label' | 'meta' | 'parentId' | 'sortOrder'>>); deleteMany(ids: string[]); maxSortOrder(workspaceId, parentId: string | null): Promise<number>（无同级时 -1） }`
  - 两个 repo 的构造参数为 `Database`（即 `Kysely<DB>`；Kysely 的事务对象也是 `Kysely<DB>`，所以同一套 repo 可在事务内使用）；行 ↔ 领域对象的转换（snake_case、boolean、JSON）只在 repo 内。

- [ ] **Step 1: 写失败的测试**：新库只有一个工作区 `default`；`EntryRepo` 插入带 `meta: { note: '設計書' }` 的条目后原样读回；`maxSortOrder` 在无同级时为 `-1`；删除工作区后其条目被级联删除（验证 `foreign_keys = ON` 生效）。
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现迁移、schema 类型与两个 repo**
- [ ] **Step 4: 运行确认通过**（`client.test.ts` 的既有测试也须继续通过）
- [ ] **Step 5: 提交** `feat(main): add workspaces migration and repositories`

### Task 3: WorkspaceService 业务规则、IPC 与事件

**Files:**

- Create: `apps/desktop/src/main/modules/workspace/workspace.service.ts`、`workspace.service.test.ts`、`workspace.ipc.ts`
- Modify: `packages/shared/src/ipc/contract.ts`（通道与事件）、`apps/desktop/src/main/core/events.ts`、`ipc/handlers.ts`、`bootstrap/container.ts`、`bootstrap/bootstrap.ts`（`wireEvents` 广播）

**Interfaces:**

- Consumes: Task 2 的 repo；`EventBus<MainEvents>`；`Database.transaction()`
- Produces:
  - `MainEvents` / `IpcEvents` 新增 `'workspace.changed': { id: string }`（条目变化也用它，`id` 为工作区 id）
  - `class WorkspaceService { constructor(db: Database, bus: EventBus<MainEvents>); list(): Promise<Workspace[]>; create(input: WorkspaceCreateInput): Promise<Workspace>; update(input: WorkspaceUpdateInput): Promise<Workspace>; delete(id): Promise<void>; activate(id): Promise<void>（写 last_opened_at）; active(): Promise<Workspace>（last_opened_at 最大者，全为 null 时为 default）; listEntries(workspaceId): Promise<WorkspaceEntry[]>; addEntry(input: EntryAddInput): Promise<WorkspaceEntry>; updateEntry(input: EntryUpdateInput): Promise<WorkspaceEntry>; removeEntry(id): Promise<void>; moveEntry(input: EntryMoveInput): Promise<void> }`（repo 在 service 内部由 `db` / 事务构造）
  - 通道：`workspace.list`、`workspace.active`、`workspace.create`、`workspace.update`、`workspace.delete`（`{ id }`）、`workspace.activate`（`{ id }`）、`entry.list`（`{ workspaceId }`）、`entry.add`、`entry.update`、`entry.remove`（`{ id }`）、`entry.move`
  - `addEntry` 对 folder / file：`pathToFileURL(path).href` 作为 uri，`label` 缺省为路径的最后一段；本任务**不** stat 路径是否存在（Task 5 接入 VFS 后再校验，见 Task 5 Step 3）

- [ ] **Step 1: 写失败的测试**（`:memory:` 库 + 真实迁移，参照 `settings.service.test.ts`）：
  - 删除 `default` → `AppError` `WORKSPACE_DEFAULT_PROTECTED`；改名 `default` 成功
  - `active()` 初始为 `default`；`activate(b)` 后为 `b`
  - group 下添加 folder；向 `file` 条目下添加 → `ENTRY_INVALID_PARENT`；父节点属于其他工作区 → `ENTRY_INVALID_PARENT`
  - 移动 group A 到其子 group B 之下 → `ENTRY_INVALID_PARENT`，所有条目的 `parentId` / `sortOrder` 不变（Review Focus 4）
  - 同级 [x, y, z] 中把 z 移到 index 0 → 顺序 [z, x, y]，`sortOrder` 为 0,1,2
  - 删除含两层后代的 group → 子树全部删除，同工作区的其他条目保留；同时发起的另一工作区的 `addEntry` 成功（Review Focus 5）
  - 每次写操作恰好发出一次 `workspace.changed`，`id` 正确
  - `addEntry({ kind: 'folder', path: 'C:\\案件 A\\設計書#1' })` 的 `uri` 满足 `fileURLToPath(uri) === 原路径`，`label === '設計書#1'`（Review Focus 1）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现 service**（移动与删除子树在 `db.transaction()` 内完成；环检测沿目标父节点向上遍历）
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 加契约通道、handler（参数已校验，只转发）、容器装配与事件广播**；`pnpm typecheck && pnpm lint && pnpm test` 通过
- [ ] **Step 6: 提交** `feat(main): add workspace service with entry rules and IPC`

### Task 4: VFS 接口与 LocalProvider

**Files:**

- Create: `apps/desktop/src/main/vfs/types.ts`、`vfs/errors.ts`、`vfs/providers/local.provider.ts`、`vfs/providers/local.provider.test.ts`
- Modify: `eslint.config.mjs`（新增元素 `main-vfs` = `${MAIN}/vfs`；放行 `main-vfs → main-core, main-infra, shared`、`main-module → main-vfs`、`main-ipc → main-vfs`、`main-bootstrap → main-vfs`）

**Interfaces:**

- Consumes: Task 1 的 `FileStat`、`FileEntry`、错误码
- Produces:
  - `interface FileSystemProvider { readonly scheme: 'file'; stat(uri: URL, signal?: AbortSignal): Promise<FileStat>; list(uri: URL, signal?: AbortSignal): Promise<FileEntry[]>; dispose(): Promise<void> }`（doc 7.1 的子集；`createReadStream` / `watch` 分别在 M2 / M1-2 增加）
  - `function toAppError(e: unknown): AppError`：`ENOENT → FS_NOT_FOUND`、`EACCES / EPERM → FS_PERMISSION_DENIED`、`ENOTDIR → FS_NOT_A_DIRECTORY`、`AbortError → FS_CANCELLED`，其他 → `UNKNOWN`（`detail` 保留原始 code 与消息）
  - `class LocalProvider implements FileSystemProvider`：用 `fileURLToPath` 还原路径（支持 UNC）；`list` 用 `readdir(dir, { withFileTypes: true })` 后对每项 `lstat`（符号链接报告为 `symlink`，不跟随），**单项失败时跳过该项**而不是让整个列表失败；子项 URI 用 `pathToFileURL`；`hidden = name.startsWith('.')`

- [ ] **Step 1: 写失败的测试**（`mkdtempSync` 临时目录，`afterEach` 删除）：
  - 含 `案件 A/設計書#1.xlsx`、`.hidden`、子目录的目录 → 3 项，`kind` / `hidden` / `size` 正确；每个子项的 URI 再 `stat` 成功（Review Focus 1）
  - 不存在的路径 → `FS_NOT_FOUND`；对文件调用 `list` → `FS_NOT_A_DIRECTORY`
  - 已中止的 `AbortSignal` → `FS_CANCELLED`
  - `fileURLToPath(pathToFileURL('\\\\server\\share\\dir').href) === '\\\\server\\share\\dir'`（Review Focus 2，只验证转换，不访问网络）
  - 用 `vi.spyOn` 让某一项的 `lstat` 抛 `ENOENT`（模拟列出后被删除）→ 列表不失败，只少该项（Review Focus 3）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行确认通过**；`pnpm lint` 通过（新 `vfs/` 已登记）
- [ ] **Step 5: 提交** `feat(main): add VFS provider interface and LocalProvider`

### Task 5: VfsService（路由、取消、超时）、IPC 与条目路径校验

**Files:**

- Create: `apps/desktop/src/main/vfs/vfs.service.ts`、`vfs.service.test.ts`、`vfs/vfs.ipc.ts`
- Modify: `packages/shared/src/ipc/contract.ts`、`ipc/handlers.ts`、`bootstrap/container.ts`、`modules/workspace/workspace.service.ts`（构造参数增加 `vfs`）

**Interfaces:**

- Consumes: Task 4 的 `FileSystemProvider`、`LocalProvider`、`toAppError`
- Produces:
  - `class VfsService { constructor(providers: FileSystemProvider[], opts?: { timeoutMs?: number }); stat(uri: string, requestId?: string): Promise<FileStat>; list(uri: string, requestId?: string): Promise<FileEntry[]>; cancel(requestId: string): void; dispose(): Promise<void> }`
    - URI 无法解析 → `FS_INVALID_URI`；没有对应 scheme 的 provider → `FS_UNSUPPORTED_SCHEME`
    - 每次调用一个 `AbortController`，按 `requestId` 登记，结束时注销；`cancel` 触发 → `FS_CANCELLED`；超时（默认 `timeoutMs = 30_000`）→ `FS_TIMEOUT`
  - 通道：`vfs.stat`（`{ uri }`）、`vfs.list`（`{ uri, requestId }`）、`vfs.cancel`（`{ requestId }`）
  - `WorkspaceService` 的最终构造签名：`constructor(db: Database, vfs: VfsService, bus: EventBus<MainEvents>)`
  - `WorkspaceService.addEntry` 对 folder / file 先 `vfs.stat`：不存在 → `FS_NOT_FOUND`；`kind: 'folder'` 但目标不是目录、或 `kind: 'file'` 但目标是目录 → `ENTRY_KIND_MISMATCH`

- [ ] **Step 1: 写失败的测试**：未知 scheme（`ftp://x/y`）→ `FS_UNSUPPORTED_SCHEME`；非法 URI（`'not a uri'`）→ `FS_INVALID_URI`；用一个在 `list` 中等待 signal 的假 provider：`cancel(requestId)` → `FS_CANCELLED`，`timeoutMs: 50` → `FS_TIMEOUT`，结束后内部登记表为空；`addEntry` 指向不存在的路径 → `FS_NOT_FOUND`；`kind: 'folder'` 指向文件 → `ENTRY_KIND_MISMATCH`
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现 VfsService、IPC 与 addEntry 校验**（`workspace.service.test.ts` 改为注入真实 `VfsService([new LocalProvider()])` 与临时目录）
- [ ] **Step 4: 运行确认通过**；`pnpm typecheck && pnpm lint && pnpm test`
- [ ] **Step 5: 提交** `feat(main): add VfsService with cancellation and timeout`

### Task 6: 端到端验证与文档

**Files:**

- Modify: `e2e/app.spec.ts`
- Modify: `doc/PremiumCowHorse-架构设计方案.md`（6.3「M0 已实现」通道清单改为「已实现」并补充；6.6 错误码；5.2「已实现」目录加 `vfs/`、`modules/workspace`；13 节标注 workspaces / workspace_entries 已实现）
- Create: `devDoc/2026-11-18-06-m1-1-data-layer.md`（或实际完成日期）；必要时追加 `knowledge/` 条目

- [ ] **Step 1: 写 e2e**（经 `window.pch.invoke`，独立 userData）：`workspace.list` 只有 `default`；`workspace.create({ name: '案件A' })` → `workspace.activate` → `workspace.active` 为案件A；在临时目录建 `設計書/仕様.xlsx` 后 `entry.add({ kind: 'folder', path })` → `entry.list` 含该条目；`vfs.list({ uri: entry.uri, requestId })` 返回 `仕様.xlsx`；`entry.add` 不存在的路径 → `{ ok: false, error: { code: 'FS_NOT_FOUND' } }`；重启应用后工作区与条目仍在
- [ ] **Step 2: `pnpm build && pnpm test:e2e`** → 全部 PASS
- [ ] **Step 3: 更新 doc / devDoc（含 Review Focus 各项的验证结果）/ knowledge**
- [ ] **Step 4: 全量检查** `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e`
- [ ] **Step 5: 提交** `docs: record M1-1 data layer`
