# 测试与验证

### 页面截图看不到系统绘制的内容（窗口按钮、边框）

- 日期：2026-11-18
- 症状：Playwright 的 `page.screenshot()` 中，标题栏右上角一片空白，看不到系统窗口按钮遮挡边框的问题。
- 原因：页面截图只包含网页内容；Window Controls Overlay、窗口边框等由系统绘制在网页之外。
- 解决：系统级截屏：用 Playwright 启动应用，在主进程中取窗口坐标（Windows 下用 `screen.dipToScreenRect(win, win.getBounds())` 换算为物理像素），再用 PowerShell 的 `System.Drawing` `CopyFromScreen` 截取（需先 `SetProcessDPIAware`）。脚本：[`scripts/os-screenshot.mjs`](../scripts/os-screenshot.mjs)。
- 预防：涉及窗口外观（标题栏、边框、系统按钮）的改动，用系统级截屏确认，不要只看页面截图；也不要把肉眼确认留给需求方。

### 验证系统处理的交互（双击标题栏最大化等）

- 日期：2026-11-18
- 症状：Playwright 的 `dblclick` 发送的是页面内事件，不经过系统的标题栏（拖动区域）逻辑，无法验证双击最大化、拖动贴靠等系统行为。
- 解决：系统级鼠标事件：在主进程中用 `screen.dipToScreenPoint` 把目标点换算为屏幕坐标，再用 PowerShell 调用 user32 的 `SetProcessDPIAware`、`SetCursorPos`、`mouse_event`（按下 2 / 抬起 4）点击；之后用 `BrowserWindow.isMaximized()` 读取结果。
- 预防：文档中描述系统行为前先这样实测；未实测的写明「未验证」。

### 外壳布局没有撑满窗口（下方大片空白），测试与局部截图都没发现

- 日期：2026-11-18
- 症状：系统级截屏中，状态栏位于窗口中部（视口 752px，状态栏底部只到 465px），下方空白。
- 原因：从 Next.js 改为 Vite 后，React 挂载在 `<div id="root">` 上，而全局样式只给 `html`、`body` 设了 `height: 100%`，外壳的 `h-full` 落空。迁移后只看了标题栏右上角的局部截图，没有看整窗，因此漏掉。
- 解决：`apps/desktop/src/renderer/src/styles/globals.css` 中 `#root { height: 100% }`；e2e 断言状态栏底部等于视口高度。
- 预防：技术栈或布局结构变更后，看一次**整窗**截图；布局的关键不变量（撑满视口）写成断言。

### e2e：`locator('header')` 匹配到多个元素

- 日期：2026-11-18
- 症状：strict mode violation：标题栏与欢迎区都用了 `<header>`。
- 解决：按无障碍角色定位：顶层标题栏是 `getByRole('banner')`，状态栏是 `getByRole('contentinfo')`。
- 预防：e2e 优先用 role / name 定位。

### e2e：同一数据目录连续启动两次

- 日期：2026-11-18
- 症状：（预防性）
- 原因：应用有单实例锁，锁按 userData 区分；前一个进程未完全退出时，后一个会立即退出。
- 解决：每个测试用 `mkdtempSync` 建独立的 `PCH_USER_DATA_DIR`；需要「重启」的测试先 `await app.close()`。
- 预防：—

### 测量启动时间

- 日期：2026-11-18
- 方法：以 `<userData>\logs\main.log` 出现的时间为准（`--user-data-dir` 指向临时目录，避免污染正式数据）。首次启动包含杀毒软件扫描时间，需至少测两次。
