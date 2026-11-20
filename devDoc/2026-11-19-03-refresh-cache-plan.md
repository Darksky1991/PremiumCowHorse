# 目录刷新与缓存引擎 + 文件名搜索：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉 `fs.watch`，改为在独立扫描进程中按级别 / 优先级扫描并缓存到 SQLite 的目录刷新引擎，并在其索引之上提供文件名搜索视图。

**Architecture:** Electron `utilityProcess` 中的扫描进程（`apps/desktop/src/scanner/`）持有 koffi 目录枚举、调度器与 `userData/cache/index.db`；主进程的 `ScannerClient` 经 MessagePort 与之通信并转发 IPC；渲染端先显示缓存、收到 `vfs.changed` 再更新，并通过 `vfs.interest` 告知关注点与可见目录。

**Tech Stack:** Electron 45、electron-vite 6（`?modulePath`）、`node:sqlite`（FTS5 trigram）、koffi 3.3.8、zod 4、React 19 + TanStack Query / react-virtual、Vitest、Playwright。

**Spec:** [`devDoc/2026-11-19-01-refresh-cache-design.md`](./2026-11-19-01-refresh-cache-design.md)（引擎，第 7 节为待确认的控制者决定）与 [`devDoc/2026-11-19-02-search-design.md`](./2026-11-19-02-search-design.md)（搜索）。现状依据：[`doc/`](../doc/PremiumCowHorse-架构设计方案.md) v1.8。

## Global Constraints

- 应用本身不得对文件系统产生任何影响：不写、不建、不删、不长期持有目录句柄；枚举句柄用完立即关闭，打开时共享模式为 `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`。
- 不使用 `fs.watch`；删除 `vfs.watch`、`VFS_WATCH_MAX`、`system.openPath` 与全部监听代码。
- koffi 固定 `3.3.8`，在 `pnpm-workspace.yaml` 的 `allowBuilds` 中声明；不绕过 TVM。
- 扫描进程不得 import `electron`；主进程与扫描进程之间的消息、IPC 输入都用 zod 校验；IPC 仍只有 `pch:invoke` / `pch:event`。
- 新目录先在 `eslint.config.mjs` 登记元素与依赖方向（`scanner` 只允许 `shared` 与 `main-vfs` 中不依赖 electron 的模块）。
- 缓存库 `userData/cache/index.db` 与 `pch.db` 分开；用 `PRAGMA user_version` 标记结构版本，版本不符时删除重建（缓存可丢弃，不写迁移）。`pch.db` 的结构变化用新迁移 `0003`。
- 设置键与默认值（`packages/shared/src/settings/schema.ts`）：`refresh.defaultLevel.local` = `active`，`refresh.defaultLevel.network` = `default`，`refresh.activeDepth` = 3（1–10），`refresh.intervalSec.local` = 5（≥2），`refresh.intervalSec.network` = 30（≥10），`refresh.backgroundIntervalMin` = 10（≥1），`vfs.timeoutSec.local` = 5（1–60），`vfs.timeoutSec.network` = 10（10–120）；删除 `remote.pollIntervalSec`。
- 级别：`passive`（消极）/ `default`（默认）/ `active`（积极）/ `all`（全部）。界面文案 ja / zh-CN / en 三语同时添加。
- 超时按「没有进展的时间」计；「断开」只由探测（目录属性查询或枚举的第一批结果）判定；断开单位为共享 `\\主机\共享`（本地为卷）；退避 30 秒 → 1 分 → 2 分 → … 最长 5 分钟。
- 隐藏：有 `FILE_ATTRIBUTE_HIDDEN` 即隐藏；只有 SYSTEM 的照常显示；不再按 `.` 开头判断（koffi 不可用的回退模式除外）。
- 文档：每个任务若改变了结构，同一提交中更新 `doc/`（最终在 Task 10 / Task 12 统一升版本号与摘要）；非显而易见的问题追加到 `knowledge/`。
- 提交信息 Conventional Commits（英文），末尾 `Co-Authored-By` 行用实际模型。

## Review Focus

1. 根条目是整个驱动器（`C:\`）或巨大的 NAS 共享且级别为「全部」：界面不卡、扫描进程内存有界（队列只保存待扫描的前沿，不一次性展开整棵树）。→ Task 4 测试 `all level keeps the queue bounded by the frontier`。
2. 名称含 `#`、`%`、空格、日文，以及路径超过 260 字符：枚举、URI 往返、缓存键一致。→ Task 1 测试 `enumerates names with # % spaces and Japanese` 与 `enumerates a directory whose path exceeds 260 characters`。
3. 同一目录同时落在两个根条目（重叠的根、两个工作区）之下：缓存只有一份，范围取较高的级别，清理不误删。→ Task 2 测试 `prune keeps directories still under another root`、Task 4 测试 `overlapping roots use the higher level`。
4. 扫描进程在请求进行中崩溃：进行中的 `vfs.list` 以错误结束而不是永远加载，进程被重启后树恢复。→ Task 5 测试 `pending requests reject when the scanner exits and the client restarts it`。
5. 条目被移除 / 切换工作区时仍在进行的扫描：结果不得让已清理的缓存行复活。→ Task 2 测试 `applyListing ignores directories outside the configured roots`。

---

### Task 1: koffi 目录枚举器（含访问时间保护）

**Files:**

- Create: `apps/desktop/src/scanner/enum/types.ts`、`win32-enumerator.ts`、`fs-enumerator.ts`、`create-enumerator.ts`
- Test: `apps/desktop/src/scanner/enum/win32-enumerator.test.ts`、`fs-enumerator.test.ts`
- Modify: `apps/desktop/package.json`（依赖 `koffi@3.3.8`）、`pnpm-workspace.yaml`（`allowBuilds: koffi: true`）、`eslint.config.mjs`（元素 `scanner`）、`apps/desktop/electron-builder.yml`（koffi 的 `.node` 需要 asarUnpack 时）

**Interfaces:**

- Produces:
  ```ts
  export interface RawEntry {
    name: string
    kind: 'file' | 'directory' | 'symlink'
    target?: 'file' | 'directory' | null
    size: number
    mtime: number
    hidden: boolean
  }
  export interface Enumerator {
    readonly native: boolean // koffi 可用
    statDir(uri: string, signal: AbortSignal): Promise<{ mtime: number }>
    list(uri: string, opts: { signal: AbortSignal; onBatch: () => void }): Promise<RawEntry[]>
    location(uri: string): 'local' | 'network' // UNC 或 GetDriveTypeW === DRIVE_REMOTE
    shareKey(uri: string): string // '\\\\host\\share'（小写）或 'C:'
    hostKey(uri: string): string // 'host'（小写）或 'local'
  }
  export function createEnumerator(log: (msg: string) => void): Enumerator // koffi 失败时返回 fs 回退
  ```
- Consumes: `apps/desktop/src/main/vfs/local-path.ts` 的 `fileUriToLocalPath`、`vfs/errors.ts` 的 `toAppError`（允许 scanner import 这两个文件）。

步骤：

- [ ] **Step 1: 安装 koffi 并确认 API。** `pnpm --filter desktop add koffi@3.3.8`，在 `allowBuilds` 中加 `koffi: true`。读 `node_modules/koffi` 的类型定义 / README，确认：加载 `kernel32.dll`、声明结构体、异步调用（文档中的 `.async` 或等价 API）、宽字符字符串的写法。把确认结果（含版本、是否有下载行为）写进本任务报告。**未读类型定义不得写调用代码**。
- [ ] **Step 2: 写失败的测试**（`win32-enumerator.test.ts`，`describe.runIf(process.platform === 'win32')`，在 `os.tmpdir()` 下建临时目录）：
  - `lists names, kinds, sizes and mtimes`：文件 `a.txt`（3 字节）、目录 `sub` → 两项，`size` 与 `fs.statSync` 一致，`mtime` 与 `fs.statSync(...).mtimeMs` 相差 < 1ms 级（按 100ns 换算取整）。
  - `marks HIDDEN as hidden and SYSTEM-only as visible`：`attrib +h h.txt`、`attrib +s s.txt`、`attrib +h +s hs.txt` → `h`、`hs` 为 hidden，`s` 不是。
  - `reports junctions and symlinks as symlink with a target`：`mklink /J j <dir>` → `{ kind: 'symlink', target: 'directory' }`；指向已删除目录的联接 → `target: null`。
  - `enumerates names with # % spaces and Japanese`：`設計 #1 100%` 等名称原样返回。
  - `enumerates a directory whose path exceeds 260 characters`。
  - `does not update the directory's last access time`：`fs.utimesSync(dir, 3 小时前, 3 小时前)` → `list(dir)` → `fs.statSync(dir).atimeMs` 不变。（控制者已实测：普通 `readdir` 会把它更新为当前时间。）
  - `statDir returns the directory mtime and does not change atime`。
  - `calls onBatch at least once and honours an aborted signal`（已中止的 signal → 以 `FS_CANCELLED` 拒绝）。
  - `fs-enumerator.test.ts`：同样的名称 / 类型 / 大小用例；hidden 按 `.` 开头。
- [ ] **Step 3: 运行，确认失败**：`pnpm --filter desktop exec vitest run src/scanner/enum` → 模块不存在。
- [ ] **Step 4: 实现 `win32-enumerator.ts`。** 打开目录：`CreateFileW(\\?\ 前缀路径, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES, 读写删共享, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS)`；拒绝访问时去掉 `FILE_WRITE_ATTRIBUTES` 重试（此时不保护访问时间，记一次日志）。拿到写属性权限时用 `SetFileInformationByHandle(FileBasicInfo)` 把 `LastAccessTime` 设为 -1、其他时间为 0（不修改）。枚举：`GetFileInformationByHandleEx` 的 `FileFullDirectoryRestartInfo` / `FileFullDirectoryInfo`，64KB 缓冲，每批解析后调用 `onBatch`，批与批之间检查 signal；跳过 `.` / `..`；最后 `CloseHandle`（`finally`）。重解析点：`FILE_ATTRIBUTE_REPARSE_POINT` → `symlink`，目标类型用 `fs.promises.stat` 判断（失败 → `null`）。`statDir` 用 `GetFileAttributesExW`。`location` / `shareKey` 中盘符用 `GetDriveTypeW`（按盘符缓存）。UNC 解析用 `fileUriToLocalPath`。Win32 错误码映射为 `FS_NOT_FOUND`（2、3）/ `FS_PERMISSION_DENIED`（5）/ `FS_NOT_A_DIRECTORY`（267）/ `FS_UNAVAILABLE`（53、64、67、1231 等网络类，其余未知也归此类并带 detail）。
- [ ] **Step 5: 实现 `fs-enumerator.ts`**（移植现有 `LocalProvider.list` 的 readdir + 16 并发 lstat 逻辑与链接目标判断）与 `create-enumerator.ts`（koffi 加载失败或非 win32 → fs 回退并 `log`）。
- [ ] **Step 6: 运行，确认通过**：同 Step 3 的命令 → 全部 PASS。若 `does not update the directory's last access time` 在正确实现后仍失败（-1 不生效），把该用例改为断言「回退并记录日志」，在报告中以 DONE_WITH_CONCERNS 说明，并在 `knowledge/windows-and-tooling.md` 记录。
- [ ] **Step 7: 全量检查并提交**：`pnpm typecheck && pnpm lint && pnpm test` → 通过；`git commit -m "feat(scanner): enumerate directories natively without touching last access times"`。

### Task 2: 缓存库 `index.db`

**Files:**

- Create: `apps/desktop/src/scanner/cache/cache.ts`、`cache-schema.ts`
- Test: `apps/desktop/src/scanner/cache/cache.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `RawEntry`。
- Produces:
  ```ts
  export type DirState = 'ok' | 'not-found' | 'denied' | 'unreachable'
  export interface DirRow {
    uri: string
    parentUri: string | null
    dirMtime: number | null
    listedAt: number | null
    checkedAt: number | null
    state: DirState
    errorCode: string | null
    visitScore: number
  }
  export class Cache {
    static open(file: string | ':memory:'): Cache // user_version 不符 → 删表重建
    setRoots(rootUris: string[]): void // 当前配置的所有根（所有工作区）
    getDir(uri: string): DirRow | undefined
    getEntries(uri: string): RawEntry[]
    childDirs(uri: string): string[] // 缓存中的子目录 URI
    applyListing(
      uri: string,
      dirMtime: number,
      entries: RawEntry[],
      now: number
    ): { changed: boolean }
    markChecked(uri: string, now: number): void
    setState(
      uri: string,
      state: DirState,
      errorCode: string | null,
      now: number
    ): { changed: boolean }
    removeSubtree(uri: string): void
    prune(): number // 删除不在任何根之下的目录，返回删除数
    visit(uri: string, now: number): void // 热点计分（半衰期 3 天：score = score·0.5^(Δt/3d) + 1）
    hot(k: number): string[]
    sizeBytes(): number
    clear(): void
    close(): void
  }
  ```
- `changed` 的含义：名称集合或任一项的 kind / target / size / mtime / hidden 有差异，或首次写入。子目录的 `dirs` 行在父目录列出时以 `parentUri` 建立（`listedAt` 为 null）。URI 规范：目录 URI 不带结尾 `/`，子项 URI = 父 URI + `/` + `encodeURIComponent(name)`（与现有 `LocalProvider` 生成方式一致，先读它确认）。
- 表结构以设计第 4.3 节为准；`entries_fts` 用 external content + 触发器同步（`INSERT` / `DELETE` / `UPDATE`），`entries` 需要整数 rowid（不要 `WITHOUT ROWID`）。

步骤：

- [ ] **Step 1: 写失败的测试**（`:memory:`）：
  - `applyListing reports changed on first write and when an entry differs, not when identical`
  - `applyListing creates child dir rows and removes rows of vanished child dirs (subtree)`
  - `applyListing ignores directories outside the configured roots`（Review Focus 5）
  - `prune keeps directories still under another root`（Review Focus 3：两个根 `file:///C:/a`、`file:///C:/a/b`，移除前者后 `b` 子树保留）
  - `prune does not treat a sibling with a shared prefix as inside the root`（`file:///C:/ab` 不在 `file:///C:/a` 之下）
  - `visit decays scores with a three day half-life and hot returns the top k`
  - `entries_fts finds 第10章 in 設計書_第10章.xlsx after applyListing and forgets it after removal`
  - `open rebuilds the database when user_version differs`（临时文件）
- [ ] **Step 2: 运行确认失败**：`pnpm --filter desktop exec vitest run src/scanner/cache`。
- [ ] **Step 3: 实现**，批量写入用单个事务。
- [ ] **Step 4: 运行确认通过**；`pnpm typecheck && pnpm lint && pnpm test`。
- [ ] **Step 5: 提交** `feat(scanner): cache directory listings in a disposable index database`。

### Task 3: 范围计算（纯函数）

**Files:**

- Create: `apps/desktop/src/scanner/schedule/scope.ts`
- Test: `apps/desktop/src/scanner/schedule/scope.test.ts`

**Interfaces:**

- Consumes: `Cache.childDirs`（以函数参数注入：`children: (uri: string) => string[]`）。
- Produces:
  ```ts
  export type Tier = 'P1' | 'P2'
  // RootConfig 与 RefreshLevel 定义在 packages/shared/src/scanner/types.ts（扫描进程与主进程共用；本任务创建该文件并从 shared 的 index 导出）
  export interface RootConfig {
    entryId: string
    workspaceId: string
    uri: string
    level: RefreshLevel
    location: 'local' | 'network'
  }
  export interface ScopeInput {
    roots: RootConfig[]
    focus: string | null
    visible: string[]
    offscreen: string[]
    hot: string[]
    indexTargets: string[]
    activeDepth: number
    children: (uri: string) => string[]
  }
  export interface ScopeItem {
    uri: string
    tier: Tier
    full: boolean
  } // full=每次完整枚举；false=先比较目录修改时间
  export function computeScope(input: ScopeInput): { items: ScopeItem[]; frontier: string[] }
  ```
  `frontier` = 需要后台（P2）逐步展开的子树起点（「全部」级别的根、建立索引的目录、积极级别范围的边界），由调度器按需从缓存逐层展开，`computeScope` 不递归遍历整棵树。
- 规则（设计 4.5 / 4.6）：关注点目录 `full: true`、P1；默认：祖先链（至根）、子目录、兄弟目录 → P1、`full: false`；积极：在默认之上，关注点向上 N 级的祖先 A，A 之下深度 ≤ depth(focus)+N 的目录 → P2（通过 frontier + 深度上限表达）；全部：根 → frontier；所有根目录、热点目录（及其子目录）→ P1 `full: false`；`visible` → P1 `full: true`；`offscreen` → P1 `full: false`；建立索引的目录 → frontier（P2）。同一 URI 取更高的层级与 `full`。关注点所在根决定级别；关注点为 null 时只有根、可见、热点、索引与「全部」。

步骤：

- [ ] **Step 1: 写失败的测试**：`passive includes only the focus`、`default adds ancestors children and siblings`、`active reaches uncles and nephews within N levels`（N=1 与 N=3 各一例，断言具体 URI 集合）、`all puts the root on the frontier`、`overlapping roots use the higher level`（Review Focus 3）、`visible beats offscreen and duplicates keep the strongest tier`、`index targets go to the frontier`、`focus outside every root yields no focus items`。
- [ ] **Step 2–4:** 运行失败 → 实现 → 运行通过（`vitest run src/scanner/schedule/scope`）；全量检查。
- [ ] **Step 5: 提交** `feat(scanner): compute scan scope from level focus and visibility`。

### Task 4: 调度器

**Files:**

- Create: `apps/desktop/src/scanner/schedule/scheduler.ts`、`backoff.ts`
- Test: `apps/desktop/src/scanner/schedule/scheduler.test.ts`

**Interfaces:**

- Consumes: Task 1 `Enumerator`、Task 2 `Cache`、Task 3 `computeScope` / `RootConfig`。
- Produces:
  ```ts
  // ScanSettings 同样放在 packages/shared/src/scanner/types.ts
  export interface ScanSettings {
    intervalSec: { local: number; network: number }
    backgroundIntervalMin: number
    timeoutSec: { local: number; network: number }
    activeDepth: number
  }
  export interface SchedulerEvents {
    changed(uri: string): void
    reachability(share: string, state: 'online' | 'offline', since: number): void
  }
  export class Scheduler {
    constructor(deps: {
      enumerator: Enumerator
      cache: Cache
      events: SchedulerEvents
      now?: () => number
      setTimer?: typeof setTimeout
      clearTimer?: typeof clearTimeout
    })
    configure(roots: RootConfig[], indexTargets: string[], settings: ScanSettings): void
    setInterest(
      ownerId: number,
      interest: { focus: string | null; visible: string[]; offscreen: string[] }
    ): void
    setWindowFocus(ownerId: number, focused: boolean): void
    releaseOwner(ownerId: number): void
    listNow(uri: string): Promise<DirectoryListing> // 有缓存：立即返回缓存并排 P0 检查；无缓存：P0 枚举后返回
    refresh(uris: string[]): void // P0，忽略退避（立即尝试一次）
    isOffline(uri: string): boolean
    dispose(): void
  }
  ```
  `DirectoryListing` 见 Task 6（先在 `packages/shared/src/vfs/` 中定义：`{ items: FileEntry[]; state: 'fresh' | 'cached' | 'offline'; checkedAt: number | null }`，本任务创建该类型）。
- 行为（设计 4.3 / 4.6 / 4.7）：
  - 检查：`full` 或从未枚举或 `listedAt` 超过 1 小时 → 枚举；否则 `statDir`，`mtime` 与 `dirMtime` 相同只 `markChecked`。`changed` 时发 `events.changed(uri)`。
  - 间隔：P1 按位置的 `intervalSec`；P2 一轮 `backgroundIntervalMin` 分钟，同一主机两次 P2 之间至少停顿 200ms；P0 同一目录 2 秒内去重。所有 owner 都失焦时 P1 暂停（P2 继续）；某 owner 重新聚焦 → 其关注点 P0。
  - 并发：本地最多 4 个；每个主机 P1/P2 1 个 + P0 1 个。
  - 看门狗：从调用开始与每次 `onBatch` 起计时，超过 `timeoutSec` 无进展即中止。探测（`statDir`，或枚举在第一次 `onBatch` 之前）超时 / `FS_UNAVAILABLE` → 该 `shareKey` 断开：`events.reachability(share, 'offline')`，该共享的目录不再调度，按退避（30s、60s、120s… 上限 300s）只探测一个目录；成功 → `'online'`，其关注点 P0。枚举中途超时 → 该目录 `setState('unreachable')` 不影响共享。`FS_NOT_FOUND` → `removeSubtree` 并发 `changed`（父目录）；`FS_PERMISSION_DENIED` → `setState('denied')`，P2 间隔重试。
  - 「全部」/ 索引的 frontier 用游标逐层从 `cache.childDirs` 展开，队列中只保存待处理目录。
  - `setInterest` 的关注点变化时调用 `cache.visit(focus)`（热点计分）；范围计算用 `cache.hot(20)`。
  - `configure` 同时接收 `allRootUris`（所有工作区的 folder 条目，供 `cache.setRoots` 与清理），配置变化后执行一次 `cache.prune()`。
  - `listNow` 在共享断开时返回缓存并 `state: 'offline'`（无缓存 → 以 `FS_UNAVAILABLE` 拒绝），不发起访问。

步骤：

- [ ] **Step 1: 写失败的测试**（假 Enumerator + `Cache.open(':memory:')` + 注入时钟 / 计时器，不用真实等待）：
  - `skips enumeration when the directory mtime is unchanged and full is false`
  - `always enumerates the focus directory`
  - `emits changed only when the listing differs`
  - `re-enumerates after an hour even when mtime is unchanged`
  - `pauses P1 while every window is unfocused and checks the focus on refocus`
  - `limits network concurrency to one per host plus one for P0`
  - `a slow but progressing enumeration does not time out`（每 4 秒一个 batch、超时 5 秒，总计 20 秒 → 成功）
  - `a probe timeout marks the share offline and retries with 30s 60s 120s … 300s backoff`
  - `a mid-enumeration timeout marks only that directory unreachable`
  - `listNow returns cached items with state offline while the share is offline`
  - `refresh bypasses the backoff once`
  - `not-found removes the subtree and notifies the parent`
  - `all level keeps the queue bounded by the frontier`（Review Focus 1：根下 3 层 × 每层 50 个目录的假树，任一时刻队列长度 ≤ 50 + 常数）
- [ ] **Step 2–4:** 失败 → 实现 → 通过（`vitest run src/scanner/schedule`）；全量检查。
- [ ] **Step 5: 提交** `feat(scanner): schedule checks by priority with per-host limits and backoff`。

### Task 5: 扫描进程与主进程客户端

**Files:**

- Create: `packages/shared/src/scanner/protocol.ts`（zod 消息定义，`packages/shared/src/index.ts` 导出）、`apps/desktop/src/scanner/main.ts`（进程入口）、`apps/desktop/src/main/vfs/scanner-client.ts`
- Test: `packages/shared/src/scanner/protocol.test.ts`、`apps/desktop/src/main/vfs/scanner-client.test.ts`、`apps/desktop/src/scanner/main.test.ts`
- Modify: `eslint.config.mjs`（`main-vfs` → `scanner` 仅限 `?modulePath` 导入）

**Interfaces:**

- `ScannerConfig { roots: RootConfig[]; allRootUris: string[]; indexTargets: string[]; settings: ScanSettings }`（shared）；`cacheFile` 在 fork 后的第一条 `init { cacheFile }` 消息中下发。
- 消息（主 → 扫描）：`init { cacheFile }`、`configure { config: ScannerConfig }`、`list { id, uri }`、`interest { ownerId, focus, visible, offscreen }`、`windowFocus { ownerId, focused }`、`releaseOwner { ownerId }`、`refresh { uris }`、`cacheInfo { id }`、`clearCache { id }`、`search { id, … }`（Task 11 补充）、`cancel { id }`、`shutdown`。
- 消息（扫描 → 主）：`result { id, ok: true, value } | { id, ok: false, error: AppErrorData }`、`changed { uri }`、`reachability { share, state, since }`、`log { level, message }`、`ready`。
- Produces（主进程）：
  ```ts
  export class ScannerClient {
    constructor(opts: {
      fork: () => ScannerPort
      onChanged: (uri: string) => void
      onReachability: (e: ReachabilityEvent) => void
      log: Logger
      maxRestarts?: number /* 默认 3 次 / 5 分钟 */
    })
    start(): void
    readonly available: boolean // 超过重启上限后为 false（降级模式）
    configure(c: ScannerConfig): void // 重启后自动重发最后一次配置
    list(uri: string): Promise<DirectoryListing>
    interest(ownerId: number, i: Interest): void
    windowFocus(ownerId: number, focused: boolean): void
    releaseOwner(ownerId: number): void
    refresh(uris: string[]): void
    cacheInfo(): Promise<{ bytes: number }>
    clearCache(): Promise<void>
    dispose(): Promise<void>
  }
  export interface ScannerPort {
    postMessage(m: unknown): void
    on(event: 'message', cb: (m: unknown) => void): void
    on(event: 'exit', cb: (code: number) => void): void
    kill(): void
  }
  ```
  生产环境的 `fork` 用 `utilityProcess.fork(scannerPath, [], { serviceName: 'pch-scanner', stdio: 'pipe' })`，`scannerPath` 来自 `import scannerPath from '../../scanner/main?modulePath'`（读 `electron-vite/node.d.ts` 与官方文档确认写法）。
- `scanner/main.ts` 用 `process.parentPort` 收发消息，组装 `createEnumerator` + `Cache.open(cacheFile)` + `Scheduler`；对无效消息记日志并忽略。

步骤：

- [ ] **Step 1: 写失败的测试**：
  - `protocol.test.ts`：每种消息的合法 / 非法样例各一。
  - `scanner-client.test.ts`（假 `ScannerPort`）：`correlates results by id`、`pending requests reject when the scanner exits and the client restarts it`（Review Focus 4：进行中的 `list` 以 `INDEX_UNAVAILABLE` 拒绝，`fork` 被再次调用并收到最后一次 `configure`）、`stops restarting after 3 exits within 5 minutes and reports unavailable`、`forwards changed and reachability events`。
  - `scanner/main.test.ts`：直接调用入口导出的 `handleMessage`（入口文件拆出可测试的函数），`list` 往返一次真实临时目录。
- [ ] **Step 2–4:** 失败 → 实现 → 通过；新错误码 `INDEX_UNAVAILABLE` 加到 `packages/shared/src/errors`，三语文案（ja「インデックスを利用できません」/ zh-CN「索引不可用」/ en「The index is unavailable」）。全量检查。
- [ ] **Step 5: 提交** `feat(scanner): run the scanner in a utility process behind a restartable client`。

### Task 6: IPC 切换到扫描引擎，删除监听

**Files:**

- Modify: `packages/shared/src/ipc/contract.ts`、`packages/shared/src/vfs/*`、`packages/shared/src/settings/schema.ts`、`apps/desktop/src/main/vfs/{vfs.service.ts, vfs.ipc.ts, types.ts, providers/local.provider.ts}`、`apps/desktop/src/main/bootstrap/{container.ts, bootstrap.ts, shutdown.ts}`、`apps/desktop/src/main/windows/*`（窗口 focus / blur → `windowFocus`）、`apps/desktop/src/renderer/src/data/vfs.ts`、`apps/desktop/src/renderer/src/lib/query-client.ts`、`features/explorer/explorer-tree.tsx`（发送 interest）、相关测试与 `e2e/explorer.spec.ts`
- Delete: 监听相关的实现与测试（`setWatched`、`releaseOwner` 的监听部分、`LocalProvider.watch`、`createWatchScheduler`、`useWatchDirectories`、`watchableUris`、`VFS_WATCH_MAX`、`DIRECTORY_STALE_MS` 与 focus refetch 设置）

**Interfaces:**

- IPC：`vfs.list { uri, requestId? } → DirectoryListing`；`vfs.interest { focus: string | null, visible: string[] (≤2000), offscreen: string[] (≤5000) } → void`；`vfs.refresh { uris: string[] (≤500) } → void`；`vfs.cacheInfo {} → { bytes }`；`vfs.clearCache {} → void`；事件 `vfs.changed { uri }`（保留）、`vfs.reachability { share, state: 'online' | 'offline', since }`；删除 `vfs.watch`。
- 主进程：`vfs.list` 在 `ScannerClient.available` 时走扫描进程，否则走 `VfsService.list`（`state: 'fresh'`, `checkedAt: Date.now()`）。`VfsService` 的超时改为按位置取 `vfs.timeoutSec.*`（`stat` / 一次性 `list` 仍用总时长）。
- 渲染端：`DirectoryState` 扩展为 `{ status: 'ready'; items; state: 'fresh' | 'cached' | 'offline'; checkedAt }`；目录查询 `staleTime: Infinity`、无 focus / mount refetch、无轮询；`vfs.changed` → 让该目录查询失效；`vfs.reachability` → 存到 `stores/` 中的 `reachability-store.ts`（`offlineShares: Record<string, number>`）。F5 / 刷新按钮 / 「重试」→ `vfs.refresh`（当前所有已展开目录）+ 查询失效。
- interest：`explorer-tree.tsx` 从选中节点求关注点（目录节点 → 自身 URI；文件 / 链接文件 → 父目录 URI；条目根 → 条目 URI；分组 / 状态行 → null），从 `virtualizer.getVirtualItems()` 的范围求 `visible`（范围内的行所属的已展开目录与行本身为已展开目录者），其余已展开目录为 `offscreen`；300ms 防抖，卸载时发送空 interest。纯函数 `interestFromTree(nodes, range, selectedId)` 放在 `features/explorer/interest.ts` 并单测。

步骤：

- [ ] **Step 1: 写失败的测试**：`interest.test.ts`（关注点各节点类型、视口内外划分）；`data/vfs.test.ts` 改写（`vfs.changed` 使查询失效、`DirectoryState` 携带 state / checkedAt、F5 发送 `vfs.refresh`）；`settings` 的新键约束（`refresh.intervalSec.network` 拒绝 9，`vfs.timeoutSec.network` 拒绝 9）；主进程 `vfs.ipc` 在降级模式下的回退。
- [ ] **Step 2: 改写 e2e**：删除 `watch:` 与 `focus:` 用例，新增 `cache: an expanded directory shows the cached listing first and the change after the next check`（e2e 用 `PCH_USER_DATA_DIR` 的设置把 `refresh.intervalSec.local` 设为 2）与 `focus: refocusing the window does not show loading for a cached directory`。
- [ ] **Step 3–4:** 失败 → 实现 → 通过：`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e`。
- [ ] **Step 5: 提交** `feat(vfs): serve directory listings from the scanner cache instead of fs.watch`。

### Task 7: 条目级刷新级别与「建立索引」的数据与配置流

**Files:**

- Create: `apps/desktop/src/main/infra/db/migrations/0003-refresh.ts`
- Modify: `infra/db/schema.ts`、`infra/db/migrations/index.ts`、`modules/workspace/{workspace.repo.ts, entry.repo.ts, workspace.service.ts, workspace.ipc.ts}`、`packages/shared/src/workspace/*`、`packages/shared/src/ipc/contract.ts`、`main/bootstrap/container.ts`（配置下发）
- Test: `workspace.repo.test.ts`、`workspace.service.test.ts`、`main/vfs/scanner-config.test.ts`

**Interfaces:**

- 迁移 0003：`workspace_entries.refresh_level TEXT NULL CHECK (refresh_level IN ('passive','default','active','all'))`；`index_targets (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, uri TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, uri))`。
- `WorkspaceEntry.refreshLevel: RefreshLevel | null`（folder 以外恒为 null）。
- IPC：`entry.setRefreshLevel { workspaceId, entryId, level: RefreshLevel | null } → WorkspaceEntry`（非 folder → `ENTRY_KIND_MISMATCH`）；`index.setTarget { workspaceId, uri, enabled: boolean } → void`；`index.list { workspaceId } → string[]`。移除条目（含分组连带移除）时，同一事务删除该工作区中位于被移除 folder 条目之下且不在其他条目之下的 `index_targets`。
- `buildScannerConfig(input: { activeWorkspaceIds: string[]; allFolderEntries: WorkspaceEntry[]; indexTargets: { workspaceId: string; uri: string }[]; settings: Settings; location: (uri: string) => 'local' | 'network' }): ScannerConfig`（`main/vfs/scanner-config.ts`，纯函数）：`roots` 只含活动工作区的 folder 条目，级别 = `refreshLevel ?? settings['refresh.defaultLevel.<location>']`；`Cache.setRoots` 需要的「所有根」= 所有工作区的 folder 条目 URI（清理只删不属于任何工作区的缓存）。主进程在启动、`workspace.changed`、设置变化、窗口切换工作区时重新下发。位置判断：UNC → network；盘符 → 主进程用 Task 1 的同一套 `GetDriveTypeW` 逻辑（把它放在 scanner 与主进程都可 import 的位置，例如 `main/vfs/location.ts`，由 scanner 复用）。

步骤：

- [ ] **Step 1: 写失败的测试**：迁移后旧数据 `refresh_level` 为 null；`setRefreshLevel` 写入 / 清除 / 拒绝分组；`index.setTarget` 幂等；移除条目时清理其下的索引目标；`buildScannerConfig` 的级别解析与活动工作区过滤。
- [ ] **Step 2–4:** 失败 → 实现 → 通过；全量检查。
- [ ] **Step 5: 提交** `feat(workspace): store per-entry refresh levels and index targets`。

### Task 8: 资源树界面：断开、缓存状态与右键菜单

**Files:**

- Modify: `features/explorer/{tree-row.tsx, tree-model.ts, menu-items.ts, node-context-menu.tsx, explorer-view.tsx}`、`data/entries.ts`、`packages/i18n/src/locales/{ja,zh-CN,en}.ts`、`modules/system/system.ipc.ts`（删除 `openPath`）、`contract.ts`
- Test: `menu-items.test.ts`、`tree-model.test.ts`、`e2e/explorer.spec.ts`

**Interfaces / 行为：**

- 根条目所在共享断开（`reachability-store` 中有该 `shareKey`）→ 行尾显示 lucide `Unplug` 图标（`aria-label` = 「已断开」三语），其下行文字用 `text-muted-foreground`；`state === 'cached' | 'offline'` 的目录行 `title` 显示「最后更新：<本地化时间>」。渲染端求 shareKey 的函数放在 `lib/file-uri.ts`（与主进程规则一致：UNC → `\\host\share` 小写，盘符 → `C:`；映射盘在渲染端无法识别，以主进程事件中的 share 值匹配根条目 URI 前缀即可——事件的 share 与根 URI 的比较规则写成纯函数并单测）。
- 菜单（`menuItemsFor`）：删除「用系统应用打开」；folder 条目增加子菜单「刷新级别」：跟随全局（显示当前全局值）/ 全部 / 积极 / 默认 / 消极（单选，Base UI `RadioItem`，注意 `knowledge/` 中「RadioItem closeOnClick」条目）；folder 条目与真实子目录增加「建立索引」（勾选项）。
- 三语文案：级别名 ja「すべて / 積極 / 標準 / 控えめ」、zh-CN「全部 / 积极 / 默认 / 消极」、en「All / Active / Default / Passive」；「建立索引」ja「インデックスを作成」/ en「Build index」；「刷新级别」ja「更新レベル」/ en「Refresh level」；「跟随全局（{{level}}）」ja「全体設定に従う（{{level}}）」/ en「Use global setting ({{level}})」；「最后更新：{{time}}」ja「最終更新：{{time}}」/ en「Last updated: {{time}}」；「已断开」ja「切断」/ en「Disconnected」。

步骤：

- [ ] **Step 1: 写失败的测试**：`menu-items.test.ts`（各节点类型的菜单，不含「用系统应用打开」）；`share` 匹配纯函数；e2e `menu: refresh level and build index`（设置后重新打开菜单显示选中状态）与 `offline: a root on an unreachable share shows the disconnected icon and its cached rows`（主进程测试钩子注入 `reachability` 事件，见 `e2e/support.ts` 现有的主进程替换方式）。
- [ ] **Step 2–4:** 失败 → 实现 → 通过；整窗截图（浅色 ja、深色 zh-CN、浅色 en，展示断开图标与菜单）并查看。
- [ ] **Step 5: 提交** `feat(explorer): show disconnected roots and per-entry refresh settings`。

### Task 9: 按松手位置插入与拒绝临时文件

**Files:**

- Modify: `packages/shared/src/workspace/schema.ts`（`EntryAddInput`）、`modules/workspace/{workspace.service.ts, entry.repo.ts}`、`features/explorer/{drag-drop.ts, use-drop-executor.ts}`、`packages/shared/src/errors`、三语资源
- Test: `schema.test.ts`、`workspace.service.test.ts`、`drag-drop.test.ts`

**Interfaces:**

- `EntryAddInput` 增加 `position?: { before: string } | { after: string }`（同一父节点下的条目 id；不在该父节点下 → `ENTRY_INVALID_PARENT`）与 `rejectTemporary?: boolean`。插入时在同一事务中重排 `sort_order`。
- `rejectTemporary` 为 true 且路径位于 `app.getPath('temp')` 之下（大小写不敏感、按路径段比较）→ `ENTRY_TEMPORARY_PATH`（ja「一時ファイル（圧縮ファイル内のファイルなど）は追加できません。先に展開してください。」/ zh-CN「无法添加临时文件（例如压缩包内的文件），请先解压。」/ en「Temporary files (such as files inside an archive) can't be added. Extract them first.」）。只有系统拖入设置该标志（对话框与固定真实子项不设）。临时目录路径由主进程注入 service（便于测试）。
- `resolveDrop` 的 add 动作带上 before / after（与画线一致；inside → 末尾）。

步骤：

- [ ] **Step 1: 写失败的测试**：before / after / 末尾的 `sort_order`；位置条目不属于该父节点 → 错误；临时目录下的路径与 `rejectTemporary` 组合（含 `%TEMP%2` 这种前缀相同但不在其下的路径不被拒绝）；`resolveDrop` 输出位置。
- [ ] **Step 2–4:** 失败 → 实现 → 通过；全量检查与 e2e。
- [ ] **Step 5: 提交** `feat(explorer): insert dropped entries where they land and refuse temporary files`。

### Task 10: 原则回归、打包实测与文档

**Files:**

- Modify: `e2e/explorer.spec.ts`、`doc/PremiumCowHorse-架构设计方案.md`（v1.9：7.1、7.2、8.2、8.3、13、14.1、18、19 节，目标结构与「已实现」分开写）、`knowledge/*`、`README.md`（如命令或环境有变）、`devDoc/2026-11-19-04-refresh-cache.md`（新建，登记到 `devDoc/README.md`）
- Create: `apps/desktop/src/scanner/perf.bench.ts` 或一次性脚本（性能记录，脚本不入库则写明命令）

步骤：

- [ ] **Step 1: e2e `principle: renaming an ancestor of an expanded directory succeeds`**：展开 `A\B\C`、等待 2 个刷新间隔后，由测试进程 `fs.renameSync(A, A2)` 再改回，重复 10 次，每次间隔 300ms；全部成功（单次失败允许重试一次，并在报告中记录是否发生）。旧实现（`fs.watch`）下此用例会失败——在报告中说明以 `git stash` 回到 Task 5 之前验证过。
- [ ] **Step 2: 性能记录**：合成 1 万目录 / 10 万文件的本地树，「全部」级别首轮扫描耗时、扫描进程内存峰值、`index.db` 大小；UNC 用 `\\localhost\<共享>`（`net share` 不可用或需管理员则写明未验证）。结果写进 devDoc。
- [ ] **Step 3: 打包实测**：`pnpm dist`，解压 zip 运行（`--user-data-dir=<临时目录>`），确认扫描进程启动、koffi 加载（日志中没有回退警告）、`index.db` 生成、树正常显示；结束后检查残留进程。
- [ ] **Step 4: 文档**：doc v1.9（文首版本号与变更摘要）；knowledge 更新 / 改写 `fs.watch` 相关条目（结论被推翻的标注）、新增访问时间与 koffi 条目；devDoc 记录（已验证 / 未验证分开、待需求方确认事项引用设计文档第 7 节）。
- [ ] **Step 5: 全量检查**：`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e`。
- [ ] **Step 6: 提交** `docs: document the scan-and-cache engine` （e2e 与文档可分两个提交）。

### Task 11: 搜索后端

**Files:**

- Create: `apps/desktop/src/scanner/search/{parse-query.ts, search.ts}`、`packages/shared/src/search/types.ts`
- Modify: `packages/shared/src/scanner/protocol.ts`、`main/vfs/scanner-client.ts`、`contract.ts`、主进程 IPC handler
- Test: `parse-query.test.ts`、`search.test.ts`

**Interfaces:**

- `parseQuery(text: string): { terms: { kind: 'contains' | 'glob'; value: string }[] }`：空白分隔；含 `*` / `?` → glob；去掉空词。
- `search(cache: Cache, q: { scopes: { uri: string; entryId: string; label: string }[]; terms; kind: 'all' | 'file' | 'directory'; showHidden: boolean; limit: number }): SearchResult`
- `SearchHit { uri: string; name: string; kind: 'file' | 'directory' | 'symlink'; size: number; mtime: number; hidden: boolean; entryId: string; relativePath: string }`；`SearchResult { items: SearchHit[]; total: number; truncated: boolean; indexedAt: number | null; incomplete: boolean }`。
- IPC `search.query { workspaceId, text, kind, limit?: number (1–1000, 默认 1000), requestId } → SearchResult`；主进程从工作区条目组装 scopes（folder 条目 URI 前缀；file 条目自身按名称匹配，在主进程侧合并）、读取 `explorer.showHiddenFiles`。同一 requestId 的新查询取消旧查询。扫描进程不可用 → `INDEX_UNAVAILABLE`。
- 匹配：≥3 字符的 contains 词用 `entries_fts MATCH`（每个词加双引号转义）；短词与 glob 在候选上用 `LIKE ... ESCAPE` / `GLOB`（glob 大小写不敏感：两边 `lower()`）；全部为短词时直接扫 `entries`。排序：名称以第一个词开头者优先，其次名称；`total` 为匹配总数（上限计数到 10000，超过显示「10000+」由渲染端处理）。`indexedAt` = 范围内目录 `checked_at` 的最小值；`incomplete` = 范围内存在 `listed_at` 为 null 的目录。

步骤：

- [ ] **Step 1: 写失败的测试**：`parseQuery`（AND、glob、空输入）；`search`：多词 AND、短词、`*.xlsx`、`第?章`、隐藏过滤、kind 过滤、范围前缀（`C:/a` 不含 `C:/ab`）、上限与 `truncated`、排序、`incomplete`；性能：灌入 10 万条名称，3 字词查询 < 200ms（在 CI 慢机上只记录不断言：用 `expect(ms).toBeLessThan(2000)` 作为宽松上限，实测值写进报告）。
- [ ] **Step 2–4:** 失败 → 实现 → 通过；全量检查。
- [ ] **Step 5: 提交** `feat(search): query cached file names by terms and wildcards`。

### Task 12: 搜索视图

**Files:**

- Create: `apps/desktop/src/renderer/src/features/search/{search-view.tsx, search-results.tsx, index.ts}`、`data/search.ts`、`stores/navigation-store.ts`
- Modify: `features/shell/components/activity-bar.tsx`（新增 `search` 视图）、`features/shell` 的 `SidebarView` 类型、`app/app.tsx`（组合 `sidebarViews.search`）、`features/explorer/explorer-tree.tsx`（消费定位请求）、`eslint.config.mjs`（无需新元素，`features/*` 已覆盖）、三语资源、`e2e/search.spec.ts`
- Test: `data/search.test.ts`、`stores/navigation-store.test.ts`、`features/explorer` 中定位逻辑的单测、e2e

**Interfaces / 行为（设计 02 第 3 节）：**

- `navigation-store`：`requestReveal(workspaceId: string, uri: string): void`、`consume(): RevealRequest | null`；资源树收到请求后：切到资源管理器视图、找到 URI 所属的 folder 条目（最长前缀）、展开祖先（逐层等待列表就绪）、选中并 `scrollToIndex`；找不到所属条目 → toast「该项目不在当前工作区的条目中」（三语）。
- `Ctrl+Shift+F`：打开搜索视图并聚焦输入框（全局快捷键在 shell 中注册）。
- 输入防抖 150ms；`data/search.ts` 的查询 key `['search', workspaceId, text, kind]`，`staleTime: 0`，abort 时 `vfs.cancel` 同一 requestId（复用 `listDirectory` 的取消写法）。
- 结果列表虚拟滚动；行：图标、名称（匹配片段 `<mark>` 高亮）、第二行「条目标签 › 相对路径」（中间省略）；右键菜单：在树中定位 / 在资源管理器中显示 / 复制路径 / 复制 URI。键盘：输入框 ↓ 进入列表，↑↓ 移动，Enter 定位，Esc 回输入框。
- 状态文案（三语）：空输入说明、无结果、「只显示前 1000 项，请输入更多关键词」、「基于缓存（{{time}}更新）」、「部分目录尚未扫描」、`INDEX_UNAVAILABLE`。文案 ja 版以「キャッシュ」「インデックス」为术语。

步骤：

- [ ] **Step 1: 写失败的测试**：`data/search.test.ts`（取消、防抖由组件负责则测组件外的纯函数）；`navigation-store`；定位逻辑纯函数 `revealPath(entries, uri) → { entryId, segments } | null`；e2e：`search: typing shows matches from the cache and Enter reveals the row in the tree`、`search: kind filter`、`search: no results`、`search: Ctrl+Shift+F focuses the input`。
- [ ] **Step 2–4:** 失败 → 实现 → 通过；整窗截图（浅色 ja、深色 zh-CN、浅色 en）并查看。
- [ ] **Step 5: 文档**：doc v1.10（搜索章节；路线图中「文件名搜索」移到已实现）、devDoc 记录追加搜索部分、knowledge。
- [ ] **Step 6: 全量检查并提交** `feat(search): add the file name search view`。
