# M1-2 资源树：执行台账（原文）

- 用途：[08 M1-2 资源树](./2026-11-18-08-m1-2-explorer.md) 的附件。逐条保留子 agent 驱动执行期间的派发、审查结论、控制者裁定（`Ruling:`）与暂缓的 minor，供追溯；归纳版见该记录的「遗留事项」。
- 来源：`.superpowers/sdd/2026-11-18-07-m1-2-explorer-plan/progress.md`（计划工作区为 git 忽略的临时目录，计划完成后已删除，本文件为其副本，内容未改动）。
- 台账为执行过程的速记，中英混写；其中的「agent=…」是当时的子 agent 标识，无需关注。
- 最终审查修复波的问题清单 `final-fix-wave.md` 与证据 `final-fix-wave-report.md` 随工作区一并删除，未保留；其结论已写入 08 记录的「最终审查修复」一节。

---

```text
# SDD ledger — plan: /c/Users/yongjun.fu/Desktop/PremiumCowHorse/devDoc/2026-11-18-07-m1-2-explorer-plan.md

Setup: 分支 feat/m1-workspace（主 checkout，无 worktree；需求方已允许在本分支按任务提交）。Spec: doc/PremiumCowHorse-架构设计方案.md v1.6。执行方式：子 agent 驱动（需求方选择）。子 agent 的说明与报告一律中文（CLAUDE.md）。

## Pre-flight（共享文件 / 接口）
| 任务对 | 生产 → 消费 | 结论 |
| T1 → T7/T8 | EntryAddInput 的 uri 变体（固定真实子目录） | 一致 |
| T1 → T9 | WorkspaceUpdateInput.name 允许空（仅 default）、WORKSPACE_NAME_REQUIRED | 一致 |
| T2 → T6 | FileEntry.target（link-directory / link-broken） | 一致 |
| T3 → T5 | vfs.watch / vfs.changed | 一致 |
| T4 → T6/T8/T9 | system.selectPaths / revealInOs / openPath / copyText | 一致（T6 空状态用 selectPaths，T4 在前） |
| T3、T4 | 都改 packages/shared/src/ipc/contract.ts | 顺序执行，无冲突 |
| T2、T3 | 都改 local.provider.ts | 顺序执行，无冲突 |
| T5 → T6/T9 | 外壳插槽 sidebarViews / workspaceSwitcher；DirectoryState；data hooks | 一致（T5 放占位，T6/T9 替换） |
| T6 → T7/T8 | TreeNode、explorer-tree.tsx、tree-row.tsx | 一致 |
| T8 → T9 | shadcn dialog / alert-dialog / input / field 在 T8 添加，T9 使用 | 一致（T9 在 T8 之后） |
| T8/T9 → T10 | e2e 用例写在 app.spec.ts；T10 可能抽出 support.ts | 一致 |
| 各任务自身 | 测试与实现、文件清单前后一致 | T8/T9 以 e2e 为 RED（界面任务，合理）；无计划强制的缺陷写法 |
Task 1: dispatched implementer (sonnet) BASE=6ee6aff
Task 1: implementer DONE a2594c4 (110/110); impl agent id recorded for fix rounds
Task 1: Ruling: implementer used its own system-prompt co-author line (Sonnet 5.5) instead of the instructions' Opus line — acceptable, attribution reflects the model that wrote the commit — cost if wrong: cosmetic
Task 1: dispatched reviewer (sonnet) on review-6ee6aff..a2594c4.diff
Task 1: review ✅ spec, quality approved; ⚠️ test evidence verified by controller (typecheck/lint/vitest rerun)
Task 1: minor: concurrent-move test does not prove in-transaction read (passes on old code); suggest remove+move race test
Task 1: minor: toFileUri accepts root-relative '\foo' (resolves against current drive) — pin or reject
Task 1: minor: 'input.uri as string' assertion; uri not trimmed
Task 1: minor: schema/errors test coverage gaps; test name says folder but uses file
Task 1: minor: empty-name check runs before WORKSPACE_NOT_FOUND
Task 1: complete (commits 6ee6aff..a2594c4, review clean)
Task 2: dispatched implementer (sonnet) BASE=a2594c4
Task 2: implementer DONE_WITH_CONCERNS 20c4fd6 (111/111); concerns: non-ENOENT stat failures → target null; non-directory targets → 'file' — sent to review
Task 2: review ✅ spec, quality approved
Task 2: Ruling: degraded symlink entries (lstat failed) carry kind 'symlink' without target — Task 6 tree model must treat target === undefined like a broken link (not expandable); carried into Task 6 dispatch — cost if wrong: such links can't be expanded until refresh
Task 2: minor: resolveTarget maps every stat failure (EACCES/ELOOP/network) to null → shown as broken link
Task 2: minor: no signal check between lstat and target stat
Task 2: complete (commits a2594c4..20c4fd6, review clean)
Task 3: dispatched implementer (sonnet) BASE=20c4fd6
Task 3: implementer DONE_WITH_CONCERNS ff81d70 (119/119); concern: watch entry kept after directory deletion → no re-watch if recreated until re-expand; build/e2e not run by implementer (controller runs)
Task 3: controller evidence: pnpm build OK, playwright 7 passed (ff81d70)
Task 3: review: spec ❌ (watch auto-release incomplete), quality needs changes — I1 zombie watch entry never re-created; I2 dir self-delete may not emit vfs.changed (error → close only); I3 delete-dir test asserts nothing about behavior
Task 3: ⚠️ wireEvents before openMainWindow — verified bootstrap.ts:52 vs :55, OK
Task 3: minor (deferred): pure trailing debounce has no max wait (continuous writes postpone vfs.changed forever)
Task 3: minor (deferred): onDirectoryChanged in timer not wrapped in try/catch (EventBus.emit has none)
Task 3: minor (deferred): watches keyed by raw URI string (file:///c:/a vs file:///C:/a → two watches)
Task 3: minor (deferred): setWatched after dispose still creates watches
Task 3: minor (deferred): vfs.changed broadcast to all windows, not only owners
Task 3: fix round 1 dispatched (fresh sonnet implementer; original agent id lost in compaction) FIX_BASE=ff81d70 implementer=a67bc04f9a2a3b550
Task 3: fix round 1 implementer DONE cb11f5b (122/122); note: Windows delete gives only 'rename' (no 'error') → rename triggers fs.stat existence check; re-review dispatched
Task 3: fix round 1/5 (3 addressed, 0 open; commits ff81d70..cb11f5b)
Task 3: minor (deferred): invalidated entry's pending debounce timer not cleared by dispose (may emit once after dispose)
Task 3: minor (deferred): rename→fs.stat failure for any reason (EACCES/network) treated as invalidation
Task 3: Ruling: watch re-creation after invalidation relies on renderer calling vfs.watch again with the expanded set after receiving vfs.changed — carry into Task 5/6 dispatch (data layer must re-send setWatched on vfs.changed / after re-list) — cost if wrong: deleted-then-recreated dirs stop auto-refreshing until re-expand
Task 3: complete (commits 20c4fd6..cb11f5b, review clean after 1 fix round)
Task 4: dispatched implementer (sonnet) BASE=cb11f5b agent=a09de540017d0b2f1
Task 4: implementer DONE c63fdb9 (126/126); note heredoc backslash loss → knowledge candidate
Task 4: controller evidence: pnpm build OK (incl. typecheck), playwright 7 passed (c63fdb9); ⚠️ i18n for FS_* codes verified in ja/zh-CN/en
Task 4: review ✅ spec, quality approved
Task 4: minor (deferred): local-path test lacks catch-branch case (file:///etc/x, %2F → FS_INVALID_URI)
Task 4: minor (deferred): file://localhost/C:/x → \localhost\C:\x (not treated as local)
Task 4: minor (deferred): openPath executes .exe/.bat/.lnk directly (brief-mandated; consider confirm later)
Task 4: note for Task 5/7/9: selectPaths returns local paths; entry.add accepts path directly (Task 1 schema) — no conversion needed
Task 4: complete (commits cb11f5b..c63fdb9, review clean)
Task 5: dispatched implementer (sonnet) BASE=c63fdb9 agent=aaccdac67a11f6cee; carried Task 3 ruling (re-send vfs.watch on vfs.changed)
Task 5: implementer DONE_WITH_CONCERNS 0a48e70 (133/133, e2e 7/7); concerns: refetchOnWindowFocus 'always' (staleTime Infinity); placeholders live in shell feature (app may not import data); old workspace dropdown + "new workspace" removed until Task 9; vitest @renderer alias added; useDirectories returns new Map each render
Task 5: Ruling: temporary removal of the workspace dropdown/new-workspace entry is accepted inside the branch — Task 9 replaces the placeholder and must restore create — carried into Task 9 dispatch — cost if wrong: branch midpoint lacks workspace creation UI
Task 5: review ✅ spec (deviations justified: refetchOnWindowFocus 'always'; WorkspaceNameLabel in shell feature), quality approved
Task 5: ⚠️ verified: eslint r-app allows only r-feature/r-lib/ui/i18n/shared (no r-data); call() throws AppError so useDirectories error code mapping works
Task 5: minor (deferred): useWatchDirectories wiring (subscribe → notifyChanged, key effect) has no unit test
Task 5: minor (deferred): useDirectories returns a new Map every render (Task 6 informed)
Task 5: minor (deferred): welcome title empty while active workspace loading
Task 5: minor (deferred): vfs.watch failure silently swallowed without comment
Task 5: minor (deferred): @renderer alias duplicated in vitest.config.ts vs electron-vite/tsconfig
Task 5: complete (commits c63fdb9..0a48e70, review clean)
Task 6: dispatched implementer (opus — design judgment, multi-file UI) BASE=0a48e70 agent=a603fd1d6c9c5feaa; carried Task 2 ruling (target undefined → link-broken) and Task 5 Map-instability note
Task 6: implementer DONE_WITH_CONCERNS d56b5e0 (142/142, e2e 9/9); react-virtual 3.14.26; concerns: SideBar no longer renders title (views own header); extra export resolveDirectoryUris; retry=resetQueries, refresh=invalidate; eslint-disable incompatible-library; empty group shows status row; docs deferred to Task 10
Task 6: controller viewed tree-light-ja.png — layout OK; observation: error status label truncated ('ファイルまたはフォルダー…') in narrow sidebar (minor candidate); review dispatched (opus)
Task 6: review: spec ❌ (keyboard edge cases), quality needs changes — I1 Enter on Retry button hijacked by tree onKeyDown (collapses parent); I2 selected status row/vanished node loses selection → next ↑↓ jumps to row 0
Task 6: minor (deferred): status rows inherit parent kind/source/uri — Task 7/8 must exclude status nodes (carry isStatusNode note into Task 7/8 dispatch)
Task 6: minor (deferred): estimateSize fixed 28 ignores compact density; no measure() on density change
Task 6: minor (deferred): getItemKey new function each render → full 10k measurements recompute per keypress
Task 6: minor (deferred): resolveDirectoryUris flattens whole tree per iteration
Task 6: minor (deferred): status id '<id>#status' can collide with a sibling file named 'x#status' (plan-mandated format)
Task 6: minor (deferred): no visible focus indicator when tree focused with no selection; no aria-setsize/posinset
Task 6: minor (deferred): ExplorerView renders null when entries query errors; addFolder multi-select stops at first failure
Task 6: minor (deferred): SidebarEmptyState explorer branch dead code; explorer:title duplicates common key
Task 6: minor (deferred): explorer-store untested; e2e lacks ↑/boundaries/Enter/F5/click coverage
Task 6: minor (deferred): error status label truncated in narrow sidebar
Task 6: ⚠️ timeout-directory error row not e2e-covered → Task 10 e2e; compact density screenshot missing → Task 10; docs/knowledge deferred to Task 10 (plan's docs task)
Task 6: fix round 1 dispatched (resumed implementer a603fd1d6c9c5feaa) FIX_BASE=d56b5e0
Task 6: fix round 1 implementer DONE de41d37 (147/147, e2e 10/10); re-review dispatched
Task 6: fix round 1/5 (2 addressed, 0 open; commits d56b5e0..de41d37)
Task 6: minor (deferred): resolveSelection deleted-node position fallback only unit-tested (no e2e); empty nodes clears lastIndex
Task 6: re-review minor 3 (lastIndex across workspaces) verified non-issue: ExplorerTree keyed by workspaceId
Task 6: complete (commits 0a48e70..de41d37, review clean after 1 fix round)
Task 7: Ruling: DropAction 'add' items carry no kind but entry.add requires kind and rejects mismatch (ENTRY_KIND_MISMATCH) — executor derives kind from TreeNode for fs sources (directory/link-directory → folder, file/link-file → file); for OS paths tries 'folder' then retries 'file' on ENTRY_KIND_MISMATCH — no new IPC, plan interface kept — cost if wrong: one extra IPC round-trip per dropped OS file
Task 7: Ruling: status rows and link-broken nodes are not drag sources; status rows are not drop targets (resolveDrop → null) — from Task 6 minor 1
Task 7: dispatched implementer (sonnet) BASE=de41d37
Task 7: implementer DONE_WITH_CONCERNS 3ba4379 (165/165, e2e 11/11); LocalProvider.stat follows links → link-directory adds as folder OK; concerns: empty state says "drag here" but not a drop target; OS/fs drag-in only unit-tested (unverified); add always appends to parent end
Task 7: Ruling: empty-state drop target is in scope (UI text promises it) — resumed implementer to add before review — cost if wrong: one extra small commit
Task 7: empty-state drop added 853e781 (167/167, e2e 11/11; end-to-end OS drop unverified — Playwright cannot synthesize real-path File); review dispatched
Task 7: review: spec ✅ core constraint holds (navigateOnDragDrop default false verified by reviewer in electron.d.ts); quality needs changes — I1 virtual-file drops (zip/Outlook/browser image) may make Chromium write %TEMP% copies and pin them (unverified); I2 'after' on expanded group draws line between group and first child but moves after the group's last child
Task 7: Ruling: I1 needs real-machine verification + a requirement decision (Chromium-side temp copy vs "no file operations"; rejecting temp paths would also block pinning %TEMP% for log work) — not dispatched in fix loop; surfaced to user with the manual OS drag-in verification at end of plan; docs in Task 10 record it as known limitation pending decision — cost if wrong: zip-dragged items pin ephemeral temp copies until user decides
Task 7: minor (deferred): dragSourceRef not cleared on drop (only dragend)
Task 7: minor (deferred): siblings computation does not exclude status rows
Task 7: minor (deferred): fs source not found in nodes → defaults to folder (could carry kind in DragSource)
Task 7: minor (deferred): add before/after line highlight misleading (add always appends; plan-mandated no index)
Task 7: minor (deferred): duplicated path extraction / isFiles / empty-state highlight class (template string, not cn)
Task 7: minor (deferred): positionFromOffset thresholds untested; no DOM-level e2e for dragover on real node not prevented; effectAllowed not asserted
Task 7: minor (deferred): dropping selected entry into collapsed group moves selection to unrelated node
Task 7: minor (deferred): multi-file failures toast per item
Task 7: fix round 1 dispatched (resumed a5d6351c1545a8471) FIX_BASE=853e781 — I2 only
Task 7: fix round 1 implementer DONE d126eb4 (171/171, e2e 11/11); re-review dispatched
Task 7: fix round 1/5 (1 addressed, 0 open; commits 853e781..d126eb4)
Task 7: minor (deferred): no test for group dropped on its own / descendant's lower edge → null; position param reassigned
Task 7: complete (commits de41d37..d126eb4, I1 parked for user decision — see Ruling above)
Task 8: dispatched implementer (sonnet) BASE=d126eb4 agent=a6f15ed51bd49abdd; rulings carried: status rows no menu/F2/Delete; link-broken no open/pin; copy path via new renderer pure fn uri→Windows path + system.copyText; reuse use-drop-executor for add/pin
Task 8: implementer DONE_WITH_CONCERNS 82e5db9 (183/183, e2e 16/16); concerns: empty workspace (empty state, no tree) has no way to create a group; add folder/file only in blank-area menu → root; screenshots light/ja only; remove confirm uses non-destructive style, default focus Cancel
Task 8: (session restarted after shutdown; resumed from ledger — commit 82e5db9 present, tree clean)
Task 8: review: spec ✅ mostly, quality needs changes — I1 empty workspace cannot create a group; I2 dialog submit on already-removed entry keeps dialog stuck (repeat errors)
Task 8: minor (deferred): fileUriToWindowsPath — unencoded #/? truncation, localhost host, hostname lowercase/punycode
Task 8: minor (deferred): Menu key / Shift+F10 opens blank-area menu instead of selected node's
Task 8: minor (deferred): remove button not destructive variant (default focus Cancel is safe)
Task 8: minor (deferred): only light/ja screenshots (dark/zh-CN/en unverified) → Task 10 screenshots
Task 8: minor (deferred): e2e lacks remove group / pin to root / add folder… / sub-group creation
Task 8: fix round 1 dispatched (resumed a6f15ed51bd49abdd) FIX_BASE=82e5db9
Task 8: fix round 1 implementer DONE a10ceed (183/183, e2e 18/18); re-review dispatched
Task 8: fix round 1/5 (2 addressed, 0 open; commits 82e5db9..a10ceed)
Task 8: minor (deferred): rename-removed e2e does not assert the error toast; empty-state has no context menu (optional)
Task 8: complete (commits d126eb4..a10ceed, review clean after 1 fix round)
Task 9: dispatched implementer (sonnet) BASE=a10ceed agent=a6dabc985e5d3ea32; carried Task 5 ruling (restore new workspace; remove WorkspaceNameLabel placeholder); welcome-page create link to open same dialog via app composition
Task 9: implementer DONE_WITH_CONCERNS fdb642d (183/183, e2e 19/19); welcome link wired via ui-store newWorkspaceOpen; delete → explicit activate('default') (main picks max lastOpenedAt); concerns: two-step delete/create non-atomic (create retry may duplicate); 100-char limit not e2e
Task 9: implementer agent looped on background notifications after reporting → stopped by controller (commit fdb642d intact, tree clean); controller viewed ws-menu-dark-ja.png OK (minor: empty-state buttons unequal width); review dispatched
Task 9: review: spec ✅, quality needs changes — I1 create→activate failure + retry duplicates workspace; I2 delete-then-activate shows wrong workspace briefly / inconsistent on failure
Task 9: ⚠️ old-workspace watch release on switch — verified: ExplorerTree keyed by workspaceId, useWatchDirectories dispose sends empty set (Task 5 review); ⚠️ focus after dialogs unknown → added to fix round as verify-and-fix
Task 9: minor (deferred): 100-char/blank-submit/non-default rename not e2e; maxLength silently truncates paste
Task 9: minor (deferred): delete pending still allows cancel/Esc
Task 9: minor (deferred): rename/delete dialog target is live `active` (not locked id)
Task 9: minor (deferred): onFocus select-all on every click
Task 9: fix round 1 dispatched (fresh sonnet implementer a94951e552b19a291 — previous agent stopped) FIX_BASE=fdb642d
Task 9: fix round 1 implementer DONE edee950 (190/190, e2e 19/19); focus already returned to switcher (asserted); re-review dispatched
Task 9: fix round 1/5 (3 addressed, 0 open; commits fdb642d..edee950)
Task 9: minor (deferred): remove failure after switching to default shows generic error (state visible); focus not asserted for cancel/Esc; non-current target would switch unnecessarily (menu only targets current → no impact)
Task 9: minor (deferred): focus after welcome-page-opened create dialog unverified
Task 9: complete (commits a10ceed..edee950, review clean after 1 fix round)
Task 10: dispatched implementer (opus — docs synthesis across tasks + e2e) BASE=edee950
Task 10: implementer DONE_WITH_CONCERNS 938ea8e,151a90c,7fc1a17 (193/193, e2e 22/22); out-of-brief fix 938ea8e: useDirectories error-first (stale data kept on failed refetch hid deletion); concerns: watch not re-established after delete→recreate at same path (retry restores list but no further auto-updates) — documented not fixed; switcher e2e flake fixed in test only; unverified: real OS drag in/out, virtual-file temp copies, focus refresh/UNC polling/timeout e2e
Task 10: Ruling: watch non-recovery after delete→recreate is a real gap against Review Focus 3 / Task 3 ruling (renderer re-sends set only on vfs.changed; after invalidation the set is unchanged so nothing re-sends when the dir comes back) — enters Task 10 fix loop; suggested fix: watch only directories whose listing is ready, so error→ready transition changes the set and re-sends — cost if wrong: recreated dirs stop auto-refreshing until re-expand/F5
Task 10: review: spec ❌ (watch non-recovery unfixed), quality needs changes — I1 watch only ready dirs (watchableUris + unit test + e2e + doc sync); I2 devDoc overstates screenshots (5 shots, not each combo); 938ea8e error-first judged correct; switcher test-only fix judged reasonable
Task 10: minor (deferred): doc 8.3 "(e2e 验证)" overclaims watch release / rename; fixed waitForTimeout(1000) in explorer.spec; vfs.watch >500 fails silently; focus refresh/UNC polling no e2e; FS_CANCELLED on rapid F5 + external change not e2e-confirmed; Task 6 perf numbers & Base UI ContextMenu API knowledge entries not re-verified against node_modules
Task 10: fix round 1 dispatched (resumed a1472f99499a07d99) FIX_BASE=7fc1a17
Task 10: fix round 1 implementer DONE 65d8357,3fbca88 (196/196, e2e 23/23); re-review dispatched
Task 10: fix round 1/5 (2 addressed + doc wording, 0 open; commits 7fc1a17..3fbca88)
Task 10: note: watch now established only after listing succeeds — window between list return and watch setup relies on focus/F5 (documented)
Task 10: complete (commits edee950..3fbca88, review clean after 1 fix round)
Final review: dispatched (opus) range 6ee6aff..3fbca88 (plan start; branch merge-base with main ab31d6e includes reviewed M1-1)
Final: controller gate at 3fbca88: typecheck+lint+test(196/196)+build+e2e(23/23) exit 0
Final review: Ready to merge: With fixes — I1 focus refetch never fires (focusManager only visibilitychange); I2 remount/re-expand shows stale cached listing (staleTime Infinity); I3 async watch error with dir present → infinite re-watch/re-list loop (inferred); I4 watch handles may block ancestor rename (verify); I5 renderer never cancels listings (vfs.cancel unused)
Final: controller verified I4 on this machine (node fs.watch + PowerShell Rename-Item): watching B blocks renaming its parent A (Access denied); renaming the watched dir itself or its children is OK; watching root then renaming child OK
Final: Ruling: I4 is a requirement-level trade-off (live updates vs. not interfering with user's Explorer rename/move of ancestor folders) — not fixed in the fix wave; documented as verified known limitation; surfaced to user with options (keep fs.watch / one recursive watch per entry root / polling-only + focus refresh) — cost if wrong: users get "access denied" renaming parents of expanded folders until decided
Final: Ruling: focus-refetch cost on big network dirs — throttle with directory staleTime ~2s + refetchOnMount/refetchOnWindowFocus true (fixes I1+I2 together) — cost if wrong: at most one extra listing per 2s per expanded dir on focus/remount
Final: Ruling: openPath executing .exe/.bat/.ps1 etc., virtual-file drop options (3, corrected), hidden-attribute files, add-always-appends → surfaced to user as decisions, not changed now — cost if wrong: current behavior persists until decided
Final: Ruling: remove-button style (non-destructive, default focus Cancel) kept; multi-window semantics deferred to M3
Final: fix wave dispatched (opus, single fixer): I1+I2, I3, I5, doc/knowledge corrections, cheap minors #29 #51 #57, docs for I4 + Task7-I1 three options
Final: fix wave agent=a6911f6246d20f86d FIX_BASE=3fbca88
Final: fix wave DONE_WITH_CONCERNS 05e10ea..07e1707 (212/212, e2e 28/28); doc v1.8; concerns: backoff cleared when URI leaves all sets; real Alt+Tab focus unverified (synthetic focus event); scoped re-review dispatched
Final: controller tried OS-level real focus switch (CDP connect + SetForegroundWindow/FindWindow): GetForegroundWindow/FindWindow returned 0 in this environment → real Alt+Tab refresh remains unverified → added to user manual checklist
Final: fix wave re-review: all items ADDRESSED, no new Critical/Important (05e10ea..07e1707)
Final: Ruling: residual — error rows without data bypass the 2s staleTime, so each focus re-lists unreachable entries (loading flash, readdir occupies libuv threads); doc 8.3 "2 秒以内不重复列出" not true for such rows — parked (no second fix wave), surfaced to user — cost if wrong: VPN-down UNC entries re-list on every Alt+Tab
Final: Ruling: residual — backoff also applies to delete-type invalidation (quickly re-created real subdir unwatched up to 60s; documented) — parked — cost if wrong: up to 60s without live updates for that dir
Final: minor (deferred): deleting a no-longer-current workspace still switches to default; rename dialog title says "current"; >500 watch warning not deduplicated; invalidated entry debounce timer not cleared on dispose
Final: gate at 07e1707 exit 0 (212/212, e2e 28/28), no leftover processes; workspace deleted after copying ledger
```
