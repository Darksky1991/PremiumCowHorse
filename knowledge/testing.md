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

### vitest：`vi.spyOn` 拦截不到 `node:fs/promises` 的具名导入

- 日期：2026-11-18
- 症状：（预防性）想在测试中让某次 `lstat` 失败。
- 原因：ESM 的具名导入绑定不能被替换；只有通过对象调用的方法才能被 `vi.spyOn` 拦截。
- 解决：实现中 `import fs from 'node:fs/promises'` 并调用 `fs.lstat(...)`，测试中 `vi.spyOn(fs, 'lstat')`（见 `vfs/providers/local.provider.test.ts`）。断言要能证明拦截生效（例如被拦截的项确实不在结果中）。
- 预防：需要在测试中替换的依赖，优先用构造函数注入；不得已时用默认导入。

### 已实现的功能补写集成测试时，用「临时篡改断言」确认测试有效

- 日期：2026-11-18
- 症状：e2e 覆盖的是前面任务已经测试驱动实现的功能，写完就是绿的，无法证明它真的在检查。
- 解决：临时把一个期望值改错（如文件名），确认测试失败，再改回并确认全部通过。
- 预防：任何「写完就通过」的测试都这样做一次。

### 提交前的检查要用 `&&` 串联成门禁

- 日期：2026-11-18
- 症状：提交命令与检查命令用 `;` 串联，lint 报错后提交照样执行，带着错误进入了历史（`88d608a`，随后修复）。
- 解决：`pnpm typecheck && pnpm lint && npx prettier --check . && pnpm test && git commit ...`。
- 预防：自动化脚本里提交永远放在检查之后、用 `&&` 连接。

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

### e2e：合成原生拖放事件驱动 React 的拖放处理

- 日期：2026-11-18
- 方法：在 `page.evaluate` 中 `const dt = new DataTransfer()`，对来源行 / 目标行依次 `dispatchEvent(new DragEvent('dragstart' | 'dragover' | 'drop' | 'dragend', { bubbles: true, cancelable: true, dataTransfer: dt, clientX, clientY }))`。`dragover` 的 `defaultPrevented` 即「是否接受放置」，未被阻止时不再发 `drop`（与浏览器一致）。辅助函数见 `e2e/explorer.spec.ts` 的 `dragRow`。
- 限制：合成的 `File` 没有真实路径（`getPathForFile` 返回空字符串），系统文件拖入不能这样测（见 electron.md）。

### e2e：证明「磁盘没有被改动」用递归快照，而不是只比较文件名

- 日期：2026-11-18
- 方法：`e2e/support.ts` 的 `snapshotTree(root)`：递归 `lstat`，每项「相对路径 | 类型 | 大小 | mtime」排序后比较，根目录的 mtime 也记录。只比较 `readdirSync` 的文件名发现不了内容修改与子目录内的新建 / 删除。
- 有效性：快照后用 `utimesSync` 改一个 mtime，比较即失败（M1-2 Task 10 的篡改验证）。

### e2e：目录监听用例要等监听建立后再改磁盘（2026-11-19 起不适用）

- 日期：2026-11-18
- 症状：（预防性）展开目录后立刻在磁盘上新建文件，可能发生在监听建立之前而不被感知，用例偶发失败。
- 原因：渲染端在监听集合变化后 200ms 防抖才发送 `vfs.watch`，列目录请求则立即发出。
- 解决：展开并看到子项后 `page.waitForTimeout(1000)` 再改磁盘（`e2e/explorer.spec.ts`）；有效性用「渲染端不发送 vfs.watch」的篡改确认（用例失败）。
- 预防：不要靠窗口聚焦让用例通过——聚焦刷新会掩盖监听失效。2026-11-19 聚焦刷新实际生效后（目录列表 2 秒新鲜期），重新做了「渲染端不发送 vfs.watch」的篡改：三个 `watch:` 用例仍然失败，聚焦刷新没有掩盖监听失效（Playwright 下页面收不到真实的 focus，见下一条）。
- 现状（2026-11-19）：`vfs.watch` 与三个 `watch:` 用例已删除（改为扫描 + 缓存）。新的 `cache:` 用例依赖扫描进程按刷新间隔检查，见下文「e2e：扫描引擎的用例」。

### e2e：Playwright 默认开启焦点模拟，页面收不到真实的 focus / blur

- 日期：2026-11-19
- 症状：（M1-2 最终审查修复）想用真实聚焦验证「窗口重新获得焦点时刷新」：在主进程中 `BrowserWindow.blur()` / `focus()` / `minimize()` / `restore()`，或用系统级鼠标点击在两个窗口间切换，页面上 `window` 的 `focus` / `blur` 与 `visibilitychange` 一个都没有收到。
- 原因：playwright-core 1.65 在主 frame 上发送 CDP `Emulation.setFocusEmulationEnabled { enabled: true }`（`coreBundle.js`），页面始终认为自己已聚焦。用 `page.context().newCDPSession(page)` 关闭焦点模拟后能收到一次 `blur`，但本环境中系统级点击不改变窗口焦点（`BrowserWindow.isFocused()` 不变），仍无法得到真实的 `focus`。
- 解决：e2e 用 `page.evaluate(() => window.dispatchEvent(new Event('focus')))` 触发，与真实聚焦走同一个监听器（`focusManager.setEventListener` 注册在 `window` 上）；真实 Alt+Tab 记为未验证。
  - 2026-11-19 起渲染端不再监听聚焦（focusManager 的设置已删除），窗口焦点由主进程的 BrowserWindow `focus` / `blur` 事件告知扫描进程。e2e 改为在主进程中直接触发这两个事件：`app.evaluate(({ BrowserWindow }, e) => BrowserWindow.getAllWindows()[0]!.emit(e), 'blur')`（`focus:` 用例），只验证我们的接线，真实切换仍未验证。
- 预防：依赖焦点事件的行为不要假设 Playwright 能产生真实焦点切换；合成事件之外的验证需要手动或脱离 Playwright 进行。

### e2e：菜单项的无障碍名称包含快捷键文字；菜单 / 对话框打开时页面其余部分是 inert

- 日期：2026-11-18
- 症状：`getByRole('menuitem', { name: /^重命名$/ })` 找不到；菜单打开期间 `getByRole('treeitem')` 找不到树中的行。
- 原因：`ContextMenuShortcut` 的文字并入了菜单项名称（「重命名F2」）；Base UI 在菜单 / 对话框打开时把其余部分设为 inert（aria-hidden）。
- 解决：正则允许可选的快捷键后缀（`/^(名前の変更|重命名|Rename) ?(F2)?$/`）；对树的断言放到菜单关闭之后。
- 预防：断言「某菜单项不存在」之前先等菜单本身可见，否则断言在菜单渲染前就空洞地通过。

### 临时篡改验证：`git checkout -- <file>` 还原不了未跟踪的新文件

- 日期：2026-11-18
- 症状：篡改后用 `git checkout -- file` 还原，对尚未 `git add` 的新文件静默无效，篡改留在了工作区。
- 解决：篡改前把文件复制到临时目录（scratchpad，不要复制到仓库的上级目录），用备份还原；还原后 `grep` 篡改标记（如 `TAMPER`）确认为 0。
- 预防：篡改时在改动处加统一的标记注释，便于检查是否已全部还原。

### e2e：扫描引擎的用例——刷新间隔要在添加条目之前设置；窗口真的失焦会让用例超时

- 日期：2026-11-19
- 症状：（预防性）`cache:` 等用例依赖扫描进程「下一次检查」发现磁盘变化。默认的本地刷新间隔 5 秒接近断言的等待时间，用例容易偶发超时。
- 原因：
  1. 调度器对已排期的目录沿用原来的到期时刻，设置变化（`refresh.intervalSec.*`）只影响之后进入范围的目录。
  2. 所有窗口失焦时 P1 暂停（设计 4.6）。主进程的 BrowserWindow 在 e2e 运行中真的失去焦点（例如运行期间在其他窗口中操作），展开中的目录就不再检查，等待变化的断言超时。
- 解决：`e2e/explorer.spec.ts` 的 `launchFast` 在启动后、添加任何条目之前经 IPC `settings.set` 把 `refresh.intervalSec.local` 设为下限 2 秒；等待变化的断言给 5–8 秒。主进程不主动下发窗口初始的焦点状态（扫描进程把发来关注点的新窗口视为已聚焦），后台启动的测试窗口不会一开始就暂停 P1。
- 有效性：把配置下发改为空的根（不缓存、不调度）后，两个 `cache:` 用例都失败（`state` 为 `fresh` 而不是 `cached`；删除后的「找不到」行不出现）。
- 预防：运行 e2e 时不要操作其他窗口；新增依赖检查的用例时先确认目录在调度范围内（根、关注点、视口内的已展开目录），只靠 `vfs.list` 的 P0 时注意 2 秒去重。

### e2e：注入主进程事件（如 `vfs.reachability`）用 `webContents.send('pch:event', …)`，不为测试新增产品 IPC

- 日期：2026-11-19
- 症状：想验证「共享断开」的界面，但真实断开无法在 e2e 中制造，也不该为此新增产品通道。
- 原因：渲染端只订阅 `pch:event` 通道上的 `{ event, payload }` 信封（`packages/shared/src/ipc/transport.ts`），主进程广播也是同一写法。
- 解决：`app.evaluate(({ BrowserWindow }, e) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('pch:event', { event: 'vfs.reachability', payload: e })), payload)`（见 `e2e/explorer.spec.ts` 的 `offline:` 用例）。`share` 取临时目录所在盘符（`C:`）。
- 局限：「缓存内容（cached）显示最后更新时间」依赖列表的 `state` 为 `cached`，而添加条目会让扫描进程立即检查、展开时已是 `fresh`，e2e 中无法稳定复现，该部分只有 `tree-model.test.ts` 的单元测试。

### `scripts/os-screenshot.mjs`：`CopyFromScreen` 报 `The handle is invalid`

- 日期：2026-11-19
- 症状：系统级截图失败（`Exception calling "CopyFromScreen" ... The handle is invalid`），连 PowerShell 单独调用 `CopyFromScreen` 也失败。
- 原因：当前登录会话没有可用的交互式桌面（屏幕锁定 / 显示器休眠 / 远程会话断开等），GDI 取不到屏幕 DC。
- 解决：确认桌面可用（解锁）后重试；无法解锁时退回 Playwright 的 `page.screenshot`（看不到系统绘制的窗口边框与按钮），并在报告中说明未做系统级截图。
- 预防：做系统级截图前先用上面的最小命令探测。

### 驱动打包后的应用：`--remote-debugging-port` + `chromium.connectOverCDP`；性能记录取扫描进程内存与 index.db

- 日期：2026-11-19
- 症状：打包实测需要在 zip 版中添加条目、展开目录、截图，但 Playwright 的 `_electron.launch` 面向未打包的应用（e2e 加载 `apps/desktop`），打包版的 Fuses 关闭了 `--inspect` 等 Node 调试参数（`electron-builder.yml`）。
- 原因：Fuses 只限制 Node 的调试参数，不限制 Chromium 的 `--remote-debugging-port`。（`_electron.launch` 驱动打包版是否可行未实测。）
- 解决：`PremiumCowHorse.exe --user-data-dir=<临时目录> --remote-debugging-port=9333`，脚本中 `chromium.connectOverCDP('http://127.0.0.1:9333')`，取 URL 以 `app://` 开头的页面，经 `window.pch.invoke` 调用 IPC、用 locator 操作树、`page.screenshot`；结束时 `window.pch.invoke('window.close')` 让应用正常退出（扫描进程随之关闭）。性能记录：主进程中 `app.getAppMetrics()` 里 `serviceName === 'pch-scanner'` 的项给出扫描进程的 `workingSetSize` / `peakWorkingSetSize` / `privateBytes`（KB）；扫描进度用 node:sqlite 以 `readOnly: true` 打开 `<userData>/cache/index.db`（WAL，应用运行中也可读）数 `dirs.listed_at IS NOT NULL`。命令与结果见 `devDoc/2026-11-19-06-refresh-cache.md`。
- 预防：`--remote-debugging-port` 只用于本地实测，不写进产品启动参数；脚本放在 scratchpad，不入库。

### 主题切换后立即截图，截到的是过渡动画的中间帧

- 日期：2026-11-19
- 症状：e2e 中 `settings.set` 切换主题 / 语言并等到 `html[lang]` 生效后马上 `page.screenshot`，深色截图中多处文字与按钮半透明（像禁用状态）。
- 原因：组件的颜色带 `transition`，`lang` / `class` 变化后颜色还在过渡中。
- 解决：切换后等待约 800ms 再截图（`e2e/search.spec.ts` 的截图用例）。
- 预防：截图发现「像禁用一样发灰」时先排除过渡动画，再怀疑样式。

### Windows：测试的临时目录删不掉而泄漏（EBUSY / EPERM；`force` 只忽略 ENOENT）

- 日期：2026-11-19
- 症状：跑完测试后 `%TEMP%` 中留下 `pch-cache-*`、`pch-scanner-*`、`pch-e2e-*` 等目录；有时 `afterEach` 的 `rmSync` 报 `EBUSY` / `EPERM, Permission denied`。
- 原因：（1）测试中途断言失败，写在用例末尾的 `db.close()` / `cache.close()` 没有执行，文件句柄留在进程里，Windows 不允许删除被打开的文件；（2）句柄刚关闭（或刚退出的应用进程）时删除可能暂时失败，`rmSync` 的 `force: true` 只忽略 ENOENT，不重试；（3）e2e 的 `afterEach` 连续删两个目录，第一个失败抛出后第二个不再删除。
- 解决：打开数据库的测试把连接登记后在 `afterEach` / `finally` 中关闭（`cache.test.ts` 的 `track`，`main.test.ts` 的 shutdown 放进 try/finally）；`rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })`；e2e 用 `e2e/support.ts` 的 `removeDirs(...dirs)` 逐个尝试、最后汇总报错。
- 预防：创建临时目录的测试，清理放在 `afterEach` 且不依赖用例跑完；跑完测试后对比一次 `%TEMP%` 的 `pch-*` 目录。故意验证「失败」的 RED 运行同样会泄漏（实现尚未关闭句柄），事后手动删除。

### vitest：`mockRestore()` 同时清空 `mock.calls` / `mock.contexts`

- 日期：2026-11-19
- 症状：`vi.spyOn(DatabaseSync.prototype, 'prepare')` 后在 `finally` 中 `mockRestore()`，之后读 `mock.calls` 为空数组，断言「执行了 2 条 DELETE」失败。
- 原因：Vitest 的 `mockRestore` 包含 `mockReset`，会清空调用记录。
- 解决：在 `mockRestore()` 之前取出 `mock.calls` / `mock.contexts`（`cache.test.ts` 的 EXPLAIN QUERY PLAN 用例、`main.test.ts` 用 `mock.contexts` 取得被替换方法的 `this`，避免 `no-this-alias`）。
- 预防：需要事后检查调用记录的 spy，先复制记录再还原。

### 比较 `index.db` 的大小：URI 的长度决定大小，两次测量的树形状（根路径、目录名）要相同

- 日期：2026-11-19
- 症状：同样 1 万目录 / 10 万文件，第一版测得 `index.db` 36MB，第二版测得 74.9MB，看起来像是碎片或新索引造成的膨胀。
- 原因：`entries` 每行保存所在目录的完整 URI，主键索引 `(dir_uri, name)` 再存一份；第二版的测量树根在 scratchpad 的长路径下、目录名是日文（URI 中百分号编码，一个汉字 9 字节），平均 `dir_uri` 从 77 变成 204 字符。用同一份 `Cache.applyListing` 写两种形状：37.2MB 对 75.2MB；空闲页 1–7 页，`VACUUM` 只减少约 4%。
- 解决：用 `dbstat` 按表 / 索引汇总（`SELECT name, sum(pgsize) FROM dbstat GROUP BY name`，node:sqlite 内置的 SQLite 可用），先 `PRAGMA wal_checkpoint(TRUNCATE)` 再看文件大小；结论见 `devDoc/2026-11-19-09-cache-strategy.md`「index.db 的大小」。
- 预防：性能 / 体积对比时固定合成树的根路径与命名（或同时记录平均 URI 长度）；判断「碎片」之前先看 `freelist_count` 与 `dbstat` 的 `unused`。注意 FTS5 `optimize` 会让文件变大（旧段的页进入空闲列表）。
