# 缓存策略（第二版调度）：实现记录与验收

- 日期：2026-11-19
- 设计：[01 目录刷新与缓存引擎：设计](./2026-11-19-01-refresh-cache-design.md) **第 8 节**（需求方确认，取代 4.5、4.6 与 4.3 的 1 小时兜底）
- 计划：[08 缓存策略（第二版调度）：实施计划](./2026-11-19-08-cache-strategy-plan.md)
- 现状的总结：`doc/PremiumCowHorse-架构设计方案.md` v1.13 的 5.2、7.1、8.3、8.4、13、14.1、19 节
- 提交：`58e9b0a`（Task 1）、`e4c88cb` / `ecfea50`（Task 2）、`ba5bf1f` / `7640096` / `72dd6f0`（Task 3）、Task 4 的两个提交（定位时确认、文档）

## 做了什么

| Task | 内容                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 「刷新级别」改称「缓存策略」（ja「キャッシュ方針」/ zh-CN「缓存策略」/ en「Cache strategy」，级别名不变）：`RefreshLevel` → `CacheStrategy`、`WorkspaceEntry.cacheStrategy`、IPC `entry.setCacheStrategy`、迁移 0004（`refresh_level` → `cache_strategy`）、设置键 `refresh.*` → `cache.*`（库中残留的 `refresh.*` 键被忽略）                                                                                                    |
| 2    | `index.db` 的队列查询 `Cache.nextUnlisted`（从未尝试读取 = `checked_at IS NULL`，浅层优先）/ `oldestChecked`（按 `checked_at` 升序，含读取失败的）；生成列 `depth`、两个部分索引、范围大小探测 + `INDEXED BY`（`CACHE_VERSION` 3）                                                                                                                                                                                               |
| 3    | 调度器第二版：关注点 / 近 / 远三层的定期确认（`cache.interval.{focus,near,far}.*`），只有关注点完整读取；不分轮次的后台优先级队列 `schedule/background-queue.ts`（每个位置组同时 1 个、每个完成后休息 `cache.backgroundGapMs.*`、用户操作中加倍、批量候选、远层间隔内不重复确认、没有可选目录时休眠到最早到期、记住不存在的起点）；删除 1 小时兜底、按轮次的后台扫描与 `refresh.intervalSec.*` / `refresh.backgroundIntervalMin` |
| 4    | 从搜索结果定位失败时顺带确认出错的那一层目录（本文下一节）；性能数字写明测量条件；「全部」策略从空缓存补满的实测与外推；doc v1.13、knowledge                                                                                                                                                                                                                                                                                     |

## 定位时发现过时（Task 4，设计 8.3）

- `features/explorer/reveal.ts` 新增纯函数 `revealRecheckUri(nodes, index)`：定位失败（`revealProgress` 为 `failed`）时最深的已出现祖先是目录（列表没有下一段或出错）→ 确认它自身；中间段已变成文件 → 确认它所在的目录；分组 / 没有节点 → 不确认。
- `data/vfs.ts` 新增 `confirmDirectory(uri)`：只发送 `vfs.refresh([uri])`（只读确认，P0），不让查询失效——确认发现差异时扫描进程广播 `vfs.changed`，树随之重新列出、之后的搜索也不再出现已不在的项目。
- `use-reveal.ts`：`failed` 时调用上面两者，再照旧停在最深一层并提示。
- **实测中的发现（与任务简报的预想不同）**：简报预想「文件被删除 → 搜索仍能搜到 → Enter 定位失败提示 → 再次搜索不再出现」。实际上搜索与树的列表读的是同一份缓存（`index.db` 的 `entries`），缓存过时时树的列表里也还有这个文件，所以定位会**成功**选中这一行（探测：点击后 3 秒内该行一直被选中、没有任何提示），随后由已有的机制更正：展开时的 `vfs.list`（未在 2 秒内确认过则排 P0）、选中文件使其目录成为关注点（立即完整读取，此后每 5 秒）。该行消失后再次搜索不再出现。「失败」只在列表已经不含目标时发生（典型情形：搜索结果显示之后缓存才被更正——搜索结果不随 `vfs.changed` 刷新），此时缓存多半已经正确，顺带确认的作用是更正该目录中其余的过时信息。
- e2e（`e2e/search.spec.ts`）：
  - `search: revealing a deleted file corrects the cache`：测试进程删除文件 → 搜索仍搜到 → 单击定位 → 树中该行在 15 秒内消失 → 再次搜索「没有找到」。
  - `search: revealing a stale result warns and stops at its folder`：搜索结果显示后删除文件并经 `vfs.refresh` 让缓存更正（结果列表仍显示该行）→ 单击 → 「在资源树中找不到」提示，`議事録` 展开并被选中。
  - **两个用例在没有本次改动时同样通过**（已实测：还原 `use-reveal.ts` 后重新构建运行，2 passed），因为上述已有机制已经覆盖缓存的更正；它们记录的是端到端的行为（第二个用例同时覆盖了失败路径的提示与停留位置）。确认哪一个目录由 `reveal.test.ts` 的 `revealRecheckUri`、发送的内容由 `vfs.test.ts` 的 `confirmDirectory` 覆盖（都先失败后通过）；`use-reveal.ts` 在 `failed` 时调用它们的接线没有能区分效果的自动化测试（e2e 中与已有机制无法区分，`vfs.refresh` 在同一目录上 2 秒内还会去重），只经代码审阅。

## 性能

### 1. 后台队列从空缓存补满（本地，「全部」策略，Task 4 实测）

方法（一次性脚本，放在 scratchpad，测完连同目录树一起删除，不入库）：在 scratchpad 合成 10 × 10 × 100 的目录树（与 devDoc 06 相同的形状：10,111 个目录（含根）、每个叶目录 10 个文件共 100,000 个，文件名形如 `設計書_55_5_3.txt`，合成约 92 秒）。经 Playwright `_electron.launch` 启动构建产物（临时 userData），`settings.set` 把 `cache.strategy.local` 设为 `all`（第二次另把 `cache.backgroundGapMs.local` 设为下限 100），等 2 秒后 `entry.add` 该根，不展开、不选中（没有关注点，只有后台队列在工作）。每 10 秒用 node:sqlite（`readOnly`）数 `index.db` 的 `count(listed_at)`；扫描进程的 CPU 与内存取 `app.getAppMetrics()` 中 `name === 'pch-scanner'` 的项（`cpu.cumulativeCPUUsage` 之差 ÷ 经过时间 = 占单核的比例；`memory` 为 KB）。第一次运行的脚本按 `serviceName === 'pch-scanner'` 查找，在 Electron 45 中找不到（该项的 `serviceName` 是 `node.mojom.NodeService`，`name` 才是 `pch-scanner`），因此第一次的 CPU / 内存改用 PowerShell 每 10 秒采样该进程的 `TotalProcessorTime` / `WorkingSet64` / `PrivateMemorySize64`（只覆盖第 146–400 秒）。本机：Windows 11、本地 NTFS、14 个逻辑处理器；测量期间没有运行其他检查。

| 项目                          | 默认休息 0.5 秒（运行 421 秒后停止）                    | 最小休息 0.1 秒（运行到补满）                                                                        |
| ----------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 稳定速率（第 60 秒之后）      | 1.944 个目录 / 秒（第 60 秒 117 个 → 第 421 秒 819 个） | 8.93 个目录 / 秒                                                                                     |
| 每个目录的周期                | 约 514ms = 休息 500ms + 约 14ms（读取 + 写库 + 调度）   | 约 112ms = 休息 100ms + 约 12ms                                                                      |
| 补满 10,111 个目录            | **外推约 5,200 秒（约 87 分钟）**：10,111 ÷ 1.944       | **实测 1,133 秒（约 18.9 分钟）**；按同一方法外推为 10,111 × 112ms ≈ 1,132 秒，与实测一致            |
| 扫描进程 CPU（占单核）        | 约 1.4%（254 秒内 3.55 秒 CPU，PowerShell 采样）        | 平均约 5.8%（1,133 秒内 66.1 秒 CPU；10 秒采样 4.9%–10.7%），约 6.5ms CPU / 目录                     |
| 扫描进程内存                  | 工作集约 97–99MB，私有字节约 177MB（采样区间内）        | 添加条目前：工作集 86MB、私有字节 36MB；期间工作集峰值 112MB、私有字节最大 189MB                     |
| `index.db` 主文件（不含 WAL） | —                                                       | 运行中 74.9MB（devDoc 06 第一版补满后为 36MB；差异原因未调查，可能是 WAL 未检查点 / 空闲页，未确认） |

外推方法：后台队列每个本地卷同时只确认 1 个目录、每个完成后休息 `backgroundGapMs`，所以补满时间 ≈ 目录数 × (单个目录的读取与写库时间 + 休息时间)；用运行一段时间后的稳定速率（排除开头 60 秒）推算。0.1 秒的运行补满到底，实测时间与同一方法的外推一致，说明方法在本地树上成立；默认 0.5 秒下约 87 分钟属于设计预期的「慢而不打扰」（第一版按轮次不休息时约 58 秒补满，devDoc 06）。网络位置（默认休息 2 秒）按同一模型为「目录数 × (2 秒 + 读取时间)」，未实测。

### 2. 队列查询与选择成本（测量条件）

Task 2 / Task 3 与本任务的数字，统一写明条件（合成数据：`file:///C:/r{0-49}/d{0-999}/e{…}`，约 30 万个目录行）：

| 测量                                                                                               | 内存库                                                   | 文件库（WAL，`synchronous = NORMAL`）                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nextUnlisted` / `oldestChecked` 整卷、层数不限，limit 20                                          | 约 0.2ms（Task 2）                                       | 约 0.2–0.3ms（Task 2 复审；本任务 0.29ms）                                                                                                                                                       |
| `oldestChecked` 整卷、`maxDepth` 3                                                                 | 约 0.26ms（Task 2，`maxDepth` 5）                        | 0.15ms（limit 20）/ 0.24ms（limit 200）（本任务）                                                                                                                                                |
| `oldestChecked` 整卷、`maxDepth` 1（符合条件的行在 `checked_at` 顺序中稀疏，最坏）                 | 约 15ms（Task 2）                                        | 约 23–38ms（Task 2 复审）；本任务 25ms（limit 20）/ 45ms（limit 200）                                                                                                                            |
| 后台队列平摊到每次选择（`BackgroundQueue.peek` + `markChecked` + `take`，全部已确认、处于 ④ 阶段） | 层数不限 / 3 约 0.04ms，`maxDepth` 1 约 0.16ms（Task 3） | 层数不限 0.20ms、`maxDepth` 3 0.23ms；`maxDepth` 1 约 2.2ms / 次（范围内只有 51 个目录，一批取不满，每批要付一次约 45ms 的查询；选完后休眠到远层间隔，模拟 1,000 秒内合计约 1 秒 CPU）（本任务） |

本任务的文件库基准：临时 vitest 用例（未入库，已删除）在 scratchpad 建 30 万行的 `index.db`（`checked_at` 随机，全部已确认），`oldestChecked` 每种取 20 次平均；平摊成本用真实的 `BackgroundQueue`（`minAgeMs` = 120 秒）模拟 2,000 步、每步相隔 0.5 秒。`cache-schema.ts` 与 `background-queue.ts` 的注释已改为带条件的数字。

## 已验证

- 全量检查（Task 4 完成时，以真实退出码判断）：`pnpm typecheck && pnpm lint && npx prettier --check . && pnpm test && pnpm build && pnpm test:e2e` 退出码 0；vitest 48 个文件 545 个用例；e2e 39 passed（5.9 分钟；原则回归 `rename retries: 0`）。
- 定位：`revealRecheckUri` 4 个用例、`confirmDirectory` 1 个用例（先 RED：`revealRecheckUri is not a function` / `confirmDirectory is not a function`，后 GREEN）；e2e 两个新用例通过（见上，没有本次改动时也通过）。
- 「全部」策略的补满：休息 0.1 秒时补满到底（18.9 分钟），速率外推方法与实测一致；默认 0.5 秒的外推（约 87 分钟）基于 7 分钟的稳定速率。
- 目录修改时间的语义（新建 / 改名 / 删除直接子项会变；改写子文件内容、在子目录中新建不变）：本机 NTFS 用 node 实测。
- 队列查询与平摊选择成本：上表各数字均为实测，条件如表。
- 测量结束后没有残留的 `electron` / `PremiumCowHorse` 进程；`%TEMP%` 中 `pch-*` 目录数前后均为 12（合成目录树与临时 userData 放在 scratchpad，已删除）。

## 未验证

- 网络位置（UNC / 映射盘）上的全部行为与性能：本机没有可用的共享（同 devDoc 06）。
- 「全部」策略从空缓存**补满**的实际耗时（默认休息 0.5 秒）：只运行了一段时间并按速率外推（见上）。
- 目录修改时间被工具（robocopy `/DCOPY:T` 等）原样改回、FAT32 的 2 秒精度造成的漏检：只按文档与 node `utimes` 的实验推断（`knowledge/windows-and-tooling.md`），没有用这些工具实测。
- 定位失败时的 `confirmDirectory` 在 e2e 中的单独效果（见上，无法与已有机制区分）。
- 系统级截图（本任务没有界面外观改动）。
