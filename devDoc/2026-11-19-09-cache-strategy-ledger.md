# 缓存策略（第二版调度）：执行台账（原文）

- 用途：[09 缓存策略](./2026-11-19-09-cache-strategy.md) 的附件，逐条保留执行期间的派发、审查结论、控制者裁定（`Ruling:`）与暂缓的 minor。
- 来源：`.superpowers/sdd/2026-11-19-08-cache-strategy-plan/` 中的 `progress.md` 与 `final-fix-wave.md`（计划工作区为 git 忽略的临时目录，计划完成后删除；本文件为副本，内容未改动）。

## 执行台账

```text
# SDD ledger — plan: C:/Users/yongjun.fu/Desktop/PremiumCowHorse/devDoc/2026-11-19-08-cache-strategy-plan.md

Setup: 分支 feat/m1-workspace（主 checkout；需求方允许按任务提交；分支保持现状、不合并不推送）。Spec: devDoc/2026-11-19-01-refresh-cache-design.md 第 8 节（需求方 2026-11-19 确认）。执行方式：子 agent 驱动。子 agent 说明与报告一律中文。

## Pre-flight
| 任务对 | 生产 → 消费 | 结论 |
| T1 → T3 | CacheStrategy / RootConfig.strategy / cache.* 设置键；T1 暂把新键映射到旧 ScanSettings，T3 替换 | 一致 |
| T2 → T3 | Cache.nextUnlisted / oldestChecked；Scope 类型 | T2 未指明 Scope 定义位置 → Ruling 1 |
| T1、T3 | 都改 scope.ts（T1 只改名，T3 重写） | 顺序执行，无冲突 |
| T3 → T4 | 无直接接口；T4 依赖既有 vfs.refresh | 一致 |
| 各任务自身 | T3 要求「最近失败的目录以失败时刻为确认时刻」需 setState 更新 checked_at（现有 setState 是否更新未知） | 由 T3 实现者确认并在必要时修改 Cache.setState，测试覆盖 |
Pre-flight Ruling 1: Scope = { uri: string; maxDepth: number | null } 在 T2 中从 apps/desktop/src/scanner/cache/cache.ts 导出，T3 引用 — cost if wrong: 一处 import 调整
Task 1: dispatched implementer (sonnet) BASE=3bf4e43
Task 1: implementer DONE_WITH_CONCERNS 58e9b0a (519/519, build OK, e2e 37/37) agent=adec87461585f619d; interim: P1 interval now near.* (local 30s) until Task 3; 0003 test pinned to migrateTo('0003-refresh'); note: 2 empty pch-e2e-* temp dirs disappeared between checks (not deleted by plan code as far as known)
Task 1: dispatched reviewer (sonnet)
Task 1: review ✅ spec, quality Approved
Task 1: minor (deferred): leftover 'level' naming (levelName, test params, i18n levelAll keys) — compatible with unchanged level names
Task 1: complete (commits 3bf4e43..58e9b0a, review clean)
Task 2: Ruling: Scope exported from cache.ts; maxDepth relative (0 = self); nextUnlisted shallow-first; oldestChecked NULL first; pre-flight self-consistency item resolved (setState already updates checked_at)
Task 2: dispatched implementer (sonnet) BASE=58e9b0a
Task 2: implementer DONE e4c88cb (528/528) agent=adbab52acfc534915; oldestChecked = PK range + TEMP B-TREE sort (checked_at index unused); 50k rows whole volume: nextUnlisted ~10ms, oldestChecked ~13ms, maxDepth1 ~23ms
Task 2: dispatched reviewer (opus — perf/indexing judgment)
Task 2: review ❌ — I1 whole-volume queries O(rows) (file DB: 33ms@50k, 237–293ms@300k oldestChecked; 247ms nextUnlisted) → conflicts with low-power (every 0.5s); I2 [plan-mandated] never-successfully-listed dirs stay first in nextUnlisted forever, never enter oldestChecked
Task 2: Ruling: I1 adopt reviewer's A+B (checked_at partial index + size probe + INDEXED BY; depth column + (depth,uri) partial index; CACHE_VERSION+1; tests assert plan + 50k timing bound) — cost if wrong: more schema/index complexity
Task 2: Ruling: I2 "no information" redefined as "never attempted" (checked_at IS NULL) — failed dirs then join oldestChecked by failure time; refines design 8.2 wording — cost if wrong: a dir whose first attempt failed is not retried with unlisted priority
Task 2: note for Task 3: candidate batching (option C) as complement
Task 2: minor (deferred): exclude test weak; UTF-16 vs UTF-8 ordering in JS merge
Task 2: fix round 1 dispatched (resumed adbab52acfc534915) FIX_BASE=e4c88cb
Task 2: fix round 1 implementer DONE ecfea50 (531/531); generated depth column; partial indexes; probe range size <2000; worst cases 15ms (300k, maxDepth1 oldest), 6ms (subtree next) in-memory; re-review dispatched
Task 2: fix round 1/5 (2 addressed, 1 minor partially open; commits e4c88cb..ecfea50); re-reviewer verified on FILE db 300k: whole-volume null maxDepth ~0.2ms, hot subtree ~0.3–0.6ms, results identical to brute force incl. threshold 1999/2000/2001; residual: oldestChecked with small maxDepth over large range 23–38ms (sparse in checked_at order)
Task 2: Ruling: accept residual (≤~38ms worst, active steady ~23ms) in Task 2; Task 3 must batch candidates (fetch a batch, consume one by one, refetch when exhausted or scope changes) so amortized cost per selection is ≪1ms — cost if wrong: ~5–7% of one core while background queue runs in active strategy near drive root
Task 2: minor (deferred→Task 4 docs): schema comment / doc perf numbers lack measurement conditions and don't hold with maxDepth (file db 24–38ms)
Task 2: complete (commits 58e9b0a..ecfea50, 1 parked ruling)
Task 3: Ruling: uncles = siblings of parent; far tier includes current workspace folder-entry roots; busy = any interest change in last 10s; unfocused → periodic paused, background continues
Task 3: carried: candidate batching (from Task 2 ruling)
Task 3: dispatched implementer (opus) BASE=ecfea50
Task 3: implementer DONE_WITH_CONCERNS ba5bf1f (534/534, build OK, e2e 37/37, principle retries 0; mutation-checked) agent=a459e898233323952; background-queue.ts split (scheduler 889 lines); shares existing per-group background slot; batches ④=200, ①②③=50; amortized selection ≤0.16ms @300k
Task 3: Ruling: ③/④ not strictly ordered (①② first; otherwise ③ then ④ within the same batch) — strict order would starve ④ forever — cost if wrong: hot dirs revalidated slightly less often
Task 3: Ruling: background must not re-check a directory confirmed within the far-tier interval (local 2 min / network 5 min); when nothing is eligible the queue sleeps until the earliest becomes eligible — avoids endless churn on small scopes (e.g. default with a few hot dirs re-statted every ~2s) — cost if wrong: small scopes revalidate at most every 2/5 min in background
Task 3: dispatched reviewer (opus)
Task 3: review ❌ spec (ruling 6 missing: background re-checks within far interval; retryAt fixed 2s → idle polling), otherwise Approved-level quality
Task 3: Ruling: minor 3 (missing index target re-read on every scope change; FS_NOT_FOUND without cache row records nothing) regraded Important — extra network access per focus change contradicts gentle/low-load goal
Task 3: minor (deferred): fetch() mutates dirty/seeded before queries finish (exception safety); dirty branch may query twice per peek; backgroundNextAt not cleaned for removed groups; no dedicated test for "background mtime-only check doesn't postpone focus full listing"
Task 3: fix round 1 dispatched (resumed a459e898233323952) FIX_BASE=ba5bf1f
Task 3: fix round 1 implementer DONE 7640096 (539/539, build OK, e2e 37/37); re-review dispatched
Task 3: fix round 1/5 (3 addressed, 1 new Important open — group sleeps forever (retryAt=Infinity) when its only candidate is running as P0 during the query; reproduced by re-reviewer; commits ba5bf1f..7640096)
Task 3: minor (deferred): missing-target test's last assertion satisfied by F5's own P0; missing set may grow (records any not-found P0 URI without cache row)
Task 3: fix round 2 dispatched (resumed a459e898233323952) FIX_BASE=7640096
Task 3: fix round 2 implementer DONE 72dd6f0 (540/540); re-review dispatched
Task 3: fix round 2/5 (1 addressed, 0 open; commits 7640096..72dd6f0)
Task 3: minor (deferred): while a P0/probe of the group hangs until timeout, the queue re-queries the cache every 2s (bounded, index queries only)
Task 3: complete (commits ecfea50..72dd6f0, review clean after 2 fix rounds)
Task 4: Ruling: perf acceptance measures fill rate over 5–10 min and extrapolates (full fill at 0.5s gap may exceed 1h) — cost if wrong: extrapolation error
Task 4: carried: Task 2 doc perf-number conditions
Task 4: dispatched implementer (opus) BASE=72dd6f0
Task 4: implementer DONE_WITH_CONCERNS ec7883d,9dc9c61,5527951 (545/545, build OK, e2e 39/39) agent=a783597a672574976; e2e scenario differs from plan (reveal succeeds on cached deleted item then existing focus check corrects it) — new e2e pass on old code too; RED only in unit tests; perf: gap 0.1s → 18.9 min full fill (extrapolation validated), default 0.5s → ~87 min, scanner ~1.4% of one core; index.db 74.9MB vs 36MB in v1 (cause not investigated)
Task 4: dispatched reviewer (sonnet)
Task 4: review ❌ — I1 use-reveal failure wiring has no distinguishing test; I2 index.db 36MB→74.9MB uninvestigated, doc 19 stale; 22 doc facts cross-checked, all consistent
Task 4: Ruling: I1 test via hook unit test if @testing-library/react already present, else extract pure function (no new dependency); I2 investigate (page_count/freelist/dbstat, FTS optimize) and implement only simple mitigations (FTS optimize when idle, incremental auto_vacuum); otherwise document
Task 4: minor (deferred): first e2e waits 15s (flaky risk); SCANNER_THREADPOOL_SIZE and the 2s "only running" retry not cross-checked by reviewer
Task 4: fix round 1 dispatched (resumed a783597a672574976) FIX_BASE=5527951
Task 4: fix round 1 implementer DONE_WITH_CONCERNS 71b4155,0f135d0 (549/549, e2e 39/39); settleReveal pure fn (option B); index.db size cause = longer URIs (Japanese names, 9 bytes per kanji encoded; avg 77→204 chars), reproduced 37.2 vs 75.2MB; freelist tiny, VACUUM -4%, FTS optimize +4MB → no mitigation; suggestion: integer dir id (schema change); re-review dispatched
Task 4: fix round 1/5 (3 addressed, 0 open; commits 5527951..0f135d0); re-reviewer confirmed size cause with dbstat numbers (entries + PK autoindex each +~15.5MB)
Task 4: minor (deferred): docs state first-version tree dir names d0/e0/f0 as fact (reconstructed, not recorded); size increase also ~10% from longer names; hook injection line confirm: confirmDirectory not covered
Task 4: complete (commits 72dd6f0..0f135d0, review clean after 1 fix round)
Final review: dispatched (opus) range 3bf4e43..HEAD
Final review: With fixes — I1 near/far periodic tiers unbounded and ungapped: 2,000 siblings → ~33 stat/s, 5,000 → ~84 stat/s on a network host while focused; can starve background queue; recompute ~420ms at 20k siblings (simulated); not a regression (v1 same scope, 30s)
Final: Ruling: I1 fixed in the fix wave (within design intent "平缓、低负载"): cap near and far tiers at 100 each (nearest first, hot preferred; overflow left to background ④) + minimum gap between non-focus periodic checks per location group (network 200ms ≈ ≤5/s, local 50ms); tier interval becomes a lower bound under load — cost if wrong: in huge directories siblings beyond the cap refresh only via background queue
Final: fix wave includes: M1 FS_NOT_FOUND also removes the entry from the parent's cached listing (+changed(parent)); M2 test for deleted directory correction; M6 clamp future checked_at to now; M7 partial index for hot(); docs M3 M4 M5 M8 M9 + background steady-state description; test "background mtime-only check doesn't postpone focus full listing"
Final: minor triage accepted as reviewer listed (T2 UTF-16 ordering and T4 threadpool cross-check → not valid)
Final: fix wave dispatched (opus, single fixer) agent=a7cc7c04d12978690 FIX_BASE=0f135d0
User (2026-11-19): approved I1 ruling (caps 100 / gaps 200ms·50ms); requested follow-up after fix wave: replace entries.dir_uri with integer dir id (schema change, CACHE_VERSION+1, measure size/speed before/after)
Final: fix wave DONE_WITH_CONCERNS 139920e..5c985d8 (563/563, e2e 39/39, retries 0); concerns: M6 implemented as "future checked_at → eligible now" (literal "use now" would never become due); out-of-list: clock rollback also affects listNow fresh / P0 dedupe; default strategy: overflow siblings beyond cap not covered by any periodic/background mechanism (documented); caps per window (N windows × 100), rate still gated
Final: scoped re-review dispatched
Final: fix wave re-review: all ADDRESSED, no new Critical/Important (0f135d0..5c985d8); rate bound per host verified by reading (≈5/s periodic + 0.5/s background + focus)
Final: Ruling: residual — clock rollback still affects listNow fresh and P0 dedupe (negative age counts as fresh/duplicate; F5 silently ineffective up to Δ); parked (no second fix wave) and carried into the follow-up dir-id plan as a small task — cost if wrong: after a large clock rollback, F5/expand don't re-check recently checked dirs until the clock catches up
Final: Ruling: residual — FS_NOT_A_DIRECTORY uses removeMissing, so a dir replaced by a same-name file disappears from the parent listing until the parent is re-checked; parked, carried into the follow-up plan — cost if wrong: brief absence of that file in the tree
Final: minor (deferred): no test asserting focus cadence unchanged under many siblings + gate; per-window caps (W×200) duplicate childDirs per window
Final: controller gate at 5c985d8: typecheck+lint+prettier+test(563/563)+build+e2e(39/39) EXIT=0; no leftovers; pch-* 14→14
```

## 最终审查修复波：问题清单

```text
# 最终审查修复波：问题清单（控制者裁定后）

每条能自动化的都先写失败的测试 → 修复 → 通过；全部完成后跑全量检查（以真实退出码判断）。

## Important
- **I1 近 / 远层定期确认没有数量上限、没有间隔**（`apps/desktop/src/scanner/schedule/scope.ts:123-131`、`scheduler.ts:485-496`）。仿真：网络主机下关注点有 2,000 个兄弟目录时约 33 次 stat / 秒，5,000 个时约 84 次 / 秒，可饿死后台队列；2 万个兄弟时每次 recompute 约 420ms。**裁定**：
  1. 近层、远层各设上限 100（常量，写进 doc）：按离关注点的远近取，同等距离时热点目录优先、再按 URI；视口内可见的已展开目录优先保留在近层；超出上限的目录不做定期确认（留给后台队列 ④）。
  2. 每个位置组的非关注点定期确认之间设最小间隔：网络 200ms（≤ 5 次 / 秒）、本地 50ms（常量）。关注点的确认不受此限。层的间隔因此变为「下限」。
  3. 确认 recompute 的成本随上限受控（不再与兄弟目录总数成正比地逐个 `getDir`）；补测试：5,000 个兄弟目录时，稳态 stat 速率 ≤ 5 次 / 秒（网络），后台队列仍按正常速度推进；recompute 次数 / 耗时有上界（用 spy 统计 `getDir` 调用次数 ≤ 常数 × 上限）。

## 合并前一并修复的 Minor
- **M1** 目录读取得到 `FS_NOT_FOUND` 时，除删除它自身与子树外，**也从父目录的缓存列表中删除该项**并对父目录发 `changed`（`scheduler.ts:791-802`、`cache.ts`）；补测试（父目录 fresh 的情况下，搜索与树都不再出现该目录）。
- **M2** 补调度器单元测试：目录被删除后，经定位失败的确认，缓存被更正。
- **M6** 系统时钟回拨：`checkedAt > now` 时按 `now` 计算到期 / 可选时刻（后台 eligibleAt、定期项 due、`backgroundNextAt`）；补测试。
- **M7** `Cache.hot()` 的全表扫描：加部分索引（`visit_score > 0`），或缓存热点结果；`CACHE_VERSION` 如需变化则加 1。
- 补测试：「后台只比较修改时间的确认不推迟关注点的完整读取」（`scheduler.ts:715` 的行为）。

## 文档
- `doc/PremiumCowHorse-架构设计方案.md`（仍为 v1.13，在摘要中追加本修复波）：
  - 写明 I1 的上限与最小间隔；
  - 写明后台队列的稳态：范围超过「远层间隔 ÷ 休息时间」个目录时永不空闲，每台网络主机约 0.5 次 / 秒、每个本地卷约 2 次 / 秒，周期 = 目录数 × 休息时间；
  - M5：盲区说明统一为「保留到该目录成为关注点、被 P0 确认（展开且查询失效或未缓存、滚回视口、切回窗口）或 F5 为止」；
  - M8：消极根下的建立索引目标，若父目录从未被读过，要等配置变化、P0 或重启才会被发现；
  - M9：③④ 顺序的理由更新为当前机制（远层间隔内不重复确认之后，严格优先不再饿死 ④，现做法为同一批中先 ③ 后 ④）。
- `devDoc/2026-11-19-01-refresh-cache-design.md`：4.3 中「可见的已展开目录每次完整枚举」一句标注已被第 8 节取代（第二版只比较修改时间）。
- **M4**：devDoc 09 与 doc 19 节中第一版测量树的目录名 `d0/e0/f0` 改为「推定（按 devDoc 06 记录的形状还原）」。
- **M3**：`knowledge/testing.md:113-120` 中 `refresh.intervalSec.*`、「P1 暂停」的过时说法改为当前设置键与机制（保留历史说明）。
- `devDoc/2026-11-19-09-cache-strategy.md` 追加「最终审查修复」一节（问题、修法、测试）。
```
