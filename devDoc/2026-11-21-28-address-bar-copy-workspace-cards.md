# 地址栏与工作区一览的追加修改：图标、工作区部分、复制路径、卡片式一览

日期：2026-11-21　｜　分支：`feat/m2-preview-plugins`（与第 26 轮的改动同一个提交）　｜　前一轮：[26 M2 试用反馈的修改](./2026-11-21-26-m2-feedback.md)

## 需求方原话

1. 工作区的图标使用 gallery-vertical 吧
2. 地址栏点击最后一级，也就是当前地址，或者之后的空白处，可以复制路径。
3. 工作区一览使用卡片式展示。添加也使用一个卡片。
4. 地址栏的工作区和后面的地址也做一下区分。

## 做法与决定（控制者自行判断的部分标「决定」）

### 1. 工作区图标

- lucide `GalleryVerticalIcon`（lucide-react 1.73.0 中存在，类名 `lucide-gallery-vertical`，e2e 断言）。
- 换掉的地方：地址框的工作区按钮、工作区一览标签的图标（一览卡片最初也有图标，第二轮按需求方要求去掉）。
- 决定：资源树与工作区总览的「分组」仍用 `LayersIcon`，正好解决上一轮「分组与工作区按钮图标重复」的待确认项；工作区总览标签仍为 `LayoutGridIcon`（总览是「一个工作区的内容」，不是「工作区」本身）；标题栏切换器（文字 + ▾）不变。

### 2. 复制路径

- 单击当前位置（最后一段，不带修饰键）或段后面的空白处（地址框本身或段列表的空白）→ `system.copyText` 写入剪贴板，并提示「パスをコピーしました」（文件 / 目录为 Windows 路径；其他如网页为 URI，提示「URI をコピーしました」）。
- 决定：工作区总览 / 一览没有真实路径 → 不动作（不复制工作区名）。
- 决定：`Ctrl+单击` / 中键当前段仍在新标签打开（保持 2.8 节的修饰键语义）；原来单击当前段什么也不做，现在改为复制。
- 悬停提示：当前段与空白处为「路径 + 换行 + クリックでパスをコピー」（新 i18n 键 `addressBar:copyHint`，三语）；其他段的 `title` 为路径，工作区段为 `title=""`（不继承地址框的复制提示）。

### 3. 卡片式工作区一览

- `grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3`，页面最大宽度与工作区总览相同（`max-w-5xl`）。
- 工作区卡片：图标（muted 底的圆角方块）、名称、「使用中」标记、最近使用时间；当前工作区边框用强调色（`border-primary/50`）；右上角「…」菜单；右键菜单不变。卡片是自己的元素（packages/ui 没有 shadcn Card，也不需要为此加组件），样式写在 className 上。
- 「新建」卡片：网格最后一张，虚线边框 + 加号 + 「新しいワークスペース…」；原来标题右侧的「新建」按钮去掉。
- 决定：工作区卡片保持「单击选中、双击 / Enter 切换」（与上一轮确认的一览行为、工作区总览的条目一致）；新建卡片是操作，单击 / Enter 直接打开对话框。
- 键盘：←→ 按阅读顺序、↑↓ 到相邻行水平中心最近的卡片、Home / End（新文件 `features/workspace/grid-nav.ts` 的纯函数 `gridNeighbor`，按实际位置计算，列数随宽度变化），新建卡片也在其中。

### 4. 工作区部分与路径的区分

- 工作区按钮 + 第一段（工作区；一览页时为一览段）合成地址框左端的一块：`bg-background`、细边框、`shadow-xs`、圆角，与浅底（`bg-muted/50`）的地址框形成对比；路径段跟在其后（`›` 分隔）。
- 决定：这一块是段列表的第一项并设 `sticky left-0`，路径很长横向滚动时它固定在左端，工作区这一级始终可见（原来工作区段会随路径滚出去）。

## 第二轮反馈（同日）

需求方原话：

1. 地址栏的工作区部分不要再嵌套一个盒子，直接使用背景色边框等区分区域就行了，现在又嵌套了一个方框，圆角和外面还不统一。
2. 卡片不用再显示图标了。
3. 卡片的重命名删除不要折叠隐藏起来，直接使用按钮。
4. 当窗口缩小，新建卡片与已有工作区的卡片处于不同行时，高度不一致。
5. （追加）目前暗色下工作区块对比不够明显。

做法：

- 1 / 5：工作区部分去掉自己的边框、圆角与阴影，改为撑满框高（`self-stretch`）、右侧一条分隔线（`border-r`）的区域；地址框加 `overflow-hidden`、去掉左内边距，区域左侧的圆角由框裁出，与框一致。底色：原来的 `bg-background` 在暗色下比框（`bg-muted/50`）更暗，差别很小；去掉边框和阴影后亮色下白底对浅灰也不明显。改为在背景色上叠加前景色（亮色 7%，暗色 20%：亮色比框深一点，暗色比框亮一点）。决定：用不透明的 `color-mix(in oklch, var(--background), var(--foreground) N%)`，不用半透明的 `bg-foreground/N`，因为这块是 sticky 的，路径滚动时从它下面经过，半透明会透出下面的段。
- 2：卡片去掉图标（`GalleryVerticalIcon` 只剩地址框按钮与一览标签）。
- 3：「…」菜单换成卡片右下角直接显示的 `icon-xs` 按钮（重命名 / 恢复默认名称 / 删除，与右键菜单同一份操作；删除用 destructive 变体）；按钮的 `aria-label` / 悬停提示为操作名。不再使用的 i18n 键 `workspace.actions` 三语一并删除。
- 4：网格加 `auto-rows-fr`，各行等高。原因：卡片高度由内容决定（当时工作区卡片有图标，比新建卡片高），换行后不同行各自取本行的高度。

## 改动的文件

- `apps/desktop/src/renderer/src/features/address-bar/address-bar.tsx`：图标、工作区部分、复制路径（`pathOf`、`copyCurrentPath`）。
- `apps/desktop/src/renderer/src/features/workspace/workspaces-page.tsx`：卡片网格、新建卡片、网格键盘移动。
- `apps/desktop/src/renderer/src/features/workspace/grid-nav.ts`（新）+ `grid-nav.test.ts`（新）。
- `apps/desktop/src/renderer/src/features/tabs/tab-bar.tsx`：一览标签图标。
- `packages/i18n/src/locales/{ja,zh-CN,en}.ts`：`addressBar.copyHint`。
- `e2e/address-bar.spec.ts`：新增「复制路径」「工作区部分」两个用例；图标类名、一览的键盘操作（↓↑ → →/Home）、当前段 / 工作区段的 `title` 断言按新行为修改。
- `doc/PremiumCowHorse-架构设计方案.md`：v1.21（11.1 工作区一览、12.2 地址栏、标签栏图标）。

## 验证

已验证（2026-11-21，本轮实际运行）：

- `pnpm typecheck` 通过；改动文件的 `eslint`、`prettier --check` 通过。
- 单元测试：`features/workspace`（含新 `grid-nav.test.ts` 4 条）与 `lib/logical-path.test.ts` 共 35 条通过。
- `pnpm build` 通过；e2e `address-bar.spec.ts` + `tabs.spec.ts` 共 16 条通过（第一次跑出 2 条失败，均为用例预期与新行为不符：文件段 `title` 多了复制提示；Ctrl+单击当前段时同 URI 已打开 → 按 `tab/open` 只激活、不会出现第二个标签。按行为修正用例后重跑通过）。
- 系统级整窗截图（`scripts/os-screenshot.mjs` 的同法脚本，亮色 / 暗色，ja）：地址框中工作区部分的底色与路径区分可见；一览卡片、新建卡片的虚线边框（首版过淡，加深为 `border-muted-foreground/40` 后重截）可见。
- 第二轮：typecheck、改动文件的 eslint / prettier 通过；`pnpm build` 后 `e2e/address-bar.spec.ts` 全部 12 条通过（新增断言：卡片主按钮内没有图标、卡片上直接有「Rename…」/「Delete…」按钮且默认工作区没有删除按钮、窗口缩到 900×700 使卡片分成多行时各卡片高度相同）。重新截图（亮色 / 暗色）：工作区区域没有内框，左侧圆角与地址框一致，暗色下与路径部分的对比明显。

未验证：

- 全量 `pnpm test` / `pnpm test:e2e` 未在本轮重跑（改动限于地址栏、一览页、标签图标与文案，按「测试范围按改动判断」只跑了受影响部分）。
- 路径很长时工作区部分固定在左端（sticky）只在代码层面实现，没有截图确认。
