# 缓存策略（第二版调度）：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把扫描调度从「单一刷新间隔 + 按轮次的后台扫描 + 1 小时兜底」改为「关注点周边按远近分层定期确认 + 不分轮次的后台优先级队列」，缓存不设过期，并把「刷新级别」改称「缓存策略」。

**Architecture:** 扫描进程的 `scope.ts` 产出分层的定期确认对象（关注点 / 近 / 远）与后台队列的范围描述；`scheduler.ts` 按层的间隔做定期确认，后台队列每次从 `index.db` 按优先级选出下一个目录（没有信息的优先，其次最久没确认的），平缓地一次一个。

**Tech Stack:** 同上一计划（Electron 45、`node:sqlite`、koffi、zod 4、React 19、Vitest、Playwright）。

**Spec:** [`devDoc/2026-11-19-01-refresh-cache-design.md`](./2026-11-19-01-refresh-cache-design.md) **第 8 节**（取代 4.5、4.6 与 4.3 的 1 小时兜底；其余章节仍有效）。现状：`doc/` v1.12，上一计划 [03](./2026-11-19-03-refresh-cache-plan.md) 已全部实现。

## Global Constraints

- 文件系统原则（`CLAUDE.md`）：应用不变动文件和目录的数据：不写入、不新建、不删除、不移动、不改名，不长期持有句柄（不能妨碍用户改名或移动）。读取时由系统自动更新的元数据（如访问时间）不在此列。
- 缓存不设过期 / 失效时间；只在发现信息错误时更新或删除。删除 `LIST_MAX_AGE_MS`（1 小时兜底）与按轮次的后台扫描。
- 名称：「缓存策略」——ja「キャッシュ方針」、zh-CN「缓存策略」、en「Cache strategy」；级别名不变（ja「すべて / 積極 / 標準 / 控えめ」、zh-CN「全部 / 积极 / 默认 / 消极」、en「All / Active / Default / Passive」）。
- 标识符改名：`RefreshLevel` → `CacheStrategy`，`REFRESH_LEVELS` → `CACHE_STRATEGIES`，`WorkspaceEntry.refreshLevel` → `cacheStrategy`，`RootConfig.level` → `strategy`，IPC `entry.setRefreshLevel { level }` → `entry.setCacheStrategy { strategy }`，数据库列 `workspace_entries.refresh_level` → `cache_strategy`（新迁移 `0004`，SQLite `ALTER TABLE … RENAME COLUMN`；已发布迁移不得修改）。
- 设置键（`packages/shared/src/settings/schema.ts`，删除全部 `refresh.*` 键）：
  - `cache.strategy.local` = `active`，`cache.strategy.network` = `default`
  - `cache.activeDepth` = 3（1–10）
  - `cache.interval.focus.local` = 5（≥2），`cache.interval.focus.network` = 10（≥10）
  - `cache.interval.near.local` = 30（≥2），`cache.interval.near.network` = 60（≥10）
  - `cache.interval.far.local` = 120（≥2），`cache.interval.far.network` = 300（≥10）
  - `cache.backgroundGapMs.local` = 500（≥100），`cache.backgroundGapMs.network` = 2000（≥500）
  - `vfs.timeoutSec.*` 不变
- 分层（设计 8.2）：关注点 = 选中目录（选中文件时为其目录），每次完整读取；近 = 父、子、兄弟目录与视口内可见的已展开目录；远 = 祖父以上的祖先、叔伯目录、滚出视口的已展开目录、当前工作区各条目的根目录；近 / 远 先比较修改时间、变了才完整读取。「消极」只有关注点一层，「默认」及以上三层。所有窗口失焦时定期确认暂停，重新获得焦点时立即确认关注点。
- 后台队列（设计 8.2）：每个位置组（本地按卷、网络按主机）后台同时 1 个；每个完成后休息 `backgroundGapMs`；「用户正在操作」（最近 10 秒内有 interest 变化）时休息加倍；窗口失焦照常进行。优先级：①「建立索引」子树内没有信息的目录 → ②策略范围内没有信息的目录 → ③热点目录中最久没确认的 → ④其余范围内最久没确认的。范围：消极 = 建立索引；默认 = + 热点；积极 = + 关注点上下 `activeDepth` 层；全部 = + 根条目下所有目录。没有信息的完整读取，其余比较修改时间。
- 不变的部分：P0（用户动作）通道、2 秒去重、超时看门狗、断开 / 退避、并发与线程池上限、错误分类。
- 三语文案同时添加；结构变化同一提交更新 `doc/`（版本号在最后一个任务升为 v1.13）。

## Review Focus

1. 「全部」策略的根是整个驱动器 / 大型 NAS（数十万目录）：后台队列选下一个目录不能把整棵树载入内存，也不能每次全表扫描（需要索引）。→ Task 2 测试 `nextUnlisted and oldestChecked use indexes`（`EXPLAIN QUERY PLAN`）与 Task 3 测试 `background selection does not materialize the whole tree`。
2. 用户一直在操作（interest 频繁变化）：后台队列不能停，只能变慢。→ Task 3 测试 `background keeps going while the user is busy, with doubled gaps`。
3. 某个目录反复出错（拒绝访问、超时）：不能因为「最久没确认」排序而被队列反复立即重试、饿死其他目录。→ Task 3 测试 `a failing directory is not retried before others` 。
4. 旧数据：`refresh_level` 已有值的条目、`settings` 表中残留的 `refresh.*` 键 → 迁移后保留级别、旧设置键被忽略不报错。→ Task 1 测试。
5. 搜索结果定位时目录已被删除 → 缓存被更正（该目录被确认），不再搜到。→ Task 4 e2e。

---

### Task 1: 改名为「缓存策略」并更换设置键

**Files:** `packages/shared/src/{scanner/types.ts, settings/schema.ts, workspace/*.ts, ipc/contract.ts}`、`apps/desktop/src/main/infra/db/{migrations/0004-cache-strategy.ts, migrations/index.ts, schema.ts}`、`apps/desktop/src/main/modules/workspace/*`、`apps/desktop/src/main/vfs/scanner-config.ts`、`apps/desktop/src/scanner/schedule/scope.ts`（仅改名）、渲染端 `data/entries.ts`、`features/explorer/{menu-items.ts, node-context-menu.tsx}`、三语资源、相关测试、`e2e/*.spec.ts`

**Interfaces:**

- Produces：`CacheStrategy`、`CACHE_STRATEGIES`、`WorkspaceEntry.cacheStrategy`、`RootConfig.strategy`、IPC `entry.setCacheStrategy { workspaceId, entryId, strategy: CacheStrategy | null } → WorkspaceEntry`、Global Constraints 中的全部 `cache.*` 设置键（本任务只定义键；`ScanSettings` 的新字段与使用在 Task 3）。
- 本任务**不改变调度行为**：`buildScannerConfig` 暂把新键映射到现有 `ScanSettings`（`intervalSec` 取 `cache.interval.near.*`，`backgroundIntervalMin` 暂保留为常量 10），Task 3 再替换。

- [ ] **Step 1: 写失败的测试**：迁移 0004 后旧数据的 `refresh_level` 值出现在 `cache_strategy`；`entry.setCacheStrategy` 写入 / 清除 / 拒绝分组；设置约束（`cache.interval.focus.network` 拒绝 9、`cache.interval.focus.local` 拒绝 1、`cache.backgroundGapMs.network` 拒绝 499）；`resolveSettings` 遇到残留的 `refresh.defaultLevel.local` 键不报错且被忽略。
- [ ] **Step 2–4:** 失败 → 实现（全仓库改名，`grep -rn "refreshLevel\|RefreshLevel\|REFRESH_LEVELS\|refresh_level\|setRefreshLevel\|refresh\\.defaultLevel\|refresh\\.intervalSec\|refresh\\.activeDepth\|refresh\\.backgroundIntervalMin"` 在 `apps packages e2e` 中无产品代码残留；i18n 键名同步改为 cacheStrategy 系）→ `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e`。
- [ ] **Step 5: 提交** `refactor: rename refresh levels to cache strategies`

### Task 2: 缓存的队列查询

**Files:** `apps/desktop/src/scanner/cache/{cache.ts, cache-schema.ts}`、`cache.test.ts`

**Interfaces:**

- Produces（`Cache` 新方法；`scope` 为 `{ uri: string; maxDepth: number | null }[]`，`maxDepth` 相对 `uri` 的层数）：
  ```ts
  nextUnlisted(scopes: Scope[], limit: number, exclude?: Set<string>): string[]   // listed_at IS NULL，按 uri 排序（由上而下）
  oldestChecked(scopes: Scope[], limit: number, exclude?: Set<string>): string[]  // listed_at 不为 NULL，按 checked_at 升序
  ```
- `dirs` 增加索引：`(listed_at)` 或部分索引、`(checked_at)`；层数用 URI 中 `/` 的个数差计算（或新增 `depth` 列——实现者决定，`CACHE_VERSION` 加 1，旧缓存删除重建）。范围条件复用 `subtreeCondition`。
- [ ] **Step 1: 写失败的测试**：`nextUnlisted` 只返回范围内、未完整读取过的目录且由上而下；`maxDepth` 生效；`oldestChecked` 按确认时刻升序；`exclude` 生效；同前缀兄弟不在范围内；`nextUnlisted and oldestChecked use indexes`（`EXPLAIN QUERY PLAN` 不出现对 `dirs` 的全表 `SCAN`）。
- [ ] **Step 2–4:** 失败 → 实现 → `vitest run src/scanner/cache` 通过；全量 `pnpm typecheck && pnpm lint && pnpm test`。
- [ ] **Step 5: 提交** `feat(scanner): select queued directories from the cache by priority`

### Task 3: 分层定期确认与后台优先级队列

**Files:** `apps/desktop/src/scanner/schedule/{scope.ts, scheduler.ts}` 与测试、`packages/shared/src/scanner/types.ts`（`ScanSettings`）、`apps/desktop/src/main/vfs/scanner-config.ts`（新设置映射）

**Interfaces:**

- `ScanSettings` 改为：`{ interval: { focus: Pair; near: Pair; far: Pair }; backgroundGapMs: Pair; timeoutSec: Pair; activeDepth: number }`，`Pair = { local: number; network: number }`（秒 / 毫秒以键名为准）。
- `computeScope(input) → { periodic: { uri: string; tier: 'focus' | 'near' | 'far'; full: boolean }[]; background: { indexTargets: Scope[]; hot: string[]; ranges: Scope[] } }`：分层规则见 Global Constraints；同一 URI 取更近的层；`background.ranges` = 积极的上下 N 层范围与全部策略的根（`maxDepth: null`）。
- 调度器：删除 `LIST_MAX_AGE_MS`、P2 轮次、`frontier` 游走与相关状态；定期确认按层间隔；后台队列按 Global Constraints 的优先级每次取一个（`nextUnlisted` / `oldestChecked` 各取少量候选，排除正在进行 / 处于断开共享 / 最近失败的目录），每个位置组后台同时 1 个，完成后休息 `backgroundGapMs`（忙时加倍）。最近失败的目录（错误状态）在 `oldestChecked` 中以失败时刻为确认时刻，不会被立即重选（Review Focus 3）。
- [ ] **Step 1: 写失败的测试**（假 Enumerator + 内存 Cache + 注入时钟）：
  - `focus is fully enumerated every focus interval`；`near and far use mtime and their own intervals`；`passive only checks the focus`；`periodic checks pause while every window is unfocused and the focus is checked on refocus`
  - `background prefers unlisted index targets, then unlisted scope, then hot, then oldest`
  - `background runs one directory at a time per location group and rests backgroundGapMs between`
  - `background keeps going while the user is busy, with doubled gaps`（Review Focus 2）
  - `a failing directory is not retried before others`（Review Focus 3）
  - `background selection does not materialize the whole tree`（Review Focus 1：5 万个目录的缓存，候选查询的 limit 生效，内存中队列长度 ≤ 常数）
  - `no directory is re-enumerated only because time has passed`（删除 1 小时兜底后，修改时间不变的目录永远只比较修改时间）
  - 现有的 P0、超时、断开、并发、线程池用例保持通过
- [ ] **Step 2–4:** 失败 → 实现 → `vitest run src/scanner` 通过；全量 `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e`（e2e 中把 `refresh.intervalSec.local` 的设置改为 `cache.interval.*.local` = 2）。
- [ ] **Step 5: 提交** `feat(scanner): check by distance and fill the cache from a gentle priority queue`

### Task 4: 定位时发现过时、文档与验收

**Files:** `apps/desktop/src/renderer/src/features/explorer/use-reveal.ts`（或定位失败处）、`e2e/search.spec.ts`、`doc/PremiumCowHorse-架构设计方案.md`（v1.13）、`devDoc/2026-11-19-09-cache-strategy.md`（新建并登记）、`knowledge/`

- 从搜索结果定位时，若某一层目录不存在或目标不在列表中，对出错的那一层目录调用 `vfs.refresh([uri])`，让缓存被更正（设计 8.3）。
- [ ] **Step 1: 写失败的 e2e** `search: revealing a deleted file corrects the cache`：建文件 → 等待被缓存 → 由测试进程删除该文件 → 搜索仍能搜到（缓存过时，允许）→ Enter 定位失败提示 → 再次搜索不再出现该文件。
- [ ] **Step 2–3:** 失败 → 实现 → 通过。
- [ ] **Step 4: 文档**：doc v1.13（文首版本号与摘要；7.1 / 8.3 / 13 / 14.1 / 19 节改为第二版调度与新名称、新设置键）；devDoc 09（做了什么、已验证 / 未验证）；knowledge（目录修改时间的语义与盲区、队列选择的索引）。
- [ ] **Step 5: 验收**：`pnpm typecheck && pnpm lint && npx prettier --check . && pnpm test && pnpm build && pnpm test:e2e`（以真实退出码判断）；性能记录：1 万目录 / 10 万文件的本地树在「全部」策略下，后台队列从空缓存补满所需时间与期间扫描进程的 CPU / 内存（写入 devDoc，脚本不入库）；残留进程与 `%TEMP%` 的 `pch-*` 数量前后对比。
- [ ] **Step 6: 提交** `fix(explorer): refresh the cache when a revealed item is gone`、`docs: document the cache strategies`
