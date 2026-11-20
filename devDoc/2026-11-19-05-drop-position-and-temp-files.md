# 按松手位置插入与拒绝临时文件（Task 9）

- 日期：2026-11-19
- 计划：[03 刷新与缓存引擎 + 文件名搜索：实施计划](./2026-11-19-03-refresh-cache-plan.md) 的 Task 9；设计见 [01](./2026-11-19-01-refresh-cache-design.md) 4.10 第 1、3 条与第 7 节第 10 条
- 分支：`feat/m1-workspace`

## 做了什么

- `EntryAddInput`（folder / file）增加 `position?: { before } | { after }` 与 `rejectTemporary?: boolean`。`WorkspaceService.addEntry` 在同一事务内读取同级、校验参照条目属于同一父节点（否则 `ENTRY_INVALID_PARENT`）、插入并把同级 `sort_order` 重排为 0..n-1；不带 position 时追加到末尾（`maxSortOrder` 不再被 addEntry 使用）。
- `rejectTemporary` 为 true 且路径位于注入的临时目录之下 → `ENTRY_TEMPORARY_PATH`（先于 `stat`）。比较方式：file URI 转本地路径，统一分隔符、按路径段、小写。临时目录由组合根注入（`app.getPath('temp')`），`WorkspaceService` 构造函数新增第 4 个参数。三语错误文案按简报原文。
- `resolveDrop` 的 add 动作带 `position`（before / after；展开分组的下缘 = 第一个子项之前；inside 与空白处不带）；系统拖入带 `rejectTemporary: true`，对话框添加与「固定真实子项」不带。
- 执行器：多项按拖入顺序依次插入（第一项用落点位置，之后每项插在上一项成功添加的条目之后）。
- URI 规范化只保留一份：`normalizeRootUri` / `prefixOf` / `isUnderUri` 移到 `packages/shared/src/vfs/normalize-uri.ts`（测试随迁），删除渲染端的 `normalizeFileUri`，主进程、扫描进程、渲染端都从 `@pch/shared` 引用；`eslint.config.mjs` 的 `vfs-portable` 登记去掉 `normalize-uri`。
- doc 8.1 / 8.2 与已知限制表改为新行为。

## 决定与限制

- 因 Chromium 临时副本目录的规律未实机确认，按简报拒绝 `app.getPath('temp')` 之下的所有系统拖入路径（同时不能把 %TEMP% 下的目录经系统拖入固定为条目）；副本仍由 Chromium 写入临时目录。
- 8.3 短文件名（`C:/Users/YONGJU~1/...`）形式的临时目录路径与 `app.getPath('temp')` 的长名形式不会互相匹配（未处理，未验证 Chromium 实际使用的形式）。
- 真实 zip 拖入无法自动化，只有单元测试。
