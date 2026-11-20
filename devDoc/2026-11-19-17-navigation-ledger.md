# SDD ledger — plan: C:/Users/yongjun.fu/Desktop/PremiumCowHorse/devDoc/2026-11-19-16-navigation-plan.md

Setup: 分支 feat/m1-workspace（M1 完成后合并）。Spec: devDoc/2026-11-19-15-navigation-design.md（需求方 10 条 + 控制者决定，第 4 节待确认）。原型优先；测试按改动；全量在 Task 6 兜底；Minor 只记录。中文。

## Pre-flight

| 任务对 | 生产 → 消费 | 结论 |
| T1 → T2 | TabLocation / history / logicalPath / parentLocation / tabs.up | 一致 |
| T1 → T3 | 激活位置 → 树选中 | 一致 |
| T1 → T4 | 工作区总览先用现有图标，T4 换 FileIcon | 一致 |
| T2 ↔ T1 | 刷新入口从目录视图移到地址栏：T1 移除目录视图的面包屑 / 上一级，刷新按钮 T2 再移（T1 期间保留刷新按钮） | 顺序执行，无冲突 |
| T3 / T5 | 都改 features/explorer | 顺序执行 |
Pre-flight: no rulings needed
Task 1: dispatched implementer (opus) BASE=a385869
Task 1: implementer DONE 61ed035 (scoped: 419 unit, build OK, folder/tabs/preview e2e 14 x2) agent=a5481e06a1262a913; decisions: outside-entry locations also start with workspace segment (drive/share root's parent = overview); back/forward promote + clear viewState; navigate to same URI not recorded; file entry's parent = overview
Task 1: Ruling: explicit refresh (button / F5 → vfs.refresh) must bypass the scanner's 2s P0 dedupe — otherwise F5 right after a listing is silently dropped (user-visible) — cost if wrong: one extra listing per explicit refresh
Task 1: issues recorded: tab titles are snapshots (not updated on entry/workspace rename or language switch); host.fs.rootOf now unused
Pending user decision (asked): single click = open in current tab, double-click = new tab (files); dirs: double-click toggles, middle/Ctrl+click new tab; ↑↓ replaces history step; drop preview tabs; folder view double-click file → current tab
Task 1: dispatched reviewer (sonnet)
Task 1: review ❌ (refresh dedupe bypass ruling not implemented; e2e waits 2.5s to dodge it); history / logical path / overview / pch-workspace isolation verified
Task 1: minor (deferred): back/forward clear viewState; tab titles snapshot; fs.rootOf unused; PluginView host rebuild on entries change; toResourceInfo kind rewrite
Task 1: fix round 1 dispatched (resumed a5481e06a1262a913) FIX_BASE=61ed035
User (2026-11-20): open rules settled → design §2.8 (click = current tab, middle/Ctrl+click = new tab, dir dblclick toggles, ↑↓ debounced open WITH history, preview tabs removed, folder view dblclick file = current tab); carry into Task 3
Task 1: fix round 1 DONE 467c3e9 (refresh passes force; queued merge kept; also not merged into in-flight read; dedupe test split; 2 waits removed; doc 8.3/9.4, knowledge) → scoped re-review (sonnet)
Task 1: re-review round 1 — both findings ADDRESSED, no new breakage
Task 1: complete (commits a385869..467c3e9, review clean after 1 fix round)
Task 2: dispatched implementer (opus) BASE=467c3e9; controller supplement task-2-supplement.md (refresh via store nonce + host.tabs.onRefresh, folder view refresh button/F5 removed; workspace dropdown composed in app/; segment click per §2.8; side buttons via mouseup 3/4)
Task 2: implementer agent=a6b16b962cb6432fd
User (2026-11-20): ↑↓ debounce 200ms → 400ms (design §2.8, plan Task 3 updated); carry into Task 3
Task 2: implementer DONE_WITH_CONCERNS eecae31 (150 unit, build, address-bar e2e 3x2, folder/tabs/preview/explorer 31; OS-level side-button check) — concerns are observations → review
Task 2: decisions: workspace dropdown calls data/workspace activate directly; refresh = tabs-store refreshSeq + host.tabs.onRefresh, file tab re-stat in container, overview re-fetches entries; F5 with tree focus refreshes tree only; side-button mouseup also preventDefault; path segments hidden scrollbar + wheel→horizontal + scroll to end (knowledge)
Task 2: issues recorded: shortcuts (Alt+←/F5) still act on the tab behind an open dialog; middle/Ctrl+click on an already-open location only activates it (reducer same-URI dedupe); other e2e (app.spec etc.) not run → Task 6 gate; devDoc record → Task 6
Task 2: dispatched reviewer (sonnet)
Task 2: review ✅ spec, quality Approved; ⚠️ explorer F5 preventDefault — controller verified explorer-view.tsx:52 calls preventDefault and the global listener skips defaultPrevented
Task 2: minor (deferred): shortcuts act behind modal dialogs; address bar shows absolute-path segments briefly while entries load; refreshSeq not cleaned on tab close; middle/Ctrl+click on open URI only activates; onWheel scrolls when not overflowing; side-button e2e synthetic only; devDoc record → Task 6 (devDoc 17)
Task 2: complete (commits 467c3e9..eecae31, review clean)
Task 3: dispatched implementer (opus) BASE=eecae31; controller supplement task-3-supplement.md carries design §2.8 (400ms debounce, preview tabs removed, setting key kept with new meaning)
Task 3: implementer agent=a3fc56960ae4da574
Task 3: implementer DONE_WITH_CONCERNS b56960b (424 unit, build, tabs/tree-sync e2e 12 x2, affected old specs 53+2 fixed) — preview tabs removed (TabState.preview, tab/promote, italic, SDK preview opt); tabs-store.openHere added
Task 3: Ruling: folder view / overview keep single click = select, double-click / Enter = open in current tab (supplement items 1 vs 4 conflict; design §2.8 line "目录视图中双击…" is the specific rule; single-click navigating inside a list would make selection impossible) — cost if wrong: one-line behaviour change; listed for user confirmation
Task 3: decisions: setting off → ↑↓ only select; 400ms debounce applies to all keyboard selection moves (incl. → ← to child/parent); sync request issued from navigation-store subscribing tabs-store; folder rows: no context menu "open in new tab" (middle / Ctrl+click / Ctrl+Enter only)
Task 3: issue: explorer.singleClickPreview has no UI text yet (no settings screen) → supplement item 7 copy N/A; doc setting meaning to be checked in review
Task 3: dispatched reviewer (sonnet)
Task 3: review (opus) ✅ spec, quality Approved; ⚠️ folder view/overview single-click semantics → covered by existing Ruling (user confirmation item); ⚠️ setting copy absent → N/A (no settings UI yet; schema comment + doc updated)
Task 3: minor (deferred): sync reveal selects deepest reached ancestor when target not found/timed out (should keep selection); in-flight sync reveal not cancelled by user's own selection (slow shares: selection pulled back); right-click select does not cancel debounce; menu-items test not RED first; 53 old e2e not re-run after spec-only fix → Task 6 gate
Task 3: complete (commits eecae31..b56960b, review clean)
Task 4: dispatched implementer (sonnet) BASE=b56960b; supplement task-4-supplement.md (file-icon.tsx outside components/, new exports entry, verify lucide names in node_modules)
Task 4: implementer agent=a57ae396e83d99f6e
Task 4: implementer DONE_WITH_CONCERNS 614d1e3 (34 new map tests RED→GREEN, ui+plugins 46, build, folder/explorer/tree-sync e2e 20); decisions: iconFor in lib/file-icon-map.ts (react-refresh lint), presentation = PresentationIcon, js = code, overview uses real filename not alias
Task 4: controller looked at screenshot (ja light): icons render in tree + folder view, all monochrome outline — distinguishable but subtle. Issue recorded for user: PDF shares FileTextIcon with text; consider per-category colour later (goal 7 "look cool")
Task 4: dispatched reviewer (sonnet)
Task 4: review ✅ spec, quality Approved; ⚠️ lucide names / lint — covered by implementer's typecheck+build+lint exit 0 (wrong lucide names fail typecheck)
Task 4: Ruling: broken-link icon colour conflict (string concat vs text-muted-foreground) — carried into Task 5 as a small fix (M1-2 behaviour regression, cheap) — cost if wrong: none
Task 4: minor (deferred): PDF shares FileTextIcon with text (user to decide); tree-row FS_KIND has unused group/folder keys
Task 4: complete (commits b56960b..614d1e3, review clean)
Task 5: dispatched implementer (opus) BASE=614d1e3; supplement task-5-supplement.md
Task 5: implementer agent=a9da9516145f24592
Task 5: implementer DONE_WITH_CONCERNS 236801b (179 unit, 19 RED first, build, drawer e2e 2x2, affected e2e 55 incl. app/search/nested; broken-link cn fix with unit test)
Task 5: Ruling: drawer header single click toggles open/close without selecting (accordion convention; selecting first would break Review Focus 5 restore by mouse) — differs from "dir single click = select/open" — cost if wrong: small; listed for user confirmation
Task 5: decisions: hidden selection shows nearest visible ancestor as selected (store unchanged); locate disabled for no tab / overview / outside-entry; root-level drop snaps to nearest same-kind entry (ungrouped stays above groups); explorer.spec drag test rewritten (two steps, target README.md, count 5→6)
Task 5: issue: tree orders group children by sortOrder (mixed), overview shows items before subgroups — inconsistency recorded
Task 5: controller looked at screenshot (light): toolbar locate / collapse-all / refresh; ungrouped entry above; top-level groups as emphasized drawer headers; only 本番環境 open — OK
Task 5: dispatched reviewer (sonnet)
Task 5: review ✅ spec, quality Approved (accordion keeps descendants' expansion; root drop index consistent with entry.move)
Task 5: minor (deferred): re-expanding a drawer whose selected node's dir is still loading may overwrite hidden selection with the drawer (cache-dependent); drawer header click doesn't select (F2/Delete act on previous selection) — user confirm; tooltips on disabled toolbar buttons; group children mixed by sortOrder; no e2e for drop into collapsed group
Task 5: complete (commits 614d1e3..236801b, review clean)
All tasks implemented. Controller full gate running (bjizz3qul). Final whole-plan review dispatched (opus) a385869..236801b; Task 6 docs deferred until after the final fix wave
Final review (opus): no Critical/Important; Review Focus 1–5 and §2.8 verified; suggests fixing minors 1 and 3
Final: Ruling: re-graded by user-visible effect — fix wave = (1) drawer re-expand loses selection after gcTime, (2) back/forward clears viewState, (3) sync reveal selects deepest ancestor on not-found, (4) shortcuts act behind modal dialogs — all cheap and user-visible — cost if wrong: small extra work
Final: minor (deferred): refreshSeq not cleaned; address bar absolute segments before entries load; overview vs tree group-child order; PDF/text same icon; FS_KIND unused keys; fs.rootOf unused; preview host rebuild on entries change; debounce timer across workspace switch (extremely short window)
Final: user confirmation items: folder view/overview single click = select; drawer header click doesn't select; middle-click on open URI only activates; icon colour
Final fix brief: final-fix-brief.md — waiting for the full gate before dispatch
Controller full gate @236801b: typecheck/lint/prettier/unit (64 files, 824)/build/e2e (63 passed, 9.2m) EXIT=0; no leftover processes
Final fix wave dispatched (opus) FIX_BASE=236801b agent=a593b041b73373a16
Final fix wave DONE 0b46f8b (184 unit, build, 21 e2e incl. 2 new x2) → scoped re-review (sonnet)
Final fix wave re-review (sonnet): all 4 ADDRESSED, no new Critical/Important (reviewer skipped ~220 diff lines of e2e/doc → covered by the post-Task-6 full gate)
Final: minor (deferred): OPEN_MODAL_SELECTOR also matches non-modal role=dialog (no Popover in app yet); scroll save debounced 150ms; permanently failing dir keeps selection on ancestor; each selection writes tabs-store (extra render; no perf measurement)
Task 6: dispatched (sonnet) BASE=0b46f8b; supplement task-6-supplement.md
Task 6: complete (commits 0b46f8b..9bf0762) — doc v1.16, devDoc 17 record, screenshots ja-light / zh-CN-dark / en-light (controller viewed zh-CN dark: OK)
Controller full gate @9bf0762: typecheck/lint/prettier/unit (64 files, 833)/build/e2e (65 passed, 9.3m) EXIT=0; no leftover processes
Plan complete; ledger saved to devDoc/2026-11-19-17-navigation-ledger.md; workspace deleted
