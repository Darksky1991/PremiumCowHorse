# 刷新与缓存引擎 + 文件名搜索：执行台账（原文）

- 用途：[06 刷新与缓存引擎](./2026-11-19-06-refresh-cache.md) 与 [07 文件名搜索](./2026-11-19-07-search.md) 的附件，逐条保留子 agent 驱动执行期间的派发、审查结论、控制者裁定（`Ruling:`）与暂缓的 minor。
- 来源：`.superpowers/sdd/2026-11-19-03-refresh-cache-plan/` 中的 `progress.md` 与 `final-fix-wave.md`（计划工作区为 git 忽略的临时目录，计划完成后删除；本文件为副本，内容未改动）。
- 台账为执行过程的速记，中英混写；其中的「agent=…」是当时的子 agent 标识，无需关注。

## 执行台账

```text
# SDD ledger — plan: C:/Users/yongjun.fu/Desktop/PremiumCowHorse/devDoc/2026-11-19-03-refresh-cache-plan.md

Setup: 分支 feat/m1-workspace（主 checkout，无 worktree；需求方已允许按任务提交）。Spec: devDoc/2026-11-19-01-refresh-cache-design.md（第 7 节为控制者决定，待需求方确认）+ devDoc/2026-11-19-02-search-design.md（全部待确认）。需求方睡前授权「先按建议推进，醒来再确认」，并以 /goal 表示要完成引擎与搜索界面。子 agent 说明与报告一律中文。

## Pre-flight
| 任务对 | 生产 → 消费 | 结论 |
| T1 → T4/T5/T7 | Enumerator（statDir/list/location/shareKey/hostKey） | T7 要求位置判断放在主进程与扫描进程共用之处，与 T1 放在 scanner/enum 冲突 → Ruling 1 |
| T2 → T3/T4/T11 | Cache（childDirs/hot/visit/applyListing/entries_fts） | 一致 |
| T3 → T4/T5/T7 | RootConfig、RefreshLevel（shared/scanner/types.ts） | 一致 |
| T4 → T5/T6 | DirectoryListing（shared）、Scheduler API | 一致 |
| T5 → T6/T7/T11 | ScannerClient、protocol、ScannerConfig | 一致（T11 追加 search 消息） |
| T6 → T8 | reachability-store、DirectoryState.state/checkedAt | 一致 |
| T6、T9 | 都改 drag/explorer 相关？T6 改 explorer-tree（interest），T9 改 drag-drop/use-drop-executor | 不同文件，顺序执行 |
| T7 → T8 | entry.setRefreshLevel / index.setTarget / index.list | 一致 |
| T6 → T12 | explorer-tree.tsx（T12 消费 reveal） | 顺序执行 |
| 各任务自身 | T10 Step 1 要求「git stash 回到 Task 5 之前」验证旧实现会失败 → 不可行且代价高 → Ruling 2 | |
Pre-flight Ruling 1: 位置判断（GetDriveTypeW、shareKey、hostKey、location）在 T1 就放到 apps/desktop/src/main/vfs/location.ts（不依赖 electron，koffi），scanner 的 Enumerator 复用它；T7 直接使用 — 避免 T7 搬家 — cost if wrong: 主进程也加载 koffi（可接受）
Pre-flight Ruling 2: T10 的原则回归用例不要求回退代码验证「旧实现会失败」；控制者已在 M1-2 最终审查中实测 fs.watch 阻止上级改名（I4），在报告中引用即可 — cost if wrong: 用例的失败能力未被直接演示
Task 1: dispatched implementer (opus — native FFI judgment) BASE=8dd95bc agent=a8d535e694db2510d
Task 1: implementer DONE_WITH_CONCERNS 5e14c8e (239/239; dist:dir OK, koffi.node auto-unpacked); atime protection verified locally (-1 → unchanged; read-only handle → updated; mutation 0 → test fails); concerns: network atime unverified; packaged runtime load unverified (no loader yet); reparse tags subset (symlink/junction/app-exec-link) to match lstat; link-dir statDir follows target; retry on err 19 untested; mapped-drive hostKey = drive letter
Task 1: dispatched reviewer (opus) on review-8dd95bc..5e14c8e.diff agent=a8a3790fda74b9300
Task 1: review: spec ❌ (doc/ not updated for structural change), quality needs fixes — I1 fs-enumerator duplicates LocalProvider statChild/resolveTarget/mapLimited verbatim (plan-mandated "移植")
Task 1: Ruling: I1 plan-mandated duplication — extract shared non-electron module (e.g. main/vfs/fs-list.ts, in vfs-portable) used by LocalProvider and FsEnumerator; LocalProvider.list stays (degraded mode) — cost if wrong: one extra small refactor
Task 1: Ruling: doc/ — add the structural facts now (koffi as dependency in 3.x, scanner dir in 5.x, 已实现 marks) without version bump; version bump/summary stays in Task 10 per plan — cost if wrong: doc churn
Task 1: Ruling: minor "handle leak if SetFileInformationByHandle callAsync rejects" regraded Important — violates Global Constraint (never hold directory handles) — enters fix round
Task 1: minor (deferred→included cheaply in round 1 at controller discretion? NO — minors stay out of loop): err 87 mapped to FS_NOT_A_DIRECTORY on any batch; GetDriveTypeW caches 0/1 results; MOUNT_POINT tag treated as link (libuv may treat volume mount points as dirs, unverified); no-restricted-imports only exact 'electron'; atime test lacks control (passes where lastaccess disabled)
Task 1: note for Task 5: koffi async uses libuv threadpool (napi_create_async_work) — hung network calls occupy threads; consider UV_THREADPOOL_SIZE / per-share native call limit
Task 1: fix round 1 dispatched (resumed a8d535e694db2510d) FIX_BASE=5e14c8e
Task 1: fix round 1 implementer DONE_WITH_CONCERNS 7202b65 (242/242); re-review dispatched
Task 1: fix round 1/5 (3 addressed, 0 open; commits 5e14c8e..7202b65)
Task 1: minor (deferred): closeHandle sync fallback after async CloseHandle failure could double-close if koffi rejects after the call executed (handle-value reuse risk) — verify koffi reject semantics in final review
Task 1: complete (commits 8dd95bc..7202b65, review clean after 1 fix round)
Task 2: Ruling: child URI = pathToFileURL(path.join(fileUriToLocalPath(dir), name)).href (plan text "parent + / + encodeURIComponent" was inaccurate; brief told to confirm against LocalProvider) — drive roots end with '/', isUnder() handles both — cost if wrong: cache keys mismatch tree URIs
Task 2: dispatched implementer (sonnet) BASE=7202b65 agent=a5dcf895dfd08becb
Task 2: implementer DONE_WITH_CONCERNS 38362a3 (260/260); concerns: isUnder case-sensitive; only kind=directory children get dirs rows (links not followed, avoids loops); roots in memory only (T5 must resend on restart); devDoc/knowledge left to final task
Task 2: Ruling: links are not traversed for scope/children (avoid cycles in all/index); an expanded link dir is still listable by its own URI — cost if wrong: 全部 level doesn't cover linked subtrees
Task 2: dispatched reviewer (sonnet)
Task 2: review ✅ spec, quality Approved
Task 2: minor (deferred→carry to Task 5): Cache.open throws on corrupt index.db — scanner entry must delete db (+wal/shm) and rebuild
Task 2: minor (deferred): clear() deletes row-by-row through FTS triggers (slow) — use drop/create or 'delete-all'
Task 2: minor (deferred): setState ensureDir+UPDATE not in one tx (style)
Task 2: minor (deferred→carry to Task 7): isUnder needs normalized roots (no trailing '/' except drive roots) — buildScannerConfig must normalize
Task 2: minor (deferred): INSERT OR IGNORE keeps parent_uri null for a dir that was a root first; removeSubtree(A) also deletes nested roots' rows — document
Task 2: minor (deferred): no test for visit outside roots / hot ties
Task 2: complete (commits 7202b65..38362a3, review clean)
Task 3: Ruling: frontier carries depth limit {uri, maxDepth|null} (plan's string[] cannot express active level's depth bound) — Task 4 consumes this shape — cost if wrong: interface churn
Task 3: Ruling: overlapping roots → focus root = longest containing root; level = highest among containing roots
Task 3: dispatched implementer (sonnet) BASE=38362a3 agent=acf14170c11e34231
Task 3: implementer DONE_WITH_CONCERNS f046304 (273/273); concern: all-level roots go to frontier only when focus is null (non-focus roots' all level ignored when focus set) — conflicts with spec 4.5 (全部 = all dirs under that root, background) → Ruling: all-level roots and index targets go to the frontier regardless of focus; passed to reviewer as requirement
Task 3: dispatched reviewer (sonnet)
Task 3: review: spec ❌ (decision 6 all-level roots ignored when focus set; test asserts opposite), ⚠️ ancestor-chain termination by string equality confirmed as real risk → included
Task 3: minor (deferred): overlapping-roots test assertion weak
Task 3: fix round 1 dispatched (resumed acf14170c11e34231) FIX_BASE=f046304
Task 3: fix round 1 implementer DONE 60cc4f9 (277/277); re-review dispatched
Task 3: fix round 1/5 (3 addressed, 0 open; commits f046304..60cc4f9)
Task 3: minor (deferred): sameLocalPath only strips trailing separator (no case normalization)
Task 3: complete (commits 38362a3..60cc4f9, review clean after 1 fix round)
Task 4: Ruling: multiple owners → per-owner computeScope merged; P1 paused when all owners unfocused (or none)
Task 4: Ruling: DirectoryListing.state fresh = enumerated in this call or checked ≤2s; cached otherwise; offline when share offline
Task 4: dispatched implementer (opus) BASE=60cc4f9
Task 4: implementer DONE_WITH_CONCERNS e3ada06 (295/295) agent=ae1ef022b1ebc0d9a; interface additions: configure(…, allRootUris), threadPoolSize opt (UV_THREADPOOL_SIZE, default 4), queueStats(), exported childUri/parentUri; native calls capped at threadpool size, network ≤ size-1; concerns: scheduler.ts 890 lines; orphan cache row if child enumerating during parent delete; new owner assumed focused; 200ms P2 pause also local
Task 4: note for Task 5: fork scanner with larger UV_THREADPOOL_SIZE (env)
Task 4: dispatched reviewer (opus)
Task 4: review: spec ✅ (1 design mismatch), quality needs fixes — I1 local P2 serial + 200ms pause (design: pause only per network server); I2 no per-volume local limit → stuck local volume can freeze scheduler
Task 4: Ruling: I1 — 200ms P2 pause only for network hosts; local P2 grouped per volume (shareKey), no pause
Task 4: Ruling: I2 — local concurrency per volume = 1 (P1/P2) + 1 (P0), local total ≤ 4, and native calls of any one location group never take the last thread (symmetry with network)
Task 4: Ruling: minor 3 (pump() unguarded → uncaught exception kills scanner, wake lost) regraded Important — scheduling-stop path
Task 4: Ruling: minor 4 (queued P0 waiter can hang forever behind a stuck lane) regraded Important — UI stuck in loading is an anti-goal; reject queued waiter with FS_TIMEOUT after waiting > timeoutSec
Task 4: Ruling: minor 1 (mid-enumeration FS_UNAVAILABLE marks share offline) — keep: network error after batches is still a strong disconnect signal; doc to state it — cost if wrong: a flaky share flips offline more often
Task 4: minor (deferred): configure doesn't drop offline entries of shares no longer configured (extra probes ≤ every 5 min)
Task 4: minor (deferred): tests missing — enumeration timeout before first onBatch → offline; prune after configure; dispose rejects waiters; two-owner scope merge
Task 4: minor (deferred): scheduler.ts 890 lines (split P2 walker / slots+watchdog)
Task 4: minor (deferred): settings change doesn't recompute existing due times; tier 'P2' branches currently dead (computeScope only emits P1)
Task 4: ⚠️ win32 enumerator calls onBatch after the first GetFileInformationByHandleEx batch? → controller to verify
Task 4: fix round 1 dispatched (resumed ae1ef022b1ebc0d9a) FIX_BASE=e3ada06
Task 4: fix round 1 implementer DONE 8d2ee15 (299/299); re-review dispatched
Task 4: fix round 1/5 (4 addressed, 0 open; commits e3ada06..8d2ee15)
Task 4: minor (deferred): timed-out queued P0 tasks stay in p0 queue while lane stuck (bounded by distinct dirs requested)
Task 4: minor (deferred): recovers… test injects via stack-name match 'advanceLevel' (brittle)
Task 4: minor (deferred): default threadpool 4 → cap 3 → local total effectively 3 (Task 5 raises UV_THREADPOOL_SIZE)
Task 4: minor (deferred): pump error rearm(now+1s) may replace an earlier wake (≤1s delay)
Task 4: complete (commits 60cc4f9..8d2ee15, review clean after 1 fix round)
Task 5: Ruling: fork scanner with UV_THREADPOOL_SIZE=16 and pass it as threadPoolSize — cost if wrong: more idle threads in scanner process
Task 5: carried: corrupt index.db → delete + rebuild once, else INDEX_UNAVAILABLE; logs forwarded to main logger; no IPC rewiring (Task 6)
Task 5: dispatched implementer (opus) BASE=8d2ee15
Task 5: implementer DONE_WITH_CONCERNS fc7d4d2 (336/336, e2e 28/28, build OK; scanner ready verified in main.log; no leftover processes) agent=a93a0d681dbd32452; extra file main/vfs/scanner-process.ts (fork isolated for tests); restart cap = stop after 3 exits in 5 min; resends last focus/interest after restart; index.db unopenable → INDEX_UNAVAILABLE but available stays true (carry to Task 6 degraded mode); scanner ready ~3s after start; zip unverified; fixed Cache.open leaking connection on corrupt db
Task 5: dispatched reviewer (sonnet)
Task 5: review ✅ spec, quality Approved
Task 5: minor (deferred→carry to Task 6): result msg failing validation leaves pending request hanging; no client-side request timeout (stuck scanner event loop → list hangs, no restart)
Task 5: minor (deferred): shutdown handler — scheduler.dispose/cache.close throwing skips exit(0) (killed after 2s); use try/finally
Task 5: minor (deferred): maxRestarts semantics = N exits (N-1 restarts) — rename/document
Task 5: minor (deferred): scanner stdout/stderr logged per chunk without rate limit
Task 5: minor (deferred): tests miss UV_THREADPOOL_SIZE→threadPoolSize chain and fork failure branch
Task 5: ⚠️ packaged run (?modulePath, koffi, node:sqlite in zip) → Task 10 Step 3
Task 5: complete (commits 8d2ee15..fc7d4d2, review clean)
Task 6: Ruling: minimal scanner config push moved into Task 6 (roots = active workspace folder entries, global default levels, no index targets, normalized root URIs) — without roots the scanner caches nothing, so Task 6 could not work end-to-end; Task 7 replaces with buildScannerConfig — cost if wrong: small rework in Task 7
Task 6: Ruling: INDEX_UNAVAILABLE from scanner also triggers vfs.list fallback to VfsService
Task 6: carried Task 5 minors: client 60s request timeout; reject on invalid result with readable id
Task 6: dispatched implementer (opus) BASE=fc7d4d2
Task 6: implementer DONE_WITH_CONCERNS bd14027 (368/368, build OK, e2e 27/27, no leftovers) agent=ac487bf8c0d0d354f; e2e: removed 3 watch: + old focus:, added 2 cache: + new focus:; mutation (empty roots) fails cache: tests
Task 6: Ruling: keep refetchOnMount: true (with staleTime Infinity it only refetches invalidated queries; needed so a dir changed while collapsed refreshes on expand) — brief's "no mount refetch" meant no unconditional refetch
Task 6: note: focus/blur wiring in bootstrap browser-window-created; reachability subscription in features/shell hook
Task 6: carry to Task 7: entry URIs with trailing '/' mismatch normalized root URIs → root's own vfs.changed not matched; normalize at entry.add and map events back to stored entry URI
Task 6: dispatched reviewer (opus)
Task 6: review ✅ spec, quality Approved
Task 6: minor (deferred→carry Task 7): entry URIs with trailing '/' (toFileUri keeps it) → root's own vfs.changed not matched; normalize in toFileUri/entry.add
Task 6: minor (deferred→carry Task 8): doc 8.2 stale lines (retry = resetQueries; hidden by '.'; filter description)
Task 6: minor (deferred): focus: e2e can't detect missing focus/blur wiring; wiring has no unit test
Task 6: minor (deferred): interestFromTree rebuilds byId per range change + JSON.stringify per render (perf with 10k nodes)
Task 6: minor (deferred): truncated visible items dropped instead of moved to offscreen
Task 6: ⚠️ main process now loads koffi via location.ts → packaged check in Task 10
Task 6: complete (commits fc7d4d2..bd14027, review clean)
Task 7: Ruling: normalize entry URIs (no trailing '/' except drive roots) at creation + migration 0003 normalizes existing rows; index target uri normalized and must be under a folder entry (ENTRY_INVALID_PARENT)
Task 7: dispatched implementer (sonnet) BASE=bd14027
Task 7: implementer DONE_WITH_CONCERNS 7fe7392 (391/391, build OK) agent=ab39ff7c6ac273438; concerns: TDD not followed (tests after, no RED evidence); isUnderUri case-sensitive (new helper in vfs/normalize-uri.ts); no leftover check (controller checked: none)
Task 7: dispatched reviewer (sonnet)
Task 7: review ✅ spec, Approved with Important I1 (isUnderUri duplicates cache isUnder) — reviewer mutation-tested 3 key tests (all caught), compensating missing RED evidence
Task 7: minor (deferred→Task 10 docs): doc known-limitation about trailing '/' now stale; IPC excerpt comment lacks entry.setRefreshLevel / index.*
Task 7: minor (deferred): migration 0003 normalization ignores scheme; case-sensitive isUnderUri; removeEntry cross-workspace coverage; migration down untested
Task 7: fix round 1 dispatched (resumed ab39ff7c6ac273438) FIX_BASE=7fe7392
Task 7: fix round 1 implementer DONE 1ff1ff7 (391/391); re-review dispatched
Task 7: fix round 1/5 (1 addressed, 0 open; commits 7fe7392..1ff1ff7)
Task 7: complete (commits bd14027..1ff1ff7, review clean after 1 fix round)
Task 8: Ruling: renderer location for "follow global (level)" label: UNC → network, drive → local (mapped drives shown as local in the label only)
Task 8: carried: doc 8.2 stale lines (Task 6 minor); remove system.openPath end-to-end
Task 8: dispatched implementer (sonnet) BASE=1ff1ff7
Task 8: implementer DONE_WITH_CONCERNS ae12028 (402/402, build OK, e2e 29/29, no leftovers) agent=a4d6450d1c47a9dfe; OS screenshot failed (CopyFromScreen handle invalid — no interactive desktop, user's screen likely locked) → page.screenshot full-window used; controller viewed t8-level-dark-zh.png (menu + submenu + checks OK); TDD partial; cached "last updated" title not e2e-covered; created devDoc 04 + 3 knowledge entries
Task 8: note: re-take OS-level screenshots when desktop is available (window chrome unverified)
Task 8: dispatched reviewer (sonnet)
Task 8: implementer looped on background notifications after reporting → stopped by controller (commit ae12028 intact)
Task 8: review ✅ spec, quality Approved
Task 8: minor (deferred→carry Task 9): renderer normalizeFileUri duplicates main normalizeRootUri — move to @pch/shared, single implementation
Task 8: minor (deferred→Task 10 docs): doc future-design mentions of shell.openPath (remote cache open, Office fallback, preview fallback "用系统应用打开") — clarify that the tree no longer offers it and opening moves to the future preview window
Task 8: minor (deferred): lastUpdated title computed for every row; import order in explorer-tree; settings-not-loaded fallback 'default' vs schema default; devDoc README table reflow noise
Task 8: complete (commits 1ff1ff7..ae12028, review clean)
Task 9: Ruling: multi-file drop inserts in drag order at the drop point (each after the previous)
Task 9: carried: move normalizeRootUri (+isUnderUri/prefixOf if Node-free) to @pch/shared, single implementation for main/scanner/renderer
Task 9: dispatched implementer (sonnet) BASE=ae12028
Task 9: implementer DONE_WITH_CONCERNS 9abcf60 (415/415, build OK, e2e 29/29, no leftovers) agent=a937eb0750aa41e76; normalize-uri moved to @pch/shared (main file deleted); devDoc 05 created; concerns: real zip drop manual only; 8.3 short-name temp path vs long-name getPath('temp') mismatch unverified; %TEMP% dirs can't be pinned by OS drop; sequential-after in executor not unit-tested
Task 9: dispatched reviewer (sonnet)
Task 9: implementer stopped after reporting (was waiting on background work)
Task 9: review ✅ spec, quality needs fixes — I1 temp-dir check is string-only (misses 8.3 short names and junctions into Temp); controller verified on this machine: TEMP short name == long name
Task 9: minor (deferred): addEntry reads whole workspace per add; unused maxSortOrder; executor sequential-after untested; ENTRY_INVALID_PARENT message when reference entry deleted; formatting; no test for duplicate legacy sort_order
Task 9: fix round 1 dispatched (resumed a937eb0750aa41e76) FIX_BASE=9abcf60
Task 9: fix round 1 implementer DONE 463de5f (417/417); re-review dispatched
Task 9: fix round 1/5 (1 addressed, 0 open; commits 9abcf60..463de5f)
Task 9: minor (deferred): isTemporary uses only raw form when target doesn't exist (stat fails anyway)
Task 9: complete (commits ae12028..463de5f, review clean after 1 fix round)
Task 10: Ruling: devDoc 04/05 already used by Tasks 8/9 → overall engine record is devDoc/2026-11-19-06-refresh-cache.md linking 04/05
Task 10: carried doc minors (Task 7 stale limitation, IPC excerpt, Task 8 openPath future mentions) + pre-flight Ruling 2 (no revert to prove old impl fails)
Task 10: dispatched implementer (opus) BASE=463de5f
Task 10: implementer DONE_WITH_CONCERNS 7adadd3,10604ea,00f2489 (418/418, e2e 30/30; principle test 5 runs pass, no retries; pnpm dist OK, packaged run: koffi native in main + scanner, scanner ready, index.db created; perf 10k dirs/100k files all-level first pass 58s, scanner WS ~150MB, index.db ~36MB) agent=a134d67c50613769b; concerns: extra driveTypeStatus() startup log; UNC unverified (only IPC$); OS screenshots pending desktop; leftover pch-cache-*/pch-task5-* temp dirs from earlier tasks' tests
Task 10: dispatched reviewer (sonnet)
Task 10: minor (deferred→final review): tests leave temp dirs in %TEMP% (pch-cache-* x5, pch-task5-* x4, pch-scanner-*, pch-smoke-*, pch-e2e-*) — find leaking tests
Task 10: review ✅ spec, quality Approved (22 doc facts cross-checked against code, all consistent)
Task 10: minor (deferred): doc 8.3 constant locations omit vfs/scanner-process.ts; v1.9 summary "涉及" list (9.3 vs 9.4/10.6, missing 6.6); devDoc "4 次" vs report "5 次"; principle e2e waits fixed 4500ms instead of observing checkedAt
Task 10: complete (commits 463de5f..00f2489, review clean)
Task 11: Ruling: search cancel = discard superseded result in main client (scanner SQL is sync); file entries matched in main with shared matcher (single impl), prepended; total capped at 10000; devDoc 07 search record
Task 11: dispatched implementer (sonnet) BASE=00f2489
Task 11: implementer DONE_WITH_CONCERNS c2ce144 (457/457, build OK) agent=a056975603158a8fa; perf 100k names in-memory: 3+char 2–21ms, short 20–34ms, glob 39ms; parseQuery/matchesName in packages/shared/src/search/query.ts (single impl); concerns: partial RED; pinned file hits have size/mtime 0 (carry to Task 12: don't display); only-file-entries path skips scanner; Unicode case folding differs FTS vs LIKE/lower vs toLowerCase; sync SQL blocks scanner briefly
Task 11: dispatched reviewer (sonnet)
Task 11: review ❌ spec (kind=file drops symlinks with NULL target — SQL 3-valued logic), quality needs fixes
Task 11: minor (deferred): globToRegExp lacks 'u' flag (surrogate pairs '?' mismatch vs SQLite GLOB); no shared-corpus consistency test main vs scanner matching; total over-count after dedupe; scope equality relies on normalized URIs (verified elsewhere: Task 7 normalizes); no UNC-root / trailing-slash scope tests; pinned-file dedupe relies on same-origin URIs
Task 11: fix round 1 dispatched (resumed a056975603158a8fa) FIX_BASE=c2ce144
Task 11: fix round 1 implementer DONE dde3061 (458/458); re-review dispatched
Task 11: fix round 1/5 (1 addressed, 0 open; commits c2ce144..dde3061)
Task 11: complete (commits 00f2489..dde3061, review clean after 1 fix round)
Task 12: Ruling: reveal waits ≤10s per level then stops at deepest expanded level with a notice; search text/kind kept per workspace across view switches, cleared results on workspace switch; pinned file hits show no size/mtime
Task 12: dispatched implementer (opus) BASE=dde3061
Task 12: implementer DONE_WITH_CONCERNS 5c7073c (489/489, build OK, e2e 36/36 incl. 6 search; e2e mutation-checked) agent=a702336f79d9e62a8; deviations: per-query requestId; search view switches to explorer before reveal; SidebarView in stores/ui-store; extra files search-store/format/use-reveal; matchRanges in shared query.ts; ToggleGroup→Tabs
Task 12: Ruling: search results don't auto-refresh on vfs.changed / showHidden change (re-run on input or view switch) — results are labelled "based on cache (N min ago)" — cost if wrong: user sees stale hits until retyping
Task 12: dispatched reviewer (sonnet)
Task 12: review ✅ spec (deviations judged reasonable), Approved with Important I1 (virtual list rows lack aria-posinset/aria-setsize)
Task 12: minor (deferred): reveal may steal focus/selection after user moved on (≤10s wait); stale pending reveal request consumed later; switching workspace focuses search input; loading state lacks accessible name; Tabs without tabpanel; ↑ at row 0 doesn't return to input; use-reveal timeout/failure paths untested; vfs.cancel may arrive before main registers requestId (wasted ~20–40ms query); placeholder highlight
Task 12: fix round 1 dispatched (resumed a702336f79d9e62a8) FIX_BASE=5c7073c
Task 12: fix round 1 implementer DONE 2e64424 (489/489, search e2e 7/7 with RED observed); re-review dispatched
Task 12: fix round 1/5 (1 addressed, 0 open; commits 5c7073c..2e64424)
Task 12: complete (commits dde3061..2e64424, review clean after 1 fix round)
Final review: dispatched (opus) range 8dd95bc..HEAD
Final review: Ready to merge: With fixes — I1 unknown Win32 errors → FS_UNAVAILABLE → whole volume/share offline (+ write-attr open fallback only for 5/19; 87 any batch); I2 offline state lost/stale after scanner restart / giveUp / renderer reload; I3 every detected change causes an extra full enumeration (listNow always requestP0, dedupe only P0); I4 removeSubtreeRows substr() full scan (54ms vs 0.7ms at 1M rows); I5 write-attr access leaves audit records on servers (user decision)
Final: reviewer independently verified atime protection + no change notifications on parent (supports pre-flight Ruling 2)
Final: Ruling: T4 "mid-enumeration FS_UNAVAILABLE → offline, keep" corrected — premise false while FS_UNAVAILABLE is the catch-all; fixed via I1 (narrow FS_UNAVAILABLE to network/device codes)
Final: Ruling: I5 is a requirement-level trade-off (atime protection vs. write-attribute audit records on customer servers) — not changed in fix wave; documented as known limitation; surfaced to user with options — cost if wrong: audit/EDR noise on servers until decided
Final: fix wave includes pre-merge minors: M1 test temp-dir leaks (db handles in finally, rmSync maxRetries, separate try per dir); T5 shutdown try/finally; M2 client 60s timeout gets its own code (no fallback re-enumeration); M5 online → invalidate that share's queries; M7 globToRegExp 'u' flag
Final: minor (deferred): M3 P2 rounds reuse LIST_MAX_AGE 1h (large network trees full-enumerate every round); M4 resolveTarget concurrency 16 = whole threadpool; M6 index checkmark only exact match (descendants of indexed dir show unchecked)
Final: fix wave dispatched (opus, single fixer) agent=a921edbb7e5369742 FIX_BASE=2e64424
Final: fix wave DONE 1bfdca2..ec67966 (509/509, e2e 37/37, no leftovers, no new pch-* temp dirs); I1 error list extended (+15,51,55,1167,1201,1225,1236,1256; excluded ambiguous 54,58,65,71,1203,1229); I3 chose "listNow skips P0 when checked ≤2s"; doc v1.11
Final: out-of-list findings: fs fallback enumerator maps EIO etc. to FS_UNAVAILABLE (same class as I1); main matching Unicode-case vs SQL lower() ASCII-only
Final: scoped re-review dispatched
Final: fix wave re-review: all items ADDRESSED, no new Critical/Important (2e64424..ec67966); error-code lists verified against Microsoft Learn by re-reviewer
Final: Ruling: residual — M5 online invalidation relists every active query of the share (not only offline/error ones) → burst of P0 full enumerations after VPN reconnect; parked (no second fix wave) — cost if wrong: right after reconnect, expanding an uncached dir may wait behind these and hit FS_TIMEOUT
Final: Ruling: residual — I3 freshness uses checkedAt, so an mtime-only P1 check suppresses the P0 full enumeration for 2s (child size/time changes may show up one P1 interval later, ≤30s on network); parked — cost if wrong: stale size/mtime up to one interval
Final: minor (deferred): T5 shutdown errors are not logged in production (process.exit in finally); contract.ts JSDoc misplaced around vfs.offlineShares; fs fallback enumerator maps EIO to FS_UNAVAILABLE; drive-letter disappearance may surface as FS_NOT_FOUND (cache subtree dropped) instead of offline; candidate extra unavailable codes (1112,1262,1255,1233,321,20,70); 65 could map to FS_PERMISSION_DENIED
Final: controller gate at e6cca13: typecheck+lint+prettier+test(509/509)+build+e2e(37/37) EXIT=0; no leftover processes; no new pch-* temp dirs (16→16); prior gate at ec67966 failed on prettier devDoc/README.md → fixed e6cca13
```

## 最终审查修复波：问题清单

```text
# 最终审查修复波：问题清单（控制者裁定后）

审查原文要点见执行台账 `Final` 行。下面每条都要：写一个先失败的测试（能自动化的）→ 修复 → 通过；全部完成后跑全量检查。

## Important
- **I1 错误分类过宽导致整卷 / 整共享误判断开**
  - `apps/desktop/src/scanner/enum/win32-enumerator.ts:142-146`（default 分支）：只把确定属于网络 / 设备不可用的 Win32 错误码归为 `FS_UNAVAILABLE`（审查建议：21、53、59、64、67、121、1231、1232、1222、2250 等——以微软文档核对每个码的含义后确定列表），其余归为一个新的、不触发断开的分类（例如沿用现有错误码体系中的通用错误；若需新增错误码，按 CLAUDE.md 三语同时添加）。目录状态记为 `unreachable`、按 P2 间隔重试，不影响同一卷 / 共享的其他目录。
  - `:195-197`：以写属性打开失败时，只要不是 2 / 3（不存在）或网络类错误，就退回只读打开（不再只对 5 / 19）。
  - `:249`：87 只在第一批结果时、且用 `statDir`（或等价方式）确认目标确实不是目录后才映射为 `FS_NOT_A_DIRECTORY`。
  - `apps/desktop/src/scanner/schedule/scheduler.ts:855-857`：确认修改后只有网络 / 设备类错误会 `goOffline`；按设计「断开只由探测判定」，枚举中途（已有批次）收到的 `FS_UNAVAILABLE` 是否仍判断开：控制者裁定——**仍判断开**（此时它已收窄为确定的网络 / 设备错误），代码注释同步。
  - 测试：未知错误码不使卷断开、写属性打开返回非 5/19 的拒绝码时退回只读、87 在非首批时不当作「不是目录」。
- **I2 断开状态在扫描进程重启 / 降级 / 渲染端重新加载后失真**
  - `apps/desktop/src/main/vfs/scanner-client.ts`：记录当前断开的共享集合（随 `reachability` 事件维护）；`onExit`（将重启）与 `giveUp`（进入降级）时对每个断开的共享发出 `online` 并清空集合（新进程若仍连不上会重新发出 `offline`）。
  - 新增查询当前断开集合的途径（例如 IPC `vfs.offlineShares {} → { share, since }[]`，契约 → handler → 渲染端），渲染端在订阅 `vfs.reachability` 的地方启动时先查询一次初始化 store。
  - 测试：客户端在 onExit / giveUp 时发出 online；渲染端初始化。
- **I3 每次检测到变化都多一次完整枚举**
  - `scheduler.ts:334-337 / 402-405 / 773-778`：任何优先级的检查（完整枚举或修改时间比较）完成后都写入去重时刻（或 `listNow` 在 fresh 时不再 `requestP0`——二选一，选更简单、更不易回归的；报告中说明）。
  - 测试：「P1 发现变化 → 发出 changed → 随后的 listNow 在 2 秒内不再枚举」。
- **I4 `removeSubtreeRows` 全表扫描**
  - `apps/desktop/src/scanner/cache/cache.ts:327-332`：改为可走索引的区间条件（与 `scanner/search/search.ts` 的 `scopeCondition` 相同的写法，复用同一个前缀函数，只保留一份实现）。
  - 测试：行为不变的既有测试全部通过；另加同前缀兄弟（`C:/a` 与 `C:/ab`）不被误删、驱动器根子树删除的用例。可选：用 `EXPLAIN QUERY PLAN` 断言使用了索引。

## 合并前一并修复的 Minor
- **M1 测试临时目录泄漏**：`apps/desktop/src/scanner/cache/cache.test.ts:204-266`、`apps/desktop/src/scanner/main.test.ts` 等打开数据库的测试，把 `close()` 放进 `afterEach` / try-finally；`afterEach` 中的 `rmSync` 加 `maxRetries: 10, retryDelay: 100`；`e2e/app.spec.ts:174-183`、`e2e/explorer.spec.ts:102-105`、`e2e/search.spec.ts:37-40` 中多个目录的删除各自 try（一个失败不影响另一个），并加 `maxRetries`。
- **T5 shutdown**：`apps/desktop/src/scanner/main.ts` 的 shutdown 处理改为 try/finally，`scheduler.dispose()` / `cache.close()` 抛错时仍 `exit(0)`。
- **M2 客户端兜底超时**：`scanner-client.ts:301` 的 60 秒兜底超时改用单独的错误码（例如 `FS_TIMEOUT`），`vfs.ipc.ts` 不因它回退到 `VfsService` 直接枚举（避免同一共享上并发第二次枚举）；只有 `available=false` 与扫描进程明确的 `INDEX_UNAVAILABLE` 才回退。测试同步。
- **M5 恢复在线后刷新状态**：渲染端收到某共享的 `online` 时，让该共享下的目录查询失效（`state: 'offline'` 随之更新）。
- **M7 `globToRegExp` 加 `u` 标志**（`packages/shared/src/search/query.ts`），注意 `u` 模式下的转义集；补一个代理对字符（如 `𠮷`）与 `?` 的测试。

## 文档
- `doc/PremiumCowHorse-架构设计方案.md`：同步 I1–I4、M2、M5 的行为；已知限制中加入 **I5**（以写属性打开目录以保护访问时间，在开启了对象访问审核的文件服务器上会留下 WriteAttributes 记录，部分 EDR / NAS 可能视为可疑；待需求方决定，例如网络位置默认只读句柄或按位置可设置）；不改版本号以外的结构，版本号升为 v1.11 并写变更摘要。
- `devDoc/2026-11-19-06-refresh-cache.md`（引擎总记录）追加「最终审查修复」一节：问题、修法、测试；「待需求方决定」中加入 I5。
- `knowledge/`：错误码分类、测试清理（EBUSY 与 `force` 只忽略 ENOENT）等坑。
```
