# 导航、同步与资源树改进（M1-3b）：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 应用级地址栏（后退 / 前进 / 上一级 / 刷新 + 从工作区开始的逻辑路径）、工作区总览视图、树 ↔ 地址栏 ↔ 预览区同步、按类型的图标、资源树工具栏与分组抽屉。

**Architecture:** `packages/shared/src/layout` 扩展为「位置 + 标签历史」；渲染端新增 `features/address-bar`；工作区总览是 `features/preview` 的内置视图；树与标签经 `stores/` 同步（feature 之间不互相 import）；`FileIcon` 放在 `@pch/ui`。

**Spec:** [`devDoc/2026-11-19-15-navigation-design.md`](./2026-11-19-15-navigation-design.md)；现状 `doc/` v1.15、[M1-3 记录](./2026-11-19-14-m1-3.md)。

## Global Constraints

- 原型优先：只做设计第 2 节；简报之外的问题只修明显 / 重要的，其余记录。
- 测试范围按改动判断（`CLAUDE.md`）；全量在 Task 6 由控制者兜底。
- 文件系统原则不变；复制路径 / URI 一律真实路径。
- 分层：feature 之间不互相 import（经 `stores/` / `app/` 组合）；插件只用 `@pch/plugin-sdk`、`@pch/ui`、`lucide-react`、`@tanstack/react-virtual`；新目录在 `eslint.config.mjs` 登记。
- 三语文案同时添加；shadcn 组件保持原样。
- 结构变化同一提交更新 `doc/`；Task 6 升为 v1.16。

## Review Focus

1. 后退 / 前进：导航后历史正确入栈、后退后再导航会清空前进栈；关闭标签后历史随之消失。→ Task 1 单元测试。
2. 「上一级」在条目根处到工作区总览、在总览处不可用；条目之外的目录退化为磁盘上的上级。→ Task 1 单元测试。
3. 同步不形成循环：树选中 → 预览打开 → 激活标签变化 → 树选中（同一节点）不应再次触发打开或无限重渲染。→ Task 3 测试。
4. 键盘 ↑↓ 防抖预览：快速连按只打开最后停留的节点。→ Task 3 e2e。
5. 分组抽屉：展开一个顶层分组时其他顶层分组收起；被收起分组内的选中项与展开状态不丢（重新展开后恢复）。→ Task 5 测试。

---

### Task 1: 位置、标签历史与工作区总览

**Files:** `packages/shared/src/layout/*`（位置类型、历史、`tab/back` / `tab/forward`、`tab/navigate` 入栈）、渲染端逻辑路径纯函数（`lib/` 或 `stores/` 中，供地址栏与预览区共用，例如 `lib/logical-path.ts`）、`features/preview`（工作区总览内置视图；`pch-workspace:` 位置的渲染；宿主新增 `tabs.up()`；folder 插件移除内部面包屑与「上一级」按钮、Backspace / Alt+↑ 改调 `host.tabs.up()`）、`stores/tabs-store.ts`、三语资源、doc 9 / 11 节

**Interfaces（Produces）:**

```ts
export type LocationKind = 'workspace' | 'directory' | 'file'
export interface TabLocation { uri: string; kind: LocationKind; title: string }   // workspace: uri = 'pch-workspace:<id>'
// TabState 增加 history: { back: TabLocation[]; forward: TabLocation[] }（上限各 50）
// 新 action：{ type: 'tab/back'; id } | { type: 'tab/forward'; id }
export interface PathSegment { label: string; target: TabLocation; kind: 'workspace' | 'entry' | 'dir' | 'file' }
export function logicalPath(loc: TabLocation, ctx: { workspace: { id: string; name: string }; entries: WorkspaceEntry[] }): PathSegment[]
export function parentLocation(loc: TabLocation, ctx: …): TabLocation | null   // 条目根 → 工作区总览；总览 → null；条目之外 → 磁盘上级
```

- 别名：条目段的 `label` 为条目标签（`WorkspaceEntry.label`）；标签标题在条目根时也用别名。
- 工作区总览：分组为分节、folder / file 条目为项（`FileIcon` 在 Task 4 才有，本任务先用现有图标），双击 folder → 当前标签导航，双击 file → 常驻打开。

- [ ] **Step 1: 写失败的测试**：reducer 的历史（Review Focus 1）；`logicalPath` / `parentLocation`（Review Focus 2，含驱动器根条目、UNC 条目、条目之外、file 条目）；e2e：工作区总览列出条目、双击进入；目录视图 Backspace 回到上一级直至总览。
- [ ] **Step 2–4:** 失败 → 实现 → 通过（受影响的单元测试 + typecheck / lint / prettier + build + 相关 e2e）。
- [ ] **Step 5: 提交** `feat(tabs): add tab history, logical locations and the workspace overview`

### Task 2: 应用级地址栏

**Files:** `features/address-bar/*`（新 feature，`eslint.config.mjs` 登记）、`features/shell`（标题栏下方新增一行插槽 `addressBar`）、`app/app.tsx`、`stores/tabs-store.ts`（读激活标签、发 back / forward / navigate / up）、`features/preview` 中刷新入口改由地址栏触发（宿主或 store 暴露刷新当前标签）、三语资源、doc 12.2 节、e2e

**Interfaces:**

- 布局：`[←][→][↑][⟳]  工作区 ▾ › 条目别名 › 段 … › 文件名`；按钮在不可用时禁用；段过长时中间省略并可横向滚动；段悬停显示真实路径（工作区段除外）。
- 工作区段下拉：列出工作区，选中 = 切换工作区（复用 `features/workspace` 的切换逻辑需经 `stores/` 或 `app/` 组合，不直接 import）。
- 快捷键：`Alt+←` / `Alt+→`、鼠标侧键（`mouseup` 的 button 3 / 4）、F5 刷新（全局，焦点在输入框时除外）。

- [ ] **Step 1: 写失败的测试**：e2e：打开目录后地址栏显示「工作区 › 条目 › 子目录」；点击段导航；后退 / 前进按钮与 Alt+← / Alt+→；选中文件时显示文件名；工作区下拉切换工作区；别名显示（重命名条目后地址栏更新）。
- [ ] **Step 2–4:** 失败 → 实现 → 通过。
- [ ] **Step 5: 提交** `feat(address-bar): add the application address bar`

### Task 3: 树 ↔ 地址栏 ↔ 预览区同步

**Files:** `features/explorer`（单击只选中 + 预览、不展开；双击 / 箭头 / → ← / Enter 展开折叠；↑↓ 200ms 防抖预览；文件双击 / Enter 常驻）、`stores/`（激活位置 → 树选中的请求，复用 `navigation-store` 的定位机制）、`features/explorer/use-reveal.ts`（激活标签或标签内导航后在树中选中并滚动，位置不在树中则不变）、e2e

- [ ] **Step 1: 写失败的测试**：e2e：单击目录不展开；箭头与双击展开；目录视图进入子目录后树选中该子目录（祖先自动展开）；后退后树跟随；切换标签后树跟随；↑↓ 快速连按只预览最后停留的节点（Review Focus 4）；同步不循环（Review Focus 3：选中后打开次数与渲染稳定，可用计数断言）。
- [ ] **Step 2–4:** 失败 → 实现 → 通过。
- [ ] **Step 5: 提交** `feat(explorer): keep the tree, address bar and preview in sync`

### Task 4: 按类型的图标

**Files:** `packages/ui/src/file-icon.tsx`（`FileIcon({ name, kind, target })` 与扩展名映射表，导出；不改 shadcn 生成的组件）、`features/explorer/tree-row.tsx`、`plugins/builtin/src/folder/*`、工作区总览、单元测试

- [ ] **Step 1: 写失败的测试**：映射表纯函数（`iconFor(name, kind)` 对代表性扩展名返回预期类别、未知 → 兜底、大小写不敏感、目录 / 链接 / 失效链接）。
- [ ] **Step 2–4:** 失败 → 实现 → 通过；页面级截图确认（ja 浅色）。
- [ ] **Step 5: 提交** `feat(ui): show file type icons in the tree and the folder view`

### Task 5: 资源树工具栏与分组抽屉

**Files:** `features/explorer/*`（标题栏按钮：全部折叠、定位到当前项；分组抽屉：顶层分组以分节标题显示、互斥展开、未分组条目在上方）、`explorer-store.ts`、三语资源、doc 8.2 节、e2e

- [ ] **Step 1: 写失败的测试**：单元：互斥展开的状态变换（Review Focus 5）；e2e：全部折叠；定位到当前项（打开深层目录后折叠，再点定位 → 展开并选中）；展开分组 A 再展开 B → A 收起、重新展开 A 恢复其内部展开状态；未分组条目始终可见。
- [ ] **Step 2–4:** 失败 → 实现 → 通过。
- [ ] **Step 5: 提交** `feat(explorer): add collapse all, locate and accordion groups`

### Task 6: 收尾

**Files:** `doc/`（v1.16：8.2、9、11、12 节）、`devDoc/2026-11-19-17-navigation.md`（新建并登记：做了什么、已验证 / 未验证、控制者决定、记录的问题）、页面级截图（scratchpad）

- [ ] **Step 1:** 文档与截图。
- [ ] **Step 2:** 控制者全量检查兜底。
- [ ] **Step 3: 提交** `docs: document navigation, sync and tree improvements`
