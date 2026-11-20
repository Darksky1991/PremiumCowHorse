# 目录刷新与缓存引擎（Task 1–10 总记录）

- 日期：2026-11-19
- 里程碑：M1（插入在 M1-2 之后、M1-3 之前）
- 设计：[01 目录刷新与缓存引擎：设计](./2026-11-19-01-refresh-cache-design.md)；计划：[03 实施计划](./2026-11-19-03-refresh-cache-plan.md) 的 Task 1–10
- 分任务记录：[04 资源树：断开、缓存状态与右键菜单](./2026-11-19-04-explorer-offline-and-menu.md)（Task 8）、[05 按松手位置插入与拒绝临时文件](./2026-11-19-05-drop-position-and-temp-files.md)（Task 9）
- 现状以 [`doc/`](../doc/PremiumCowHorse-架构设计方案.md) v1.11 为准（最终审查修复见文末）；v1.9 时（5.2、6.3、7.1、7.2、8.2、8.3、13、14.1、18、19 节）
- 相关提交：`5e14c8e`..`463de5f`（Task 1–9）；Task 10：`7adadd3`（e2e）、`10604ea`（主进程 koffi 日志）与本文档所在的 docs 提交

## 目标

M1-2 用 `fs.watch` 监听已展开的目录，实测监听句柄会阻止上级目录改名 / 移动，违反「应用本身不得对文件系统产生任何影响」。改为「扫描 + 缓存」：目录列表缓存在本地 SQLite，展开时先显示缓存、后台按离关注点的远近检查；缓存同时是文件名索引，供随后的搜索项目使用。

## 做了什么（按任务）

| Task | 内容                                                                                                                                                                                                                                                                                     | 提交                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1    | koffi 原生枚举器（`scanner/enum/win32-enumerator.ts`）：`CreateFileW` + LastAccessTime = -1 + `GetFileInformationByHandleEx`，按 HIDDEN 属性判断隐藏、重解析点按链接处理；`GetFileAttributesExW` 取目录修改时间；koffi 不可用时回退 `node:fs`；`vfs/location.ts`（位置类型与并发分组键） | `5e14c8e`、`7202b65` |
| 2    | 缓存库 `index.db`（`scanner/cache/`）：`dirs` / `entries` / FTS5 trigram，差异写入、子树删除、热点计分、清理                                                                                                                                                                             | `38362a3`            |
| 3    | 范围计算 `computeScope`（4 级、关注点、视口内外、热点、建立索引）                                                                                                                                                                                                                        | `f046304`、`60cc4f9` |
| 4    | 调度器：P0 / P1 / P2、按卷 / 主机分组的并发、看门狗（没有进展的时间）、断开与退避                                                                                                                                                                                                        | `e3ada06`、`8d2ee15` |
| 5    | 扫描进程（utilityProcess）与 `ScannerClient`：zod 校验的消息、意外退出重启、降级模式、`index.db` 损坏时重建                                                                                                                                                                              | `fc7d4d2`            |
| 6    | IPC 切换：`vfs.list` 经扫描进程，`vfs.interest` / `vfs.refresh` / `vfs.cacheInfo` / `vfs.clearCache`、`vfs.reachability`；删除全部监听代码与 focusManager 设置                                                                                                                           | `bd14027`            |
| 7    | 条目级刷新级别（迁移 0003 `refresh_level`）与建立索引（`index_targets`）、扫描配置下发、URI 规范化                                                                                                                                                                                       | `7fe7392`、`1ff1ff7` |
| 8    | 断开图标与浅色缓存行、右键菜单（刷新级别、建立索引），删除「用系统应用打开」/ `system.openPath`（[04](./2026-11-19-04-explorer-offline-and-menu.md)）                                                                                                                                    | `ae12028`            |
| 9    | 按松手位置插入、拒绝临时目录下的系统拖入（[05](./2026-11-19-05-drop-position-and-temp-files.md)）                                                                                                                                                                                        | `9abcf60`、`463de5f` |
| 10   | 原则回归 e2e、主进程 koffi 状态日志、打包实测、性能记录、doc v1.9 / knowledge / README                                                                                                                                                                                                   | 见文末               |

Task 10 的改动：

- e2e `principle: renaming an ancestor of an expanded directory succeeds`（`e2e/explorer.spec.ts`）：展开 `案件\A\B\C`，看到 `c.txt` 后再等 4.5 秒（`launchFast` 把本地刷新间隔设为 2 秒，即至少 2 个间隔），由测试进程 `renameSync(A, A2)` 再改回，重复 10 次、每步间隔 300ms；单次失败允许重试一次并记入 annotation 与控制台；最后树中仍显示 `c.txt`。
- 主进程 koffi 状态日志：`vfs/location.ts` 新增 `driveTypeStatus()`，`bootstrap.ts` 启动时记 `[vfs] drive type detection: native (koffi)`，不可用时为警告并附原因。原来主进程的 koffi 回退是静默的，打包后无法从日志确认主进程中 koffi 可用（单元测试 `loads GetDriveTypeW through koffi`）。
- 文档：doc v1.9；knowledge 新增「枚举会更新目录自身的最后访问时间」「打包后的原生模块：两个进程都要确认、回退不能静默」「驱动打包后的应用（CDP）与性能记录的取数方法」，`fs.watch` 相关条目标题标注「2026-11-19 起不再使用」；README 补 `src/scanner` 与 `index.db` 的位置。

## 关键决策与理由

- 进程结构选方式二（独立扫描进程），理由见设计 4.0。
- 设计第 6 节留给实现者的取值：兜底完整枚举 1 小时、P0 去重 2 秒、`fresh` 判定 2 秒、网络 P2 停顿 200ms（本地不停顿，Task 4 审查 I1）、热点 K = 20 / 半衰期 3 天、本地合计 4 个并发、线程池 16（doc 8.3 节）。
- 原则回归用例不回退代码证明「旧实现会失败」：控制者在 M1-2 最终审查中已实测 `fs.watch` 会阻止上级目录改名（I4，`knowledge/windows-and-tooling.md`）。本任务另用一次性脚本在测试进程内对照：`fs.watch(A\B\C)` 期间 `renameSync(A, A2)` 报 `EPERM`，关闭监听后成功（`node watch-check.mjs`，scratchpad，不入库）——说明用例的做法能检出长期持有的句柄。

## 验证

### 已验证

- 全量检查：`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e`（结果见文末「Task 10 检查结果」）。
- 原则回归：上述 e2e 单独运行 1 次 + `--repeat-each 3` 3 次，共 4 次全部通过，**10 次改名均未发生重试**（`[principle] rename retries: 0`）。
- TDD：`loads GetDriveTypeW through koffi` 先失败（`TypeError: driveTypeStatus is not a function`），实现后通过。
- **打包实测**（`pnpm dist`，`ELECTRON_BUILDER_7ZIP_PATH` = `C:\Program Files\7-Zip\7z.exe`，未遇到 TVM 封锁）：`PremiumCowHorse-0.1.0-win-x64.zip`（155,560,588 B）解压到 `%TEMP%` 下的新目录；`resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node` 已由 electron-builder 自动解包（`asarUnpack` 无需另配）。一次性脚本 `dist-check.mjs`（scratchpad）以 `PremiumCowHorse.exe --user-data-dir=<临时目录> --remote-debugging-port=9333` 启动，经 `chromium.connectOverCDP` 添加条目 `案件`（含 `設計書\仕様.xlsx`、`README.md`、`.dotfile`）并展开。两次运行的结果一致：
  - main.log：`[vfs] drive type detection: native (koffi)`（主进程）、`[scanner] index …\cache\index.db, native enumeration: true`、`[scanner] ready`；没有任何 warn / error 行，没有回退警告；退出时 `[app] shutdown complete`，进程以 0 退出。
  - 树：`案件`、`設計書`、`仕様.xlsx`、`.dotfile`、`README.md`（`.dotfile` 显示 = 按属性判断隐藏，即走的是 koffi 枚举；降级模式会把它当作隐藏）；`vfs.list` 为 `fresh`；`vfs.cacheInfo` 40,960 B；退出后 `index.db` 存在（40,960 B）。
  - 页面级整窗截图已查看：标题栏、侧栏、资源树、欢迎页、状态栏布局正常。**系统级截图（窗口边框、系统绘制部分）待桌面可用时补拍**：本次会话没有交互式桌面（屏幕锁定，`CopyFromScreen` 句柄无效，`knowledge/testing.md`）。
  - 扫描进程就绪时间：第一次运行 `[app] starting` → `[scanner] ready` 约 9.0 秒，第二次约 2.2 秒（推测首次含杀毒软件扫描，未验证；与 Task 5 记录的约 3 秒一致）。就绪前的请求在消息队列中等待，窗口照常显示。
  - 结束后 `Get-Process electron, PremiumCowHorse` 无残留；解压目录与临时 userData 已删除。
- **性能记录（本地）**：一次性脚本 `perf-scan.mjs`（scratchpad），命令 `node perf-scan.mjs <仓库根目录>`（需先 `pnpm build`）。在 `%TEMP%\pch-perf-*` 合成 10 × 10 × 100 的目录树：10,110 个目录（含根 10,111 个），每个叶目录 10 个文件共 100,000 个（文件名形如 `設計書_55_5_3.txt`，内容 1 字节）。经 Playwright 启动构建产物（临时 userData），`settings.set` 把 `refresh.defaultLevel.local` 设为 `all` 后 `entry.add` 该根，每 250ms 用 node:sqlite（`readOnly`）读 `index.db` 的 `count(*) FROM dirs WHERE listed_at IS NOT NULL`、用 `app.getAppMetrics()` 取 `pch-scanner` 的内存，直到 10,111 个目录都列出过。测完删除目录树（`removed … true`）。

  | 项目                                                      | 第 1 次                                                | 第 2 次                                                |
  | --------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
  | 合成目录树耗时（参考）                                    | 76.9 秒                                                | 77.1 秒                                                |
  | 「全部」级别首轮扫描（entry.add → 10,111 个目录都已枚举） | 58.3 秒（约 5.8ms / 目录，按卷串行）                   | 57.5 秒                                                |
  | 缓存的条目数                                              | 110,110（10 万文件 + 10,110 目录）                     | 110,110                                                |
  | 扫描进程工作集：扫描前 → 峰值（`peakWorkingSetSize`）     | 86,020 KB → 148,120 KB                                 | 86,004 KB → 153,552 KB                                 |
  | 扫描进程私有字节（采样最大）                              | 224,312 KB（扫描前 36,352 KB）                         | 233,728 KB（扫描前 35,952 KB）                         |
  | `index.db` 大小（运行中 / 退出后）                        | 36,184,064 B + WAL 5,236,552 B / 36,225,024 B（WAL 0） | 36,061,184 B + WAL 5,281,872 B / 36,225,024 B（WAL 0） |
  | FTS5 trigram 抽查（`"設計書_55_5"`）                      | 110 条                                                 | 110 条                                                 |

  首轮扫描期间 P2 每个本地卷同时只有 1 个检查、不停顿（doc 8.3 节），所以耗时近似「目录数 × 单次枚举 + 写库」。窗口与主进程不参与枚举与写库。

### 未验证

- **网络位置（UNC）**：本机 `net share` 只有 `IPC$`，`\\localhost\C$` 不可访问（`Test-Path` 为 False）。按规定不新建共享、不改系统设置，因此 UNC 上的 koffi 枚举、访问时间保护（LastAccessTime = -1 是否被服务器遵守）、性能、Windows SMB 客户端约 10 秒的目录缓存的影响、DFS 命名空间的分组**均未验证**。映射网络盘的识别（`GetDriveTypeW` 返回 `DRIVE_REMOTE`）在本机没有映射盘，只有单元测试。
- 网络上的大目录一次枚举持有句柄的时长（可能长于本地的毫秒级），以及期间上级目录改名失败的概率。
- 真实的窗口焦点切换（Alt+Tab）：e2e 直接触发 BrowserWindow 的 `focus` / `blur`。
- 真实的共享断开：e2e 用注入的 `vfs.reachability` 事件验证断开图标；断开判定与退避只有单元测试。
- 从系统资源管理器真实拖入（含 zip 内的虚拟文件）：需要真实的系统拖放（设计第 7 节第 10 条）。
- 系统级整窗截图（见上）。
- Playwright `_electron.launch` 能否驱动打包版（Fuses 关闭了 Node 的 inspect 参数）：未试，改用 CDP。

## 待需求方确认

见设计 [01](./2026-11-19-01-refresh-cache-design.md) 第 7 节「待需求方确认」的 11 条（需求方睡眠期间由控制者按建议推进）。其中需要需求方明确回答或协助的：

- 第 6 条：拿不到写属性权限时（系统盘根目录、只读共享）回退普通枚举、目录的访问时间会被系统更新——是否可以接受；不能接受时网络位置的「全部」与「建立索引」需要加限制或提示。
  - **已决定（2026-11-19）**：全部位置去掉访问时间保护，读目录一律只读打开；原则改为新表述。见「去掉访问时间保护」。
- 第 10 条：拒绝临时文件拖入的实机试验（dragover 能否区分虚拟文件、Chromium 副本目录的规律），需要需求方用真实拖放协助；在此之前拒绝 `%TEMP%` 下的全部系统拖入路径。
- 第 9 条：全局默认级别与刷新间隔暂无界面（M5）。
- 其余各条（超时计法、断开单位、视口内外、P0 专用并发、隐藏判定、只调度当前工作区、保留的右键菜单项、搜索界面）按设计实现，请一并过目。
- **I5（最终审查新增）**：为保护访问时间，目录以 `FILE_WRITE_ATTRIBUTES` 打开（只把句柄的 LastAccessTime 设为 -1，不写入任何属性）。在开启了对象访问审核（SACL）的文件服务器上会留下 WriteAttributes 的审核记录，部分 EDR / NAS 可能视为可疑。候选：网络位置默认用只读句柄（网络上的访问时间不受保护）、或按位置可设置。目前未改变行为（doc 7.1 已知限制）。
  - **已决定（2026-11-19）**：不再以写属性打开，I5 消除。见「去掉访问时间保护」。

## 遗留事项

- 映射盘符转 UNC（`WNetGetConnectionW`，koffi 已引入）；映射盘按盘符各自成组，同一服务器的两个映射盘被视为两台主机。
- 窗口初始的焦点状态不下发（doc 7.1 已知限制）。
- 刷新级别 / 间隔 / 超时的全局设置界面、缓存占用与清空的界面（M5）。
- 文件名搜索界面（下一个项目，设计 [02](./2026-11-19-02-search-design.md)）。
- 渲染端「最后更新」提示只有单元测试（`knowledge/testing.md`）。

## Task 10 检查结果

在 `10604ea` 的代码 + 本次文档改动上运行 `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e`，退出码 0：

- typecheck、lint：通过（无输出错误）。
- vitest：`Test Files 37 passed (37)`、`Tests 418 passed (418)`。
- build：通过。
- e2e：`30 passed (4.5m)`；其中 `principle: renaming an ancestor of an expanded directory succeeds` 通过，`[principle] rename retries: 0`。
- 结束后 `Get-Process electron, PremiumCowHorse` 无残留进程。

## 最终审查修复（2026-11-19）

全分支最终审查后的一轮修复（问题清单与控制者裁定见 `.superpowers/sdd/2026-11-19-03-refresh-cache-plan/final-fix-wave.md`）。每条能自动化的问题都先写失败的测试，看到失败后再修复。

| 问题                                                    | 修法                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 测试                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1 错误分类过宽，整卷 / 整共享被误判断开                | `win32-enumerator.ts`：只有确定的网络 / 设备不可用类 Win32 错误码（`UNAVAILABLE_ERRORS`：15、21、51、53、55、59、64、67、121、1167、1201、1222、1225、1231、1232、1236、1256、2250，含义按 Microsoft Learn「System Error Codes」逐个核对）映射为 `FS_UNAVAILABLE`，其余为 `UNKNOWN`（目录记 unreachable、按 P2 间隔重试）；以写属性打开失败时，除 2 / 3 与上述错误码外都退回只读打开；87 只在第一批、且 `GetFileAttributesExW` 确认目标不是目录时才映射为 `FS_NOT_A_DIRECTORY`。调度器维持「枚举中途收到 `FS_UNAVAILABLE` 也判断开」（控制者裁定：它已收窄为确定的网络 / 设备错误），注释同步 | `win32-enumerator.test.ts`：注入错误码（网络 / 设备码 → `FS_UNAVAILABLE` 且不再只读重试；31 / 32 / 1117 → `UNKNOWN`）、写属性打开返回 50 时退回只读、87 在第二批 / 目标是目录时为 `UNKNOWN`；`scheduler.test.ts`：`UNKNOWN` 只把该目录记 unreachable、共享不断开 |
| I2 断开状态在扫描进程重启 / 降级 / 渲染端重新加载后失真 | `ScannerClient` 随 `reachability` 消息维护断开集合，`onExit`（将重启）与 `giveUp`（降级）时对每个断开的共享发出 `online` 并清空；新增 IPC `vfs.offlineShares {} → { share, since }[]`（契约 → `vfs.ipc.ts` → 渲染端）；`features/shell/use-reachability-events.ts` 的 `startReachabilitySync` 先订阅再查询初始化，查询返回前已收到事件的共享以事件为准                                                                                                                                                                                                                                        | `scanner-client.test.ts`（集合维护、重启 / 降级时发出 online）、`vfs.ipc.test.ts`、`use-reachability-events.test.ts`（初始化、事件优先、停止后忽略迟到结果）                                                                                                     |
| I3 每次检测到变化都多一次完整枚举                       | 二选一中选「`listNow` 在 fresh（2 秒内检查过）时不再 `requestP0`」：只改 `listNow` 一处，fresh 的含义（刚确认过）与行为一致；另一方案（任何检查完成都写去重时刻）会同时影响关注点变化、回到视口、重新聚焦等 P0（它们有意做完整枚举），回归面更大                                                                                                                                                                                                                                                                                                                                              | `scheduler.test.ts`：`a listNow right after a P1 check found a change does not enumerate again`；P0 去重用例改为先等 3 秒（listNow 返回 cached 才排 P0）                                                                                                         |
| I4 `removeSubtreeRows` 全表扫描                         | `cache.ts` 新增 `subtreeCondition(column, uris)`（范围比较，走主键索引），子树删除与 `search.ts` 的范围条件共用这一份                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `cache.test.ts`：驱动器根子树删除、`EXPLAIN QUERY PLAN` 断言两条 DELETE 都 `USING ... INDEX` 且没有 `SCAN`（既有的同前缀兄弟用例保留）                                                                                                                           |
| M1 测试临时目录泄漏                                     | 打开数据库的测试在 `afterEach` / `finally` 中关闭连接；`rmSync` 加 `maxRetries: 10, retryDelay: 100`；e2e 用 `support.ts` 的 `removeDirs` 逐个删除（一个失败不影响其余，最后汇总报错）                                                                                                                                                                                                                                                                                                                                                                                                        | 跑完全部测试后对比 `%TEMP%` 的 `pch-*` 目录（见报告）                                                                                                                                                                                                            |
| T5 shutdown                                             | `scanner/main.ts`：dispose / close 用 try/finally，任一步抛错仍关闭缓存库并 `exit(0)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `main.test.ts` 两个用例（dispose 抛错、close 抛错）                                                                                                                                                                                                              |
| M2 客户端兜底超时                                       | 60 秒兜底超时改为 `FS_TIMEOUT`；`vfs.ipc.ts` 只在 `available=false` 与 `INDEX_UNAVAILABLE` 时回退直接枚举                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `scanner-client.test.ts`、`vfs.ipc.test.ts`                                                                                                                                                                                                                      |
| M5 恢复在线后刷新状态                                   | `lib/query-client.ts`：`vfs.reachability` 为 `online` 时让该共享 / 卷下的目录查询失效                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `query-client.test.ts`                                                                                                                                                                                                                                           |
| M7 通配符与代理对                                       | `globToRegExp` / `globToGroupedRegExp` 加 `u` 标志（转义的字符全是语法字符，u 模式下合法）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `query.test.ts`：`𠮷` 与 `?`、高亮下标                                                                                                                                                                                                                           |

检查结果与 RED / GREEN 证据见 `.superpowers/sdd/2026-11-19-03-refresh-cache-plan/final-fix-wave-report.md`。

## 去掉访问时间保护（2026-11-19）

- **原因**：需求方决定。以写属性打开目录会在开启访问审核的文件服务器上留下 WriteAttributes 记录，安全软件可能视为可疑；UNC 上访问时间早已被他人不断更新，保护没有意义；变化检测用目录的修改时间（LastWriteTime），与访问时间无关，「没变就跳过」的机制不受影响。原则同时改为：「应用不变动文件和目录的数据：不写入、不新建、不删除、不移动、不改名，不长期持有句柄（不能妨碍用户改名或移动）。读取时由系统自动更新的元数据（如访问时间）不在此列。」
- **改了什么**：`scanner/enum/win32-enumerator.ts` 只以 `FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES` 打开目录；删除 `FILE_WRITE_ATTRIBUTES`、`createWin32Enumerator` 不再接收 `log` 参数（无日志可记）、`SetFileInformationByHandle` 的声明与调用（`protectAccessTime`）、`warnUnprotected` 与「每个位置只记一次」的状态、写属性打开失败后的只读回退（`isFinalOpenError`、`writable`）。`UNAVAILABLE_ERRORS` 与 87 的处理不变，句柄仍在 `finally` 中关闭。文档：CLAUDE.md、doc v1.12、knowledge、本设计与记录文档同步。
- **测试**：删除 `does not update the directory's last access time`（只为访问时间保护存在）、`falls back to a read-only handle where attributes cannot be written, logging once`、`falls back to a read-only handle when the write-attributes open fails with another refusal`、`closes the handle when protecting the access time fails in koffi`（保护调用已不存在）。新增 `opens directories without requesting write access`（用注入的 CreateFileW 断言访问掩码不含 `0x0100` 与 FILE_ADD_FILE）、`lists a directory on which the current user is denied write-attributes`（icacls 拒绝 WA 时照常枚举、不记日志）、`closes the handle when the first enumeration call fails in koffi`（出错路径关闭句柄）。其余用例不变。
