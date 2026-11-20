# 缓存目录编号：执行台账（原文）

- 用途：[11 缓存目录编号](./2026-11-19-11-dir-id.md) 的附件，逐条保留执行期间的派发、审查结论、控制者裁定（`Ruling:`）与暂缓的 minor。
- 来源：`.superpowers/sdd/2026-11-19-10-dir-id-plan/` 中的 `progress.md` 与 `final-fix-wave.md`（计划完成后删除；本文件为副本，内容未改动）。

## 执行台账

```text
# SDD ledger — plan: C:/Users/yongjun.fu/Desktop/PremiumCowHorse/devDoc/2026-11-19-10-dir-id-plan.md

Setup: 分支 feat/m1-workspace（需求方允许按任务提交；分支保持现状）。Spec: design 8.6（需求方确认）+ 上一计划台账中的两条 residual。子 agent 说明与报告一律中文。

## Pre-flight
| 任务对 | 生产 → 消费 | 结论 |
| T1 → T2 | T1 改缓存表结构；T2 改调度器与文档 | 不同文件（doc 两者都改：T1 只改 13 节结构，T2 升版本），顺序执行 |
| 各任务自身 | T2 的 devDoc 文件名 `2026-11-19-10-dir-id.md` 与计划文件同号 | → Ruling 1 |
Pre-flight Ruling 1: 记录文件改用 devDoc/2026-11-19-11-dir-id.md（编号不与计划 10 重复） — cost if wrong: none
Task 1: dispatched implementer (sonnet) BASE=1f7678e
Task 1: implementer DONE a18549c (570/570, build OK, e2e 39/39) agent=a4e33d7c350af4d6e; size 75.19MB → 23.45MB (31%); search/queue fingerprints identical; removeSubtree 157→32ms, prune 2219→1250ms; AUTOINCREMENT on dirs.id (avoid id reuse; select-then-write to not burn ids); orphan parent_id adopted via adoptOrphans(); write 9.0s → 8.2–10.2s
Task 1: dispatched reviewer (opus)
Task 1: review ❌ — I1 DROP TABLE IF EXISTS sqlite_sequence errors when AUTOINCREMENT table exists (version-mismatch rebuild path dead, masked by recovery); I2 doc says CACHE_VERSION 4; deviations AUTOINCREMENT + adoptOrphans judged justified; FTS cascade verified
Task 1: minor (deferred): ensureDir double idOf; unreachable UPDATE branch in upsertDir; dangling parent_id after prune untested (consider ON DELETE SET NULL)
Task 1: fix round 1 dispatched (resumed a4e33d7c350af4d6e) FIX_BASE=a18549c (+ cheap minors: tautological FTS count assertion, created field → return value)
Task 1: fix round 1 implementer DONE a54eb7c (571/571); re-review dispatched
Task 1: fix round 1/5 (2 addressed + 2 minors, 0 open; commits a18549c..a54eb7c)
Task 1: complete (commits 1f7678e..a54eb7c, review clean after 1 fix round)
Task 2: dispatched implementer (sonnet) BASE=a54eb7c
Task 2: implementer DONE 054a92f,90ad046 (575/575, build OK, e2e 39/39) agent=ae4ac434f9b01b00d; clock rollback: negative age → not fresh / not duplicate; NOT_A_DIRECTORY → removeSubtree own cache only + forced P0 on parent (new internal force option bypassing 2s dedupe and merging); doc v1.14; devDoc 11
Task 2: dispatched reviewer (sonnet)
Task 2: implementer stopped after reporting (looping on background notification); controller verified scope: 2 commits, 5 files, clean tree (classifier unavailable notice)
Task 2: review ✅ spec, quality Approved
Task 2: minor (deferred→final review): forced parent P0 can repeat at background-gap rate when parent keeps listing the name as a directory (narrow race / enumerator mismatch); p0Done cleanup ignores negative ages; no test for root replaced by a file
Task 2: complete (commits a54eb7c..90ad046, review clean)
Final review: dispatched (opus) range 1f7678e..HEAD
Final review: With fixes — I-1 forced parent P0 on FS_NOT_A_DIRECTORY loops forever (measured: 1171 parent listings in 10 min at 500ms gap) when parent keeps listing the name as a dir (e.g. 'foo.' dir + 'foo' file); fix verified by reviewer in a copy (47 tests pass; loop → 2 listings)
Final: Ruling: fix wave = I-1 (reviewer's minimal patch + loop regression test + devDoc 11 line 73 / doc 5.2 corrections) + M-1 (nested-root parent_id flip: COALESCE) + M-2 (prune clears dangling parent_id) + M-3 (doc 13 references devDoc 11; parent_id NULL meaning) — M-1/M-2 are small regressions vs baseline — cost if wrong: none significant
Final: minor triage: p0Done negative-age cleanup → not valid; ensureDir double idOf / unreachable upsertDir branch (M-4) → deferred; root replaced by file test → add with I-1
Final: fix wave dispatched (sonnet, single fixer) FIX_BASE=90ad046
User (2026-11-19): after the fix wave, add an e2e case for nested entries (parent/child/grandchild added together; remove outer then re-add)
Final: fix wave DONE_WITH_CONCERNS bc55109 (I-1 loop 1171→≤3, M-1 COALESCE, M-2 prune clears dangling parent_id, M-3 docs); full gate: e2e 38/39 — principle test (explorer.spec.ts:111, rename ancestor) failed once; passes alone; also reproduced once on unmodified HEAD per implementer; earlier 4 HEAD runs passed
Final: controller: principle e2e failure NOT dismissed as flake → separate root-cause investigation dispatched (diagnose only); scoped re-review of fix wave dispatched in parallel
Final: fix wave re-review: I-1/M-1/M-2/M-3 all ADDRESSED, no new Critical/Important (90ad046..bc55109)
Final: principle e2e diagnosis: NOT a handle problem (holding descendants' handles blocks rename, but occupancy 0.03–0.06% at 2s, 0.004% default; 540 renames 0 failures). Real cache bug: during ancestor rename, child B gets FS_NOT_FOUND → removeMissing (5a69be0) deletes B from A's cached listing; A was mtime-checked moments earlier (fresh) and A's mtime is unchanged after rename-back → A stays "empty" forever until select/F5/re-expand. 50ms periodic gap (139920e) creates the window. Default settings: ~0.2%+ per rename-and-back, never self-heals; search also loses the subtree
Final: Ruling: fix after the fix wave (load-bearing, user-visible data loss in cache, never self-heals): on FS_NOT_FOUND also force a P0 on the parent and null the parent's dir_mtime in removeMissing so the next check fully lists it; deterministic scheduler test; knowledge entry; keep the principle e2e unchanged (it caught a real bug) — cost if wrong: one extra parent listing per not-found child
Final: not-found fix DONE c30ffd3 (582/582, build OK; principle e2e --repeat-each 10: 10/10, retries 0; full e2e run1 38/39 — 'menu: cache strategy and build index' submenu didn't open (passes 5/5 alone), run2 39/39); not-found dir row kept as 'not-found' state, repeat errors don't force parent; parent dir_mtime nulled on removal
Final: minor (deferred): menu e2e flake (submenu not opening) uninvestigated; after rename-back, search for b's subtree waits until b is re-read
Final: not-found fix review dispatched (opus)
Final: not-found fix review ✅ Approved (bc55109..c30ffd3); minors: notification assertion weakened in one test; B stays not-found after rename-back (interval → far, subtree unsearchable until reread); extra changed(parent) on real deletion; no scheduler-level test for dir_mtime-null fallback; forced P0 uses user P0 lane
Final: Ruling: fold reviewer minor 2 into the e2e task — when a parent listing lists a not-found child again, reset its checked_at to NULL so it is re-read soon (guard still prevents loops) — cost if wrong: one extra read per reappearing dir
Pending user decision: pause periodic checks only when minimized/hidden instead of when unfocused
Final: e2e + not-found re-read fix DONE ca726f9,0be869b (scoped tests: scanner cache+schedule 117, build, new e2e --repeat-each 5 all pass, principle e2e pass); full suite deferred to controller backstop
Final: review dispatched (sonnet) + controller full gate (backstop) in parallel
Final: nested e2e + re-read fix review ✅ Approved; minors: nested e2e middle steps lack entryId search asserts; s.txt search not polled; rename retry fixed 300ms; reset stmt prepared each applyListing; knowledge entry suggested; doc/ lacks the checked_at reset sentence (controller adds)
Final: controller backstop gate at 0be869b: typecheck+lint+prettier+test(584/584)+build+e2e(41/41) EXIT=0; principle retries 0; no leftovers; pch-* 14→14; 327f3f8 docs only
```

## 最终审查修复波：问题清单

```text
# 最终审查修复波（目录编号计划）

每条先写失败的测试 → 修复 → 通过；最后跑全量检查（以真实退出码判断）。

- **I-1** `apps/desktop/src/scanner/schedule/scheduler.ts:839-853`：父目录持续把某名称列为目录、而读取它本身返回 `FS_NOT_A_DIRECTORY` 时，「删除该目录缓存 → 强制父目录 P0 → 父目录列表重建该目录行（`checked_at IS NULL`）→ 后台队列立即再选中」无限循环（审查实测：本地后台休息 500ms 时 10 分钟内父目录完整读取 1171 次）。修法（审查者已在源码副本中验证，现有 47 例通过、循环降为 2 次）：第一次出错时 `removeSubtree` 后再 `setState(uri, 'unreachable', 'FS_NOT_A_DIRECTORY', now)`（行保留为错误状态、带确认时刻）再强制父目录 P0；该目录已记为 `FS_NOT_A_DIRECTORY` 时再次出错不再强制父目录，走通用错误分支（按远层间隔重试、不发通知）。补测试：上述循环场景下 10 分钟内父目录读取次数有小上限（例如 ≤ 3）；根目录被文件替换的用例。改正 `devDoc/2026-11-19-11-dir-id.md` 第 73 行与 doc 5.2 的描述。
- **M-1** `apps/desktop/src/scanner/cache/cache.ts:246-252`：`applyListing` 的自身行 UPDATE 无条件写 `parent_id`，嵌套根 `[R, R/a]` 时 `R/a.parent_id` 在 R 与 NULL 之间来回翻转。改为不以 NULL 覆盖已有值（例如 `parent_id = COALESCE(?, parent_id)`）。补测试。
- **M-2** `cache.ts:373-383`：`prune` 删除父目录后，留下的根行 `parent_id` 悬空，之后 `adoptOrphans` 不认领。在 `prune` 末尾把指向不存在行的 `parent_id` 置 NULL。补测试（根从 R 改为 R/a 再改回 R，R 的列表不再含 a 时 R/a 的子树被删除）。
- **M-3** doc 13 节「见 devDoc 10」改为 devDoc 11；补一句 `parent_id` 为 NULL 的含义（根、孤儿、父行已被清理的根）。
```
