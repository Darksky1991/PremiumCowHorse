# M3 桌面记录：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 监控资源管理器（含标签页）、Word / Excel / PowerPoint、VS Code、Eclipse 当前打开的内容，定时 / 手动 / 退出时保存为快照，重启后提示并按勾选恢复。

**Architecture：** 主进程新模块 `modules/desktop`：koffi 每 5 秒枚举顶层窗口求差异，有变化（与每 5 分钟）时由四个采集器（Explorer / Office 为固定 PowerShell 脚本，VS Code / Eclipse 读其状态文件）取详情，汇入纯逻辑的「当前现场」（消失 1 分钟后才移除），定时写入数据库快照；恢复由主进程按快照中采集到的 exe 与参数直接启动。渲染端新 feature `features/desktop`：活动栏视图、标签中的快照页、重启后的恢复对话框与退出时的保存对话框。

**Tech Stack：** Electron 45（`BrowserWindow` 的 `query-session-end` / `session-end`）、koffi（已有）、Windows PowerShell 5.1（已有调用方式）、node:sqlite + Kysely、zod、React + zustand + 现有 data 层、shadcn（Base UI）、vitest、Playwright。

**Spec：** [devDoc/2026-11-21-31-m3-desktop-snapshot-design.md](./2026-11-21-31-m3-desktop-snapshot-design.md)（定稿）。执行者同时读设计与本计划；两者矛盾时以设计为准并记入台账。

**分支：** `feat/m3-desktop-snapshot`（从 `main` @ `1f65223` 切出）。每个任务一次提交（沿用 M1 / M2 的做法），合并只在需求方要求时进行。

**台账：** `devDoc/2026-11-21-33-m3-ledger.md`（Task 1 建立）：每个任务的结果、控制者决定、推迟项、未验证项。按 memory「prototype-first」：Minor 只记录不修，最后统一确认。

## Global Constraints

- 文件系统原则：不写入、不新建、不删除、不移动、不改名用户的文件与目录；读取其他程序的状态文件只读打开、读完即关，不长期持有句柄（设计反目标 2）。
- 不新增依赖：只用已有的 koffi、`child_process`、node:sqlite、zod（设计 4.2）。
- PowerShell 脚本是固定字符串，输入只经环境变量（`runPowerShell(script, env, timeoutMs)` 的约定），不拼接任何数据。
- 恢复只启动快照中由主进程采集的项目：渲染端只传快照 id 与项目 id；可启动的 exe 文件名白名单 `explorer.exe`、`WINWORD.EXE`、`EXCEL.EXE`、`POWERPNT.EXE`、`Code.exe`、`eclipse.exe`（不区分大小写）（设计 5.5）。
- 不保存整串命令行，只保留恢复所需的部分（设计 5.6）。
- 数值（设计 5.2–5.4）：窗口扫描 `5000` ms；详情防抖 `2000` ms；完整读取兜底 `300_000` ms；消失后移除 `60_000` ms；自动保存间隔 `300_000` ms；采集器超时 `10_000` ms；恢复项之间 `500` ms；自动记录保留最近 `20` 份 + 最近 `10` 次登录各自的最后一份自动记录。
- 快照按机器区分：`machine` = `os.hostname()`，只读写本机的行（与 `launch_capabilities` 同理：`%APPDATA%` 可能漫游）。控制者决定，设计未写，Task 3 并入设计。
- 只在 Windows 上启用监控；其他平台 `DesktopService` 不启动监控，IPC 照常返回空结果。
- 分层（`eslint.config.mjs`）：`modules/desktop` 只能依赖 `main-vfs`、`main-infra`、`main-core`、`shared`；不能 import `modules/launcher`。
- 界面文案 ja / zh-CN / en 同时添加（ja 为类型基准）；shadcn 组件不改样式，`className` 只做布局。
- 迁移文件发布后不得修改；改表 = 新迁移 + `infra/db/schema.ts` 类型。
- 测试范围：每个任务只跑本任务的单元测试文件 + `pnpm typecheck` + `pnpm lint` + `pnpm exec prettier --check .`；动到界面的任务加 `pnpm build` 与 `e2e/desktop.spec.ts`。全量只在 Task 13。

## Review Focus

1. **关机时所有程序在同一轮扫描中一起消失**（本应用也即将被结束）→ 之后写出的自动记录仍包含全部项目。测试：Task 4 `LiveState` 「全部消失后 retained 仍含全部」、Task 8 「全部消失后 autosave 写出的项目不变」。
2. **Office 弹着模态对话框，采集器超时或报错** → 该类保留上一次结果，不开始计时移除。测试：Task 8 「采集器失败时保留该类上一次结果」。
3. **PowerShell 被终端策略禁止**（每次都失败）→ 不弹提示刷屏，日志每类只记一次，侧栏显示「无法读取：<类别>」；该类项目不被移除。测试：Task 8 「连续失败只记一次日志并报告状态」。
4. **恢复时多个项目位于连不上的网络路径** → 每项存在性检查最多 `3000` ms，超时记为 `unreachable` 并继续下一项，总时长不随失败项累加到分钟级。测试：Task 9 「stat 超时的项目跳过且不阻塞后续」。
5. **数据库随漫游配置到另一台机器** → 不列出、不提示别的机器的快照。测试：Task 3 「只返回本机 machine 的快照」。

---

### Task 1: 先行验证与台账

不写产品代码。脚本放 scratchpad，结论（含实测输出摘录）写入台账；结论与设计 / 本计划不符时，先修改本计划后续任务的接口再继续，并在台账记「控制者决定」。

**Files:**

- Create: `devDoc/2026-11-21-33-m3-ledger.md`（并登记到 `devDoc/README.md`）

- [ ] **Step 1：Office 多实例**：开两个 Excel 进程（`EXCEL.EXE /x`）各开一个只读 / 可写工作簿、Word、PowerPoint 各一个文档。验证从每个顶层窗口（`XLMAIN` / `OpusApp` / `PPTFrameClass`）经 `AccessibleObjectFromWindow(OBJID_NATIVEOM)` 取到 Application 并枚举 `Workbooks` / `Documents` / `Presentations` 的 `FullName` 与 `ReadOnly`；再弹出「另存为」对话框重复一次，记录调用是否阻塞、多久。产出：Task 6 Office 脚本的取法与输出 JSON 样例。
- [ ] **Step 2：资源管理器**：在 M3 讨论时的实测脚本基础上，验证「添加新标签页」（`AutomationId = AddButton`）点击后，对新出现的 `Shell.Application` 项调用 `Navigate2(<path>)` 能把新标签带到指定路径；以及 `explorer.exe shell:::{CLSID}` 能打开 `::{CLSID}` 类位置。注意：两个以上标签的窗口用 `WM_CLOSE` 关不掉（讨论中实测），测试窗口逐个标签 `Quit()` 后再 `WM_CLOSE`。产出：Task 9 的标签恢复脚本取法。
- [ ] **Step 3：VS Code**：开两个窗口（一个文件夹、一个 `.code-workspace`），读 `%APPDATA%\Code\User\globalStorage\storage.json` 的 `windowsState`：`lastActiveWindow` / `openedWindows` 的字段（`folder`、`workspace.configPath`、`remoteAuthority`、`uiState`），以及开 / 关窗口后多久写入。产出：Task 7 的取法；若写入只发生在退出时，改为「标题中的文件夹名」+ `state.vscdb`（`?immutable=1` 只读）的最近列表匹配，台账记录。
- [ ] **Step 4：登录时刻**：koffi 调 `wtsapi32.WTSQuerySessionInformationW(0, -1 /* WTS_CURRENT_SESSION */, 24 /* WTSSessionInfo */)` 取 `WTSINFOW.LogonTime`（FILETIME）；不可行时退回「shell 进程（`GetShellWindow` → pid）的创建时刻」。产出：Task 5 `getLogonTime` 的实现方式。
- [ ] **Step 5：koffi 枚举耗时**：主进程同等条件（Node + koffi）下 `EnumWindows` + 标题 + 进程路径 + 矩形，测 100 次的中位数与最大值（目标 < 5 ms）。
- [ ] **Step 6：VS Code 远程文件夹**：若本机有 WSL / SSH 远程，验证状态文件中的形式与 `Code.exe --folder-uri <URI>`；没有环境则记「未验证」，Task 7 照常记录、恢复失败时跳过。
- [ ] **Step 7：Eclipse**：向需求方确认要下载的官方 zip 版本（Eclipse IDE for Java Developers 的某个发行版，CLAUDE.md：下载可执行程序前先确认版本）；未获确认前跳过，留到 Task 13。确认后：解压到 scratchpad，`-data` 指定 / 不指定两种启动，记录进程名、窗口类名、标题格式、`Win32_Process.CommandLine` 中的 `-data`、`configuration/.settings/org.eclipse.ui.ide.prefs` 的 `RECENT_WORKSPACES`。
- [ ] **Step 8：会话结束通知**（不强求）：在 Task 10 完成后的一次真实重启中观察日志；此处只在台账中登记为待观察。
- [ ] **Step 9：提交**

```bash
git switch -c feat/m3-desktop-snapshot
git add devDoc/2026-11-21-30-open-items-triage.md devDoc/2026-11-21-31-m3-desktop-snapshot-design.md devDoc/2026-11-21-32-m3-desktop-snapshot-plan.md devDoc/2026-11-21-33-m3-ledger.md devDoc/README.md
git commit -m "docs: M3 desktop snapshot spikes and ledger"
```

### Task 2: 共享类型、位置、设置键与 PowerShell 移到 infra

**Files:**

- Create: `packages/shared/src/desktop/types.ts`、`packages/shared/src/desktop/keys.ts`、`packages/shared/src/desktop/keys.test.ts`
- Modify: `packages/shared/src/index.ts`（导出）、`packages/shared/src/layout/types.ts`（`LocationKind` 加 `'desktop'`）、`packages/shared/src/layout/location.ts`（+ `location.test.ts`）、`packages/shared/src/settings/schema.ts`
- Move: `apps/desktop/src/main/modules/launcher/powershell.ts` → `apps/desktop/src/main/infra/powershell.ts`（更新 launcher 与 container 的 import，内容不变）

**Interfaces:**

- Produces（`packages/shared/src/desktop/types.ts`）：

```ts
export const DESKTOP_COLLECTORS = ['explorer', 'office', 'vscode', 'eclipse'] as const
export type DesktopCollector = (typeof DESKTOP_COLLECTORS)[number]
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}
export type OfficeApp = 'word' | 'excel' | 'powerpoint'
export type DesktopItem =
  | { kind: 'explorer'; tabs: string[]; bounds: WindowBounds | null } // 路径或 `::{CLSID}`，按标签顺序
  | { kind: 'office'; app: OfficeApp; path: string; readOnly: boolean; exe: string }
  | { kind: 'vscode'; target: string; exe: string; bounds: WindowBounds | null } // 本地路径、.code-workspace 路径或 vscode-remote:// URI
  | { kind: 'eclipse'; workspace: string; exe: string; bounds: WindowBounds | null }
export type DesktopSnapshotKind = 'auto' | 'manual' | 'exit' | 'exit-none'
export interface DesktopSnapshotSummary {
  id: number
  kind: DesktopSnapshotKind
  createdAt: number
  logonAt: number
  name: string | null
  itemCount: number
}
export interface DesktopSnapshotItem {
  id: number
  item: DesktopItem
}
export interface DesktopSnapshot extends DesktopSnapshotSummary {
  items: DesktopSnapshotItem[]
}
export interface DesktopCurrent {
  items: { key: string; item: DesktopItem }[]
  unreadable: DesktopCollector[]
}
export type DesktopSkipReason = 'open' | 'missing' | 'unreachable' | 'failed'
export interface DesktopRestoreResult {
  launched: number
  skipped: { itemId: number; reason: DesktopSkipReason }[]
}
```

- Produces（`keys.ts`）：`desktopItemKey(item: DesktopItem): string` — 同一对象的稳定标识，用于「已开着」比较与勾选：`explorer:` + 各标签路径小写以 `|` 连接；`office:` + `path` 小写；`vscode:` + `target` 小写；`eclipse:` + `workspace` 小写。`openTargetsOf(items: DesktopItem[]): Set<string>` — 现场中开着的单个目标集合（Explorer 每个标签一项 `explorer-tab:<路径小写>`，其余同 key），恢复时据此跳过已开着的项目（Explorer 只要第一个标签的路径已开着就跳过整个窗口）。
- Produces（`location.ts`）：`DESKTOP_URI_SCHEME = 'pch-desktop:'`；`desktopUri(id: number | 'current'): string`；`desktopIdOfUri(uri: string): number | 'current' | null`；`desktopLocation(id: number | 'current', title: string): TabLocation`（`kind: 'desktop'`）。
- Produces（设置）：`'desktop.askOnExit': z.boolean().default(true)`。

- [ ] **Step 1：写失败的测试**：`keys.test.ts` — `desktopItemKey` 对 `C:\Work\A.xlsx` 与 `c:\work\a.xlsx` 相同；Explorer 两个标签顺序不同 key 不同；`openTargetsOf` 对两个标签的 Explorer 产生两项 `explorer-tab:`。`location.test.ts` — `desktopIdOfUri(desktopUri(12)) === 12`、`desktopIdOfUri('pch-desktop:current') === 'current'`、`desktopIdOfUri('pch-desktop:abc') === null`、`desktopIdOfUri('pch-workspace:1') === null`。
- [ ] **Step 2：运行确认失败**：`pnpm vitest run packages/shared/src/desktop/keys.test.ts packages/shared/src/layout/location.test.ts` → FAIL（模块不存在）。
- [ ] **Step 3：实现上述类型与函数，加设置键，移动 `powershell.ts`**。`LocationKind` 增加 `'desktop'` 后，`switch` 穷尽处的编译错误按 `'workspaces'` 的处理方式补上（不是文件 URI：不发扫描进程、不进 `vfs.interest`、树不定位；地址栏只显示一段，标题为快照标题）。
- [ ] **Step 4：运行确认通过**：同上命令 PASS；`pnpm typecheck`、`pnpm lint` 退出码 0。
- [ ] **Step 5：提交**：`git commit -m "feat(shared): desktop snapshot types, location and setting"`

### Task 3: 迁移 0006 与快照仓库

**Files:**

- Create: `apps/desktop/src/main/infra/db/migrations/0006-desktop-snapshots.ts`（+ `.test.ts`）、`apps/desktop/src/main/modules/desktop/snapshot.repo.ts`（+ `.test.ts`）
- Modify: `apps/desktop/src/main/infra/db/migrations/index.ts`、`apps/desktop/src/main/infra/db/schema.ts`、`eslint.config.mjs`（如需为新模块登记，`modules/*` 已有通配则不改）、设计文档 5.4 节（补 `machine` 列，标「控制者」）

**Interfaces:**

- 表 `desktop_snapshots`：`id integer primary key autoincrement`、`machine text not null`、`kind text not null`、`created_at integer not null`、`logon_at integer not null`、`name text`；索引 `(machine, created_at)`。表 `desktop_items`：`id integer primary key autoincrement`、`snapshot_id integer not null references desktop_snapshots(id) on delete cascade`、`sort integer not null`、`data text not null`（`DesktopItem` 的 JSON）。
- Produces（`snapshot.repo.ts`）：

```ts
export class DesktopSnapshotRepo {
  constructor(db: Database, machine: string)
  insert(input: {
    kind: DesktopSnapshotKind
    createdAt: number
    logonAt: number
    name?: string | null
    items: DesktopItem[]
  }): Promise<number>
  list(): Promise<DesktopSnapshotSummary[]> // 本机，created_at 降序；不含 exit-none
  get(id: number): Promise<DesktopSnapshot | null> // 别的机器的 id → null；data 解析失败的项目丢弃
  listByLogon(): Promise<DesktopSnapshotSummary[]> // 本机全部（含 exit-none），供恢复候选判断
  rename(id: number, name: string | null): Promise<void>
  delete(id: number): Promise<void>
  prune(keepAuto: number, keepLogons: number): Promise<void>
}
```

`prune`：`auto` 中保留最近 `keepAuto` 份，以及最近 `keepLogons` 个不同 `logon_at` 各自 `created_at` 最大的一份；`manual` / `exit` 不删；`exit-none` 只保留最近 `keepLogons` 个登录内的。

- [ ] **Step 1：写失败的测试**（内存库，沿用 `0005-launch-capabilities.test.ts` 与 `launch-capabilities.repo` 测试的建库方式）：迁移后两张表存在、删快照级联删项目；repo「只返回本机 machine 的快照」（插入两台机器各一份，`list` / `get` 只见本机）；`list` 不含 `exit-none`；`get` 丢弃 `data` 非法的项目；`prune(20, 10)` 在 25 份 auto（分属 12 次登录）+ 2 份 manual 下的保留结果。
- [ ] **Step 2：运行确认失败**：`pnpm vitest run apps/desktop/src/main/infra/db/migrations/0006-desktop-snapshots.test.ts apps/desktop/src/main/modules/desktop/snapshot.repo.test.ts` → FAIL。
- [ ] **Step 3：实现迁移、schema 类型与 repo**（`data` 用 zod 校验 `DesktopItem`，结构见 Task 2）。
- [ ] **Step 4：运行确认通过**；`pnpm typecheck`、`pnpm lint` 0。
- [ ] **Step 5：提交**：`git commit -m "feat(desktop): snapshot tables and repository"`

### Task 4: 当前现场与恢复候选（纯逻辑）

**Files:**

- Create: `apps/desktop/src/main/modules/desktop/live-state.ts`（+ `.test.ts`）、`apps/desktop/src/main/modules/desktop/restore-candidate.ts`（+ `.test.ts`）

**Interfaces:**

- Consumes：`DesktopItem`、`desktopItemKey`、`openTargetsOf`（Task 2）。
- Produces：

```ts
export class LiveState {
  constructor(opts: { removeAfterMs: number })
  /** 用某一类采集器的最新结果替换该类；返回现场（current 或 retained）是否变化 */
  apply(collector: DesktopCollector, items: DesktopItem[], now: number): boolean
  /** 该类本轮采集失败：不改动该类，也不开始移除计时 */
  markFailed(collector: DesktopCollector): void
  /** 会话结束期间冻结：untilMs 之前不移除任何项目（retained 不缩水），之后恢复正常（设计 5.3） */
  freeze(untilMs: number, now: number): void
  /** 此刻开着的项目（不含消失中的） */
  current(): { key: string; item: DesktopItem }[]
  /** 自动保存用：开着的 + 消失未满 removeAfterMs 的 */
  retained(now: number): DesktopItem[]
}
export function pickRestoreCandidate(
  snapshots: DesktopSnapshotSummary[], // listByLogon() 的结果
  currentLogonAt: number
): { snapshotId: number } | null
export function itemsToOffer(
  snapshot: DesktopSnapshot,
  openTargets: Set<string>
): DesktopSnapshotItem[]
```

`pickRestoreCandidate`：当前登录已有任何快照 → `null`（每次登录只提示一次：服务在启动后的第一次扫描后立即写一份 auto，见 Task 10）；否则取 `logon_at` 小于当前、最大的那次登录，按 `created_at` 取其中最后一份非 `manual` 快照：`exit` → 它；`exit-none` → `null`；`auto` → 它；那次登录没有非 manual 快照 → `null`（设计 5.7 / 第 8 节第 1 条）。

- [ ] **Step 1：写失败的测试**：`LiveState` — 新项目立即进入 `current`；某类结果去掉一项后 `current` 立即不含它、`retained(now + 59_999)` 仍含、`retained(now + 60_000)` 不含；**全部消失后 retained 仍含全部**（Review Focus 1）；`markFailed` 后再过 90 秒该类项目仍在 `current`；消失中又出现则取消计时。`pickRestoreCandidate` — 上次登录以 exit 结束 → exit；以 exit-none 结束 → null；exit 之后同一登录又有 auto → auto；只有 manual → null；当前登录已有快照 → null；没有更早的登录 → null。`itemsToOffer` — 已开着的 Office / VS Code / Explorer（第一个标签已开着）被滤掉。
- [ ] **Step 2：运行确认失败**：`pnpm vitest run apps/desktop/src/main/modules/desktop/live-state.test.ts apps/desktop/src/main/modules/desktop/restore-candidate.test.ts` → FAIL。
- [ ] **Step 3：实现**。
- [ ] **Step 4：运行确认通过**；`pnpm typecheck`、`pnpm lint` 0。
- [ ] **Step 5：提交**：`git commit -m "feat(desktop): live state with delayed removal and restore candidate"`

### Task 5: 窗口枚举与登录时刻（koffi）

> **Task 1 实测（控制者 Ruling，详见 devDoc 台账 33）**：koffi 声明照 `.superpowers/sdd/2026-11-21-32-m3-desktop-snapshot-plan/spikes/koffi-spike.cjs`（`WTSINFOW` 为 `WinStationName[32]`、`Domain[17]`、`UserName[21]`；`LogonTime` 取得成功）；pid → 进程路径做缓存（无缓存中位数约 1.9 ms、有缓存约 0.2 ms），缓存在 pid 消失后清除。

**Files:**

- Create: `apps/desktop/src/main/modules/desktop/window-list.ts`（+ `.test.ts`，只测纯函数部分）、`apps/desktop/src/main/modules/desktop/logon.ts`

**Interfaces:**

- Produces：

```ts
export interface WindowInfo {
  hwnd: number
  pid: number
  exe: string
  className: string
  title: string
  bounds: WindowBounds
}
export type ListWindows = () => WindowInfo[] // 只含可见顶层窗口
export function loadListWindows(): ListWindows | null // koffi 加载失败或非 win32 → null（同 vfs/location.ts 的 loadDriveType 写法）
export function collectorOf(w: WindowInfo): DesktopCollector | null
// exe 文件名（不区分大小写）+ 类名：explorer.exe/CabinetWClass → explorer；WINWORD.EXE/OpusApp、EXCEL.EXE/XLMAIN、POWERPNT.EXE/PPTFrameClass → office；
// Code.exe/Chrome_WidgetWin_1 且标题非空 → vscode；eclipse.exe/SWT_Window0 → eclipse；其余 null（Task 1 结果不同时以台账为准）
export function windowsSignature(ws: WindowInfo[]): Map<DesktopCollector, string> // 每类：按 hwnd 排序的「hwnd + 标题」串，用于求差异
export function getLogonTime(): Promise<number> // 毫秒时间戳，取整到秒；方式按 Task 1 Step 4
```

- [ ] **Step 1：写失败的测试**：`collectorOf` 对上述组合与大小写变化（`excel.exe`）的结果、对 `notepad.exe` 为 null、对标题为空的 `Code.exe` 为 null；`windowsSignature` 在只改某一类窗口标题时只有该类的串变化。
- [ ] **Step 2：运行确认失败**：`pnpm vitest run apps/desktop/src/main/modules/desktop/window-list.test.ts` → FAIL。
- [ ] **Step 3：实现**（koffi：`EnumWindows` + `koffi.register` 回调、`IsWindowVisible`、`GetWindowTextW`、`GetClassNameW`、`GetWindowThreadProcessId`、`GetWindowRect`、`OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `QueryFullProcessImageNameW` + `CloseHandle`；回调在 `finally` 中 `unregister`）。
- [ ] **Step 4：运行确认通过**；另写一次性脚本在本机运行 `loadListWindows()()` 与 `getLogonTime()`，结果摘录写入台账（未纳入自动测试）；`pnpm typecheck`、`pnpm lint` 0。
- [ ] **Step 5：提交**：`git commit -m "feat(desktop): window enumeration and logon time via koffi"`

### Task 6: 采集器：资源管理器与 Office

> **Task 1 实测（控制者 Ruling）**：Office 不能对顶层窗口取 `OBJID_NATIVEOM`，要对子窗口 `EXCEL7` / `_WwG` / `mdiClass` 取，再 `.Application`，按进程 pid 去重；Word 的 `Documents.Item` 要传 `[ref]`；弹着对话框时调用不抛错而返回 null → **`FullName` 为空即视为该类本轮失败**（reject，交给 `markFailed`）；没有完整路径的文档（未保存 / 保护视图）过滤。可照 `.superpowers/sdd/2026-11-21-32-m3-desktop-snapshot-plan/spikes/office-spike.ps1`。Explorer 照 `.superpowers/sdd/2026-11-21-32-m3-desktop-snapshot-plan/spikes/explorer-spike.ps1`：主文件夹页内的非窗口子标签（お気に入り / 最近使った 等）要过滤。

**Files:**

- Create: `apps/desktop/src/main/modules/desktop/collectors/types.ts`、`collectors/explorer.ts`（+ `.test.ts`）、`collectors/office.ts`（+ `.test.ts`）、`collectors/scripts.ts`（两段固定 PowerShell 脚本）

**Interfaces:**

- Consumes：`WindowInfo`（Task 5）、`runPowerShell`（`infra/powershell.ts`，Task 2）。
- Produces：

```ts
export interface Collector {
  readonly id: DesktopCollector
  /** windows 为本轮属于该类的窗口；失败（超时、脚本错误、解析失败）时 reject */
  collect(windows: WindowInfo[]): Promise<DesktopItem[]>
}
export function createExplorerCollector(run: typeof runPowerShell, timeoutMs: number): Collector
export function createOfficeCollector(run: typeof runPowerShell, timeoutMs: number): Collector
export function parseExplorerOutput(stdout: string, windows: WindowInfo[]): DesktopItem[]
export function parseOfficeOutput(stdout: string, windows: WindowInfo[]): DesktopItem[]
```

Explorer 脚本输出 `[{ "hwnd": 123, "tabs": ["C:\\a", "::{F874...}"] }]`（标签顺序按 UI Automation 的 `TabItem` 顺序与 `LocationName` 对应；Task 1 Step 2 的方法）；`bounds` 由 `windows` 中同 `hwnd` 的矩形补上。Office 脚本输出 `[{ "app": "excel", "path": "...", "readOnly": true, "hwnd": 456 }]`；`exe` 取同 `hwnd` 窗口的 `exe`；`https://` 开头的路径与位于 `%TEMP%`（`os.tmpdir()`，长名与 8.3 短名都比较）下的路径丢弃（设计第 2 节非目标）。

- [ ] **Step 1：写失败的测试**（用 Task 1 采到的真实输出做样例）：`parseExplorerOutput` — 同一 hwnd 的两个标签合为一项且顺序保留、补上 bounds、hwnd 不在 windows 中的项丢弃；`parseOfficeOutput` — `https://` 与临时目录中的文档被丢弃、`exe` 来自窗口、非法 JSON 抛错；`createOfficeCollector` 在 `run` reject 时 reject。
- [ ] **Step 2：运行确认失败**：`pnpm vitest run apps/desktop/src/main/modules/desktop/collectors/explorer.test.ts apps/desktop/src/main/modules/desktop/collectors/office.test.ts` → FAIL。
- [ ] **Step 3：实现脚本、解析与采集器**。
- [ ] **Step 4：运行确认通过**；在本机开着资源管理器（两个标签）与一个 Excel 文件时，一次性脚本调用两个采集器，输出摘录写入台账；`pnpm typecheck`、`pnpm lint` 0。
- [ ] **Step 5：提交**：`git commit -m "feat(desktop): explorer and office collectors"`

### Task 7: 采集器：VS Code 与 Eclipse

> **Task 1 实测（控制者 Ruling）**：`.code-workspace` 窗口的字段是 `workspaceIdentifier.configURIPath`（不是 `workspace.configPath`）；`folder` 为 `file:///c%3A/...`。`storage.json` 只在打开窗口后约 4–9 秒写入、关闭窗口不写，**不能表示现在开着什么**：以可见 Code 窗口的标题为准——标题默认格式 `<活动编辑器> - <根名> - Visual Studio Code`（工作区为 `<名> (Workspace)`，刚启动时只有 `Visual Studio Code`），从标题取根名，与 `storage.json`（`lastActiveWindow` + `openedWindows`）中各项的最后一段（工作区为文件名去掉 `.code-workspace`）匹配，只输出匹配上的项；标题只有 `Visual Studio Code` 或匹配不到的窗口本轮忽略。`state.vscdb` 备用方案删除。可照 `.superpowers/sdd/2026-11-21-32-m3-desktop-snapshot-plan/spikes/vscode-spike.ps1`、`.superpowers/sdd/2026-11-21-32-m3-desktop-snapshot-plan/spikes/vscode-titles.ps1`。Task 8 中 vscode 类的防抖改为 `10_000` ms（等 storage.json 写入）。

**Files:**

- Create: `collectors/vscode.ts`（+ `.test.ts`）、`collectors/eclipse.ts`（+ `.test.ts`），均在 `apps/desktop/src/main/modules/desktop/` 下

**Interfaces:**

- Consumes：`Collector`（Task 6）、`WindowInfo`（Task 5）。
- Produces：

```ts
export function createVscodeCollector(deps: {
  readFile: (p: string) => Promise<string>
  appData: string
}): Collector
export function parseVscodeState(json: string, windows: WindowInfo[]): DesktopItem[]
export function createEclipseCollector(deps: {
  readFile: (p: string) => Promise<string>
  commandLineOf: (pid: number) => Promise<string | null> // Win32_Process.CommandLine，经固定 PowerShell 脚本，PID 经环境变量
}): Collector
export function parseEclipseWorkspace(
  commandLine: string | null,
  prefs: string | null
): string | null
```

VS Code：`target` 取 `folder`（`file:` URI → 本地路径）、`workspaceIdentifier.configURIPath`（URI → 本地路径）或 `vscode-remote://` 原样；只保留与当前 Code 窗口数相符的条目（取法按 Task 1 Step 3 的结论）；`exe` 取窗口的 `exe`；`bounds` 取状态文件的 `uiState`。Eclipse：`-data <路径>` 优先（只取这一个参数，不保存整串命令行）；没有时取 `<eclipse.exe 所在目录>/configuration/.settings/org.eclipse.ui.ide.prefs` 的 `RECENT_WORKSPACES` 第一项（`\n` 分隔、反斜杠转义按 Java properties 规则还原）。两者读文件只读、读完即释放（`fs.promises.readFile`）。

- [ ] **Step 1：写失败的测试**（样例用 Task 1 采到的真实文件，Eclipse 未验证时用按官方格式构造的样例并在台账注明）：`parseVscodeState` — `file:///c%3A/Users/x/proj` → `c:\Users\x\proj`、`.code-workspace` 与 `vscode-remote://` 原样、窗口数为 0 时返回空；`parseEclipseWorkspace` — `-data "C:\ws a"` 与 `-data C:\ws`、只有 prefs 时取第一项、都没有时 null。
- [ ] **Step 2：运行确认失败**：`pnpm vitest run apps/desktop/src/main/modules/desktop/collectors/vscode.test.ts apps/desktop/src/main/modules/desktop/collectors/eclipse.test.ts` → FAIL。
- [ ] **Step 3：实现**。
- [ ] **Step 4：运行确认通过**；本机开着 VS Code 时一次性调用 VS Code 采集器，输出摘录写入台账；`pnpm typecheck`、`pnpm lint` 0。
- [ ] **Step 5：提交**：`git commit -m "feat(desktop): vscode and eclipse collectors"`

### Task 8: 监控编排

> **控制者 Ruling（Task 1 结果）**：`debounceMs` 可按类别覆盖：`MonitorTimings` 增加 `debounceOverrides: Partial<Record<DesktopCollector, number>>`，vscode 为 `10_000`；测试增加「vscode 标题变化 10 秒后才采集」。

**Files:**

- Create: `apps/desktop/src/main/modules/desktop/monitor.ts`（+ `.test.ts`）

**Interfaces:**

- Consumes：`ListWindows`、`collectorOf`、`windowsSignature`（Task 5）；`Collector`（Task 6 / 7）；`LiveState`（Task 4）。
- Produces：

```ts
export interface MonitorTimings {
  pollMs: number
  debounceMs: number
  fullRefreshMs: number
  collectorTimeoutMs: number
}
export class DesktopMonitor {
  constructor(deps: {
    listWindows: ListWindows
    collectors: Collector[]
    live: LiveState
    timings: MonitorTimings
    now: () => number
    logger: Logger
    onChange: () => void
  })
  start(): void
  stop(): void
  /** 立即对全部类别完整读取一次（启动时、手动保存前） */
  refreshAll(): Promise<void>
  /** 最近一次采集失败的类别（成功后移出） */
  unreadable(): DesktopCollector[]
}
```

行为：每 `pollMs` 枚举一次窗口，`windowsSignature` 变化的类别在 `debounceMs` 后采集（同一类别正在采集时合并为一次）；每 `fullRefreshMs` 全部采集一次；采集器在 `collectorTimeoutMs` 内未完成视为失败（`LiveState.markFailed`）；同一类别连续失败只在第一次记 `warn` 日志；`LiveState.apply` 返回 true 时调用 `onChange`。`stop()` 后不再采集、不再回调。

- [ ] **Step 1：写失败的测试**（vitest 假时钟 + 假 `listWindows` / 假采集器）：标题变化只触发该类采集一次（防抖内多次变化合并）；`fullRefreshMs` 到时全部采集；**采集器失败时保留该类上一次结果**（Review Focus 2）；**连续失败只记一次日志并报告状态**（`unreadable()` 含该类，成功后移出；Review Focus 3）；超时按失败处理；**全部窗口消失后 `live.retained()` 不变、60 秒后才清空**（Review Focus 1，与 Task 4 的同名测试一起覆盖）；`stop()` 后假时钟前进不再调用采集器。
- [ ] **Step 2：运行确认失败**：`pnpm vitest run apps/desktop/src/main/modules/desktop/monitor.test.ts` → FAIL。
- [ ] **Step 3：实现**。
- [ ] **Step 4：运行确认通过**；`pnpm typecheck`、`pnpm lint` 0。
- [ ] **Step 5：提交**：`git commit -m "feat(desktop): monitor orchestration"`

### Task 9: 恢复执行

> **Task 1 实测（控制者 Ruling）**：`::{CLSID}` 位置启动 / 导航时都要写成 `shell:::{CLSID}`；新建标签后的初始位置是 `::{F874310E-B6B7-47DC-BC84-B9E6B38F5903}`（主文件夹），据此识别新标签再 `Navigate2`。可照 `.superpowers/sdd/2026-11-21-32-m3-desktop-snapshot-plan/spikes/explorer-spike.ps1`、`.superpowers/sdd/2026-11-21-32-m3-desktop-snapshot-plan/spikes/explorer-clsid.ps1`。测试 / 验证中关闭多标签窗口用 UI Automation `AutomationId = CloseButton` 的 `Invoke`（`WM_CLOSE` 与逐个 `Quit()` 对 3 个标签的窗口无效，见 `.superpowers/sdd/2026-11-21-32-m3-desktop-snapshot-plan/spikes/explorer-closetabs.ps1`）。

**Files:**

- Create: `apps/desktop/src/main/modules/desktop/restore.ts`（+ `.test.ts`）、`collectors/scripts.ts` 中追加资源管理器标签恢复脚本

**Interfaces:**

- Consumes：`DesktopSnapshotItem`、`openTargetsOf`、`DesktopRestoreResult`（Task 2）；`VfsService.stat`（`main-vfs`，带超时）；`runPowerShell`。
- Produces：

```ts
export interface RestoreDeps {
  spawnDetached: (exe: string, args: string[]) => Promise<void> // child_process.spawn，detached、stdio ignore、windowsHide false、unref；不经 shell
  runPowerShell: typeof runPowerShell
  exists: (path: string, timeoutMs: number) => Promise<'yes' | 'no' | 'unreachable'>
  sleep: (ms: number) => Promise<void>
}
export const RESTORABLE_EXE = new Set([
  'explorer.exe',
  'winword.exe',
  'excel.exe',
  'powerpnt.exe',
  'code.exe',
  'eclipse.exe'
])
export function restoreItems(
  items: DesktopSnapshotItem[],
  openTargets: Set<string>,
  deps: RestoreDeps
): Promise<DesktopRestoreResult>
```

每项：已开着 → `open`；exe 文件名不在 `RESTORABLE_EXE` → `failed`（并记 `warn`）；本地 / UNC 路径（Explorer 的每个标签、Office 文件、VS Code 本地目标、Eclipse workspace）`exists(path, 3000)`：`no` → `missing`、`unreachable` → `unreachable`（Explorer 去掉不存在的标签，全部不存在才跳过）；`::{CLSID}` 与 `vscode-remote://` 不检查。启动：Explorer 第一个标签 `explorer.exe <路径>`（`::{CLSID}` 用 `shell:::{CLSID}`），其余标签由标签恢复脚本（窗口 hwnd 与路径列表经环境变量）补上，脚本失败时对剩余标签逐个 `explorer.exe <路径>`；Office `exe [/r 仅 excel 且 readOnly] <path>`；VS Code `exe <target>`（`vscode-remote://` 用 `--folder-uri <target>`）；Eclipse `exe -data <workspace>`。项目之间 `sleep(500)`；启动抛错 → `failed`，继续下一项。

- [ ] **Step 1：写失败的测试**（假 deps 记录调用）：各类的 exe 与参数精确匹配上面的规则；已开着跳过；**stat 超时的项目跳过且不阻塞后续**（`exists` 返回 `unreachable`，后续项照常启动；Review Focus 4）；白名单外的 exe（`cmd.exe`）不启动；Explorer 一个标签不存在时只恢复其余标签；启动抛错计入 `failed` 且后续继续。
- [ ] **Step 2：运行确认失败**：`pnpm vitest run apps/desktop/src/main/modules/desktop/restore.test.ts` → FAIL。
- [ ] **Step 3：实现**（`exists` 的真实实现放 Task 10 组装：`VfsService.stat` + `Promise.race` 超时）。
- [ ] **Step 4：运行确认通过**；`pnpm typecheck`、`pnpm lint` 0。
- [ ] **Step 5：提交**：`git commit -m "feat(desktop): restore executor"`

### Task 10: 服务、IPC、组装与退出 / 关机

**Files:**

- Create: `apps/desktop/src/main/modules/desktop/desktop.service.ts`（+ `.test.ts`）、`apps/desktop/src/main/modules/desktop/desktop.ipc.ts`、`apps/desktop/src/main/modules/desktop/fake.ts`（e2e 用）
- Modify: `packages/shared/src/ipc/contract.ts`、`apps/desktop/src/main/ipc/handlers.ts`、`apps/desktop/src/main/bootstrap/container.ts`、`apps/desktop/src/main/bootstrap/bootstrap.ts`、`apps/desktop/src/main/bootstrap/shutdown.ts`、`apps/desktop/src/main/windows/window.service.ts`

**Interfaces:**

- IPC（契约）：

```ts
'desktop.list': route<DesktopSnapshotSummary[]>()(z.void()),
'desktop.get': route<DesktopSnapshot>()(z.strictObject({ id: z.number().int().positive() })),   // 不存在 → NOT_FOUND
'desktop.current': route<DesktopCurrent>()(z.void()),
'desktop.save': route<number>()(z.strictObject({ keys: z.array(z.string().max(4096)).max(500), name: z.string().max(100).nullable() })),  // 手动快照：当前现场中 key 在列表里的项目
'desktop.rename': route<void>()(z.strictObject({ id: z.number().int().positive(), name: z.string().max(100).nullable() })),
'desktop.delete': route<void>()(z.strictObject({ id: z.number().int().positive() })),
'desktop.restore': route<DesktopRestoreResult>()(z.strictObject({ snapshotId: z.number().int().positive(), itemIds: z.array(z.number().int().positive()).max(500) })),
'desktop.restorePrompt': route<DesktopSnapshot | null>()(z.void()),   // 候选快照，items 已滤掉开着的；没有可提示的 → null
'desktop.exit': route<void>()(z.strictObject({ save: z.boolean(), keys: z.array(z.string().max(4096)).max(500), dontAskAgain: z.boolean() })),
'desktop.cancelExit': route<void>()(z.void()),
```

事件：`'desktop.changed': { scope: 'current' | 'snapshots' }`；`'desktop.exitRequested': Record<string, never>`（只发给主窗口）。

- Produces（`desktop.service.ts`）：

```ts
export class DesktopService {
  constructor(deps: {
    repo: DesktopSnapshotRepo
    monitor: DesktopMonitor
    live: LiveState
    restore: (items: DesktopSnapshotItem[], open: Set<string>) => Promise<DesktopRestoreResult>
    logonAt: () => Promise<number>
    now: () => number
    emit: (e: IpcEvents['desktop.changed']) => void
    autoSaveMs: number
    keepAuto: number
    keepLogons: number
    logger: Logger
  })
  start(): Promise<void> // 取登录时刻 → 记下 restorePrompt 候选（在写任何本次快照之前）→ monitor.start + refreshAll → 写本次登录的第一份 auto → 每 autoSaveMs：retained 与本次登录最近一份 auto 不同才写，写后 prune
  restorePrompt(): Promise<DesktopSnapshot | null> // start 时记下的候选 → itemsToOffer；只返回一次（之后为 null）
  saveManual(keys: string[], name: string | null): Promise<number>
  saveExit(save: boolean, keys: string[]): Promise<void> // save → exit（勾选的项目）；否则 exit-none
  saveAutoNow(): Promise<void> // 会话结束用：立即写 retained，不比较
  stop(): void
  // 以及 list / get / current / rename / delete / restore 的转发
}
```

- 退出流程（`window.service.ts` + `bootstrap.ts`）：主窗口 `close` 事件中，若不在「已确认退出」或「会话结束」状态：
  - `desktop.askOnExit` 为 true 且渲染端存活 → `preventDefault`，发 `desktop.exitRequested`；渲染端调 `desktop.exit`（主进程执行 `saveExit`，`dontAskAgain` 时写设置 `desktop.askOnExit = false`，再标记已确认并 `close()`）或 `desktop.cancelExit`（清除挂起状态）。
  - 为 false → `preventDefault`，`saveExit(true, current() 的全部 key)` 后标记已确认并 `close()`（设计第 8 节：不再询问 = 全部保存）。
  - 渲染端已崩溃 / 销毁 → 不拦截（`shutdown.ts` 的 `before-quit` 中照常 `stop()`）。
- 会话结束：主窗口 `query-session-end` → `saveAutoNow()`（不 `preventDefault`）并进入「会话结束」状态；`session-end` → `monitor.stop()`。`shutdown.ts` 的 `before-quit` 中在 `c.db.destroy()` 之前 `c.desktop.stop()` 并等待进行中的写入。
- 会话结束期间冻结（设计 5.3）：`query-session-end` 后 `LiveState` 不再移除项目、`DesktopService` 不再自动保存，持续 `300_000` ms 后自动解除（关机被取消）。Task 10 Step 1 追加测试「query-session-end 后 5 分钟内全部消失也不写缩水的自动记录，5 分钟后恢复」；`LiveState` 增加 `freeze(untilMs: number, now: number): void`（Task 4 一并实现并测试：冻结期内 `retained` 不移除）。
- e2e 假模式（同 `PCH_E2E_FAKE_LAUNCHER` 的条件：未打包且 `PCH_E2E_FAKE_DESKTOP=1`）：`listWindows` 返回空、采集器按环境变量 `PCH_E2E_DESKTOP_ITEMS`（JSON `DesktopItem[]`，全部归 `office` 类）返回、`spawnDetached` 只记日志 `[desktop:fake] spawn <exe> <args JSON>`、`logonAt` 取 `PCH_E2E_LOGON_AT`、`exists` 恒为 `yes`。

- [ ] **Step 1：写失败的测试**（`desktop.service.test.ts`，内存库 + 假 monitor / live / 时钟）：`start` 后立即有一份本次登录的 auto；retained 不变时 `autoSaveMs` 到期不写新快照、变化后写；`restorePrompt` 在上次登录以 exit 结束时返回 exit 快照且只返回一次；`saveExit(false)` 写 `exit-none`；`saveAutoNow` 写出 retained；`stop` 后计时不再写。
- [ ] **Step 2：运行确认失败**：`pnpm vitest run apps/desktop/src/main/modules/desktop/desktop.service.test.ts` → FAIL。
- [ ] **Step 3：实现服务、IPC handler、契约、组装（container 中按平台与假模式选择依赖）、窗口关闭拦截与会话结束处理**。
- [ ] **Step 4：运行确认通过**；`pnpm typecheck`、`pnpm lint`、`pnpm build` 0；`pnpm dev` 下本机开着资源管理器与 VS Code，日志无异常，`desktop.current` 返回两类项目（手动经 DevTools 不可用，用一次性 e2e 或日志确认，结果写入台账）。
- [ ] **Step 5：提交**：`git commit -m "feat(desktop): service, ipc, exit and session-end handling"`

### Task 11: 渲染端：活动栏视图与快照页

**Files:**

- Create: `apps/desktop/src/renderer/src/data/desktop.ts`、`apps/desktop/src/renderer/src/features/desktop/{index.ts, desktop-view.tsx, snapshot-page.tsx, item-checklist.tsx, item-label.ts, item-label.test.ts}`
- Modify: `stores/ui-store.ts`（`SidebarView` 加 `'desktop'`）、`features/shell/components/activity-bar.tsx`（在 search 之后加 `{ view: 'desktop', icon: MonitorIcon, labelKey: 'desktop:title' }`）、`app/app.tsx`（`sidebarViews.desktop`、`PreviewContainer` 传 `renderDesktop`）、`features/preview/preview-container.tsx`（`kind === 'desktop'` 走 `renderDesktop(tab)`，同 `workspaces` 的写法）、`packages/i18n/src/locales/{ja,zh-CN,en}.ts`（命名空间 `desktop`）、`eslint.config.mjs`（如需）

**Interfaces:**

- Consumes：IPC `desktop.*`、事件 `desktop.changed`（Task 10）；`desktopLocation` / `desktopIdOfUri`（Task 2）；`useTabsStore.openHere`。
- Produces（`data/desktop.ts`，沿用 `data/workspace.ts` 的查询写法）：`useDesktopSnapshots()`、`useDesktopSnapshot(id: number)`、`useDesktopCurrent()`（收到 `desktop.changed` 时按 `scope` 失效对应查询）、`saveDesktop(keys, name)`、`restoreDesktop(snapshotId, itemIds)`、`renameDesktop`、`deleteDesktop`。
- Produces（`item-checklist.tsx`）：`ItemChecklist({ items: { id: string; item: DesktopItem }[]; selected: Set<string>; onChange(next: Set<string>): void })` — 按类别分组（资源管理器 / Word / Excel / PowerPoint / VS Code / Eclipse）、每组全选勾选框；对话框（Task 12）复用。
- Produces（`item-label.ts`）：`itemLabel(item: DesktopItem): { title: string; detail: string }` — Explorer：第一个标签路径 + 「（N 个标签）」（N > 1 时）；Office：文件名 + 完整路径；VS Code / Eclipse：最后一段 + 完整路径；`::{CLSID}` 显示为本地化的「特殊位置」。

界面（设计 5.7）：侧栏标题行「桌面记录」+「今すぐ保存」按钮（保存当前现场的全部项目，成功后应用消息）；第一行固定「現在」，其后为快照列表（时间、种类、「重启前」标记 = `logonAt` 与本次登录不同、项目数），右键 / 行内按钮：改名、删除（确认）；单击在当前标签打开快照页（`openHere(activeWorkspaceId, desktopLocation(id, title))`）。快照页：`ItemChecklist` + 底部按钮（快照：「選択した項目を復元」→ 结果汇总为应用消息；「現在」：「保存」）+ 采集失败的类别显示「无法读取：<类别>」+ 「SharePoint / OneDrive 上的文件不会记录」的说明文字。

- [ ] **Step 1：写失败的测试**：`item-label.test.ts` — 四类各一例、多标签 Explorer、`::{CLSID}`。
- [ ] **Step 2：运行确认失败**：`pnpm vitest run apps/desktop/src/renderer/src/features/desktop/item-label.test.ts` → FAIL。
- [ ] **Step 3：实现数据层、视图、快照页、清单、活动栏与 i18n**（三语同时加）。
- [ ] **Step 4：运行确认通过**；`pnpm typecheck`、`pnpm lint`、`pnpm build` 0；系统级截图 `node scripts/os-screenshot.mjs <out.png> light ja` 与 `dark zh-CN` 各一张（含侧栏与快照页），存 scratchpad，台账记路径。
- [ ] **Step 5：提交**：`git commit -m "feat(desktop): sidebar view and snapshot page"`

### Task 12: 渲染端：恢复对话框、退出对话框与 e2e

**Files:**

- Create: `apps/desktop/src/renderer/src/features/desktop/{restore-dialog.tsx, exit-dialog.tsx, use-desktop-dialogs.ts}`、`e2e/desktop.spec.ts`
- Modify: `features/desktop/index.ts`、`app/app.tsx`（挂载两个对话框）、三语 locales

**Interfaces:**

- Consumes：`ItemChecklist`（Task 11）；IPC `desktop.restorePrompt` / `desktop.exit` / `desktop.cancelExit`、事件 `desktop.exitRequested`（Task 10）。
- 恢复对话框：应用启动、主窗口渲染完成后调用一次 `desktop.restorePrompt`；非 null 时打开，默认全选，按钮「復元」「後で」。
- 退出对话框：收到 `desktop.exitRequested` 时打开，列出 `desktop.current` 的项目（默认全选），按钮「保存して終了」「保存しないで終了」「キャンセル」，勾选框「次回から確認しない」；关闭对话框（Esc / 点外部）= 「キャンセル」。

- [ ] **Step 1：写失败的 e2e**（`e2e/desktop.spec.ts`，`PCH_E2E_FAKE_DESKTOP=1`，用 `support.ts` 的启动方式与临时 `PCH_USER_DATA_DIR`）：
  - 「活动栏打开桌面记录，現在列出假项目，今すぐ保存后列表多一份」
  - 「上次登录以退出保存结束时，启动后提示恢复，復元只启动勾选的项目」：第一次启动（`PCH_E2E_LOGON_AT=1000`）点关闭 → 退出对话框只勾一项 →「保存して終了」；第二次启动（`PCH_E2E_LOGON_AT=2000`、`PCH_E2E_DESKTOP_ITEMS=[]`）出现恢复对话框且只有那一项 →「復元」→ 主进程日志含一行 `[desktop:fake] spawn`
  - 「保存しないで終了后下次不提示」
  - 「次回から確認しない后关闭不再弹出，且下次按全部保存提示」
  - 「キャンセル后窗口不关闭」
- [ ] **Step 2：运行确认失败**：`pnpm build && pnpm test:e2e e2e/desktop.spec.ts` → FAIL。
- [ ] **Step 3：实现两个对话框与挂载**。
- [ ] **Step 4：运行确认通过**：同上命令全部 PASS；`pnpm typecheck`、`pnpm lint`、`pnpm exec prettier --check .` 0；结束后 `Get-Process electron` 为空。
- [ ] **Step 5：提交**：`git commit -m "feat(desktop): restore prompt, exit dialog and e2e"`

### Task 13: 实机验证、文档与全量检查

**Files:**

- Modify: `doc/PremiumCowHorse-架构设计方案.md`（文首版本 v1.23 与变更摘要；第 18 节 M3 行改为「桌面记录」并注明原 M3 移到「后续」；第 11.3 节标为被取代、新增桌面记录小节（目标结构与「已实现」分开）；第 6 / 13 / 15 节补 `modules/desktop`、两张表、恢复的白名单）、`devDoc/2026-11-21-33-m3-ledger.md`、新建 `devDoc/2026-11-21-34-m3.md`（实现记录：做了什么、控制者决定、已验证 / 未验证、记录的问题）并登记 `devDoc/README.md`；`knowledge/` 中对应文件追加实施中遇到的非显而易见问题；如设置 `session.restoreOnStartup` / `window.onDetachedClose`（原 M3 的设置键）已无用途，在实现记录中列为待确认项（不删）

- [ ] **Step 1：Eclipse**：若 Task 1 Step 7 已获确认，实机运行 Eclipse 采集与恢复，结果写入台账；否则在实现记录中标「未验证」。
- [ ] **Step 2：实机端到端**（`pnpm dev`，临时 `--user-data-dir`）：开资源管理器（2 个标签）、Excel（只读）+ Word、VS Code 后「今すぐ保存」；全部关掉 → 等 1 分钟以上 → 从快照恢复，确认各项按原样打开、Excel 为只读、Explorer 标签数一致；结果与系统级截图路径写入台账。
- [ ] **Step 3：关机场景**（需求方配合或下一次真实重启时）：本应用开着直接重启，重启后打开本应用 → 恢复对话框出现且包含关机前的项目；观察日志中 `query-session-end` 的时间与各程序关闭的先后（设计第 7 节第 6 项）。做不到时实现记录标「未验证」。
- [ ] **Step 4：全量检查**：`pnpm typecheck`、`pnpm lint`、`pnpm exec prettier --check .`、`pnpm test`、`pnpm build`、`pnpm test:e2e`，退出码与条数写入实现记录；结束后 `Get-Process electron`、`PremiumCowHorse`、`EXCEL`、`WINWORD`、`POWERPNT`、`Code` 中由测试启动的进程为空。
- [ ] **Step 5：打包运行**：`pnpm dist`，解压后以 `--user-data-dir=<临时目录>` 运行，确认 koffi 枚举与 PowerShell 采集在打包版中可用（日志）。
- [ ] **Step 6：提交**：`git commit -m "docs: M3 desktop snapshot implementation record and doc v1.23"`
