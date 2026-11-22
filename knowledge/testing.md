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
- 补充（2026-11-20）：断言「对话框打开期间背后的标签没有变化」时，`getByRole('tablist')` 在对话框打开期间同样找不到（报的是「0 个元素」而不是标签变了，RED 证据无效）；先关闭对话框、确认其消失后再断言标签（`e2e/address-bar.spec.ts` 的 modal 用例）。

### 临时篡改验证：`git checkout -- <file>` 还原不了未跟踪的新文件

- 日期：2026-11-18
- 症状：篡改后用 `git checkout -- file` 还原，对尚未 `git add` 的新文件静默无效，篡改留在了工作区。
- 解决：篡改前把文件复制到临时目录（scratchpad，不要复制到仓库的上级目录），用备份还原；还原后 `grep` 篡改标记（如 `TAMPER`）确认为 0。
- 预防：篡改时在改动处加统一的标记注释，便于检查是否已全部还原。

### e2e：扫描引擎的用例——刷新间隔要在添加条目之前设置；窗口真的失焦会让用例超时

- 日期：2026-11-19
- 症状：（预防性）`cache:` 等用例依赖扫描进程「下一次检查」发现磁盘变化。默认的本地间隔（关注点 5 秒，近 / 远层 30 秒 / 2 分钟）接近或超过断言的等待时间，用例容易偶发超时。
- 原因：
  1. （第一版，2026-11-19 记录时）调度器对已排期的目录沿用原来的到期时刻，设置变化（当时的 `refresh.intervalSec.*`）只影响之后进入范围的目录。现状（第二版，设置键 `cache.interval.{focus,near,far}.*`）：配置变化后重新计算范围，已排期的目录取「原到期时刻」与「上次确认 + 新间隔」中较早者——调短立即生效，调长要等该目录下一次确认之后。在添加条目之前设置仍是最稳妥的做法。
  2. 所有窗口失焦时定期确认暂停（设计 8.2；第一版称「P1 暂停」，设计 4.6）。主进程的 BrowserWindow 在 e2e 运行中真的失去焦点（例如运行期间在其他窗口中操作），展开中的目录就不再检查，等待变化的断言超时（后台队列照常，但不保证在断言的时间内轮到）。
- 解决：`e2e/explorer.spec.ts` 的 `launchFast` 在启动后、添加任何条目之前经 IPC `settings.set` 把 `cache.interval.focus.local`、`cache.interval.near.local`、`cache.interval.far.local` 都设为下限 2 秒（第一版为 `refresh.intervalSec.local`）；等待变化的断言给 5–8 秒。主进程不主动下发窗口初始的焦点状态（扫描进程把发来关注点的新窗口视为已聚焦），后台启动的测试窗口不会一开始就暂停定期确认。
- 有效性：把配置下发改为空的根（不缓存、不调度）后，两个 `cache:` 用例都失败（`state` 为 `fresh` 而不是 `cached`；删除后的「找不到」行不出现）。
- 预防：运行 e2e 时不要操作其他窗口；新增依赖检查的用例时先确认目录在调度范围内（根、关注点、视口内的已展开目录），只靠 `vfs.list` 的 P0 时注意 2 秒去重。

### e2e：注入主进程事件（如 `vfs.reachability`）用 `webContents.send('pch:event', …)`，不为测试新增产品 IPC

- 日期：2026-11-19
- 症状：想验证「共享断开」的界面，但真实断开无法在 e2e 中制造，也不该为此新增产品通道。
- 原因：渲染端只订阅 `pch:event` 通道上的 `{ event, payload }` 信封（`packages/shared/src/ipc/transport.ts`），主进程广播也是同一写法。
- 解决：`app.evaluate(({ BrowserWindow }, e) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('pch:event', { event: 'vfs.reachability', payload: e })), payload)`（见 `e2e/explorer.spec.ts` 的 `offline:` 用例）。`share` 取临时目录所在盘符（`C:`）。
- 局限：「缓存内容（cached）显示最后更新时间」依赖列表的 `state` 为 `cached`，而添加条目会让扫描进程立即检查、展开时已是 `fresh`，e2e 中无法稳定复现，该部分只有 `tree-model.test.ts` 的单元测试。

### e2e：让主进程的某个 IPC 调用卡住（模拟无响应的共享上 stat 等到超时）

- 日期：2026-11-19
- 症状：要证明「目录标签不等 stat」「断开时文件标签不发 stat」，但本地磁盘上的 stat 立即返回，用例在修复前后都通过，证明不了什么；也不该为测试新增产品开关。
- 原因：IPC 只有 `pch:invoke` 一个通道，主进程的处理函数由 `ipcMain.handle` 登记；页面侧的 `window.pch` 经 contextBridge 冻结，替换不了。
- 解决：`e2e/support.ts` 的 `hangStat(app)`：在主进程中取出 `ipcMain._invokeHandlers.get('pch:invoke')`（Electron 内部字段；Electron 45 中实测为 `Map`，存的就是传给 `handle` 的函数本身），`removeHandler` 后重新 `handle` 一个包装：`vfs.stat` 返回永不 settle 的 Promise 并计数，其余交给原函数；`restore()` 换回。配合 `sendReachability`（见上一条）只改变渲染端的可达状态——扫描进程仍认为本地盘在线，列表的 `state` 不会是 `offline`，渲染端的「已断开」以 reachability-store 为准（宿主的 `fs.list` 据此报告 `offline`）。
- 有效性：在修复前的构建上，文件标签一直显示加载中（找不到文件名标题）、目录标签 3 秒内没有任何行，用例失败。
- 预防：依赖 Electron 内部字段，升级 Electron 后若 `pch:invoke handler not found`，先在主进程中打印 `ipcMain` 的字段确认新的存放位置；只用于 e2e，不进产品代码。

### `scripts/os-screenshot.mjs`：`CopyFromScreen` 报 `The handle is invalid`

- 日期：2026-11-19
- 症状：系统级截图失败（`Exception calling "CopyFromScreen" ... The handle is invalid`），连 PowerShell 单独调用 `CopyFromScreen` 也失败。
- 原因：当前登录会话没有可用的交互式桌面（屏幕锁定 / 显示器休眠 / 远程会话断开等），GDI 取不到屏幕 DC。
- 解决：确认桌面可用（解锁）后重试；无法解锁时退回 Playwright 的 `page.screenshot`（看不到系统绘制的窗口边框与按钮），并在报告中说明未做系统级截图。
- 预防：做系统级截图前先用上面的最小命令探测。
- 补充（2026-11-21，M2 反馈第 6–8 项）：同一会话中先后出现两种表现——先报 `The handle is invalid`，几分钟后 `CopyFromScreen` 不再报错、但保存的是**全白图像**（窗口区域没有任何内容）。不报错不等于截到了：截图后必须打开看一眼；全白时同样按上面退回 `page.screenshot`，并在报告中写明没有系统级截图。
- 再次出现（2026-11-21 / 2026-11-22，M3 Task 11 与 Task 13）：两次都报 `The handle is invalid`，系统级截图退回 Playwright 的 `page.screenshot`。此时 COM（Office 自动化、`Shell.Application`）与 UI Automation 的 `Invoke` 仍可用，资源管理器 / Office 的窗口也能正常创建与关闭（Task 13 的实机端到端在这种状态下完成），只是看不到真实像素。**注意**：`CopyFromScreen` 的异常在 `-Command` 中是非终止错误，PowerShell 继续执行 `$bmp.Save` 并以退出码 0 结束，`execFileSync` 不抛错——`scripts/os-screenshot.mjs` 与同类脚本会照常打印 `saved`，留下一张全空的 PNG（本次 1920x1128 时约 8.5KB）。判断成败要看 stderr 里有没有该异常、再打开图片确认，不能只看退出码。

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
- 补充（2026-11-19，M1-3 最终审查）：M1-3 期间 `pch-*` 从 14 增到 34，新增的 20 个全部是 `pch-shot-*` / `pch-shot-files-*`（21:57–21:59 成对创建，userData 中有本应用的 `data/pch.db` 与 `logs/main.log`、还留着 `DevToolsActivePort`），来自页面截图用的一次性脚本（scratchpad，不入库），不是 e2e spec：`e2e/*.spec.ts` 都在 `afterEach` 中用 `removeDirs` 清理，`folder / preview / tabs` 以 `--repeat-each 2` 跑 26 个用例前后 `pch-*` 都是 32 个、名单相同。一次性脚本同样要把 `app.close()` 与删除放进 `finally`（中途失败或被中断也删除），或把临时目录建在 scratchpad 中。

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

### e2e：会打开外部程序的系统操作（`shell.openPath` / `shell.showItemInFolder`）在主进程中替换为计数

- 日期：2026-11-19
- 症状：e2e 要点击「用系统应用打开」「在资源管理器中显示」，真的执行会启动关联程序或打开资源管理器窗口（`.bat` 会被执行），且无法断言调用参数。
- 解决：在点击之前 `app.evaluate(({ shell }) => Object.assign(shell, { openPath: async (p) => { calls.push(p); return '' }, showItemInFolder: (p) => … }))`，计数放在 `globalThis` 上，用 `expect.poll(() => app.evaluate(() => globalThis.__pchShell))` 读回（`e2e/preview.spec.ts` 的 `stubShell`）。主进程 handler 每次调用时读 `shell.openPath` 属性，所以替换生效（与替换 `dialog.showOpenDialog` 相同）。
- 预防：替换必须在任何可能触发它的点击之前；「取消后不调用」的断言要先等对话框关闭再读计数。

### 刚列出目录后立即点「刷新」/ F5，磁盘上的变化不显示（已修复）

- 日期：2026-11-20
- 症状：M1-3b 改写「刷新按钮与 F5 立即重新列出」用例（定期确认间隔设为 1 小时，列表不会自己更新）：目录视图列出后立即写入文件并点「刷新」，新文件一直不出现（两次重复都失败）；此前的版本在越过条目根的目录（不进缓存、主进程直接枚举）上测，没有暴露。
- 原因：扫描进程的 `requestP0`（`scanner/schedule/scheduler.ts`）对没有等待者的 P0 做 2 秒去重（`P0_DEDUPE_MS`），`vfs.refresh` 也走这条路：同一目录的上一次 P0 完成不到 2 秒时刷新被直接丢弃。添加条目 / 打开标签时的列出就是一次 P0。这是产品缺陷（用户 2 秒内按 F5 也不会重新读取），不只是测试问题。
- 解决（M1-3b Task 1 审查修复，控制者裁定）：`Scheduler.refresh` 以 `force: true` 请求 P0——不被去重丢弃、不与正在执行的 P0 合并；已在排队的仍合并。去重只剩给隐式的 P0（关注点切换、切回窗口、滚回视口等）。单元测试「an explicit refresh right after a P0 reads again」在修复前失败；e2e 的刷新用例去掉了为躲避去重加的 `waitForTimeout(2500)`。临时去掉点击「刷新」时用例失败（有效性）。
- 预防：显式的用户操作（刷新、重试）不要走为隐式触发设计的去重 / 合并路径；e2e 中遇到「操作后没有效果、等一会儿再操作就好」时先查调度器的去重，而不是加等待。

### Playwright 按不了鼠标侧键（后退 / 前进键）

- 日期：2026-11-20
- 症状：M1-3b 地址栏要验证鼠标侧键后退 / 前进；Playwright 的 `mouse.down` / `click` 的 `button` 只有 `left` / `right` / `middle`。
- 原因：Playwright 的鼠标 API 不支持 X 按键（CDP `Input.dispatchMouseEvent` 支持 `back` / `forward`，但 Playwright 未暴露）。
- 解决：e2e 中用 `locator.dispatchEvent('mouseup', { button: 3 })`（默认 bubbles、cancelable），只验证渲染端的处理（`features/address-bar/use-navigation-shortcuts.ts`）；真实输入另用系统级事件确认：PowerShell `Add-Type` 声明 `user32.dll` 的 `SetCursorPos` / `mouse_event`，`mouse_event(0x0080 /*XDOWN*/, 0, 0, 1 /*XBUTTON1*/, 0)` 再 `0x0100`（XUP），光标先移到窗口内容上（`screen.dipToScreenPoint` 换算物理坐标，并 `SetProcessDPIAware`）。实测（Electron 45，Windows 11）：每按一次只后退 / 前进一步，`page.url()` 不变（Chromium 没有自己做历史导航）。
- 预防：侧键、标题栏双击等系统输入，DOM 事件只能证明「收到事件后的处理」，真实输入要用系统级事件再确认一次（CLAUDE.md「防止幻觉」）。

### 横向滚动的一行在 Windows 上出现经典滚动条、挤压行高

- 日期：2026-11-20
- 症状：地址栏的路径段容器 `overflow-x: auto`，窗口变窄后在固定高度（`h-9`）的行里出现约 17px 高的经典滚动条（带箭头），路径段被挤到上半部分。
- 原因：Windows 上 Chromium 默认使用占位的经典滚动条（不是 macOS 那样的覆盖式），`overflow-x: auto` 溢出时占用容器高度。
- 解决：容器加 `[scrollbar-width:none]` 隐藏滚动条（仍可滚动），`onWheel` 把纵向滚轮换成横向（标签栏已有同样做法），并在路径 / 宽度变化（`ResizeObserver`）后滚到末尾，让当前位置可见。
- 预防：在固定高度的行里做横向滚动时，先在 Windows 上把窗口拉窄看一次整窗截图。

### e2e：资源树的单击会打开标签，只需要「展开」的用例改点箭头（`toggleRow`）

- 日期：2026-11-20
- 症状：M1-3b Task 3（目录单击不展开、单击在当前标签打开）之后，十几个旧用例在「单击条目展开」处失败；简单改成 `dblclick()` 能展开，但第一次单击会在标签中打开该目录——目录视图也列出并订阅它（`fs.list` 与资源树共用查询缓存，`vfs.changed` 时目录视图自己重新取得），标签中的目录还是 `vfs.interest.tabs` 的关注点。「折叠期间的变化在再展开时出现」「切回工作区后重新列出」这类验证**资源树自己的查询**的用例会因此变成恒真；标签又会让树的选中跟随标签（同步），改变「选中 = 关注点」的前提。
- 解决：`e2e/support.ts` 的 `toggleRow(row)` 点击行内的展开箭头（`[data-tree-toggle]`）：只展开 / 折叠，不选中、不打开。需要「只选中不打开」时把 `explorer.singleClickPreview` 设为 false（单击只选中，Enter 打开）。确实要打开的用例才用单击 / 双击 / 中键。
- 预防：改变树的单击语义时，逐个确认旧用例「点击」的意图（展开 / 选中 / 打开），按意图换成箭头、设置或打开操作，不要一律换成双击。

### e2e：根下的显示顺序（未分组在上）与 `entry.list` 的 sortOrder 顺序不同

- 日期：2026-11-20
- 症状：M1-3b Task 5 之后，拖放用例「拖到分组的上缘」得到的 `entry.list` 顺序与旧断言不一致；改写时发现「落在真实节点上不接受」的断言会变成落在条目上（会被接受）。
- 原因：根下显示为「未分组条目在上、分组在下」，与 sortOrder 不同，落在分组边缘的条目被放到未分组区的末尾；另外 `dragRow` 按 `textContent` 取**第一个**同名行，条目被拖到最前之后，同名的「固定条目」排在了真实子项之前，落点从真实节点变成了条目。
- 解决：断言区分两种顺序——数据顺序用 `entry.list`，显示顺序用 `[role="treeitem"][aria-level="1"]` 的文本；落点选不与条目重名、或同名时真实子项确定在前的行。
- 预防：改变排序或拖放语义后，检查 e2e 里按名称找行的地方是否出现了同名行（真实子项与「固定」出来的条目同名）。

### vitest：通过的测试里 `console.log` 不显示（非 TTY 下默认 `silent: 'passed-only'`）

- 日期：2026-11-20
- 症状：编码判断测试在 `afterAll` 中打印准确率汇总，测试有失败时能看到，全部通过时输出中没有。
- 原因：vitest 5 的某些报告器在未指定 `silent` 时设为 `'passed-only'`（`cli-api` 中 `if (this.silent == null && !ctx.config.providedOptions.silent) this.silent = "passed-only"`），在 AI 工具等非交互终端中运行时生效。
- 解决：需要看日志时加 `--silent=false`（如 `npx vitest run packages/text-engine/src/encoding.test.ts --silent=false`）。
- 预防：测试中打印的汇总不要作为唯一的检查手段——关键数字用断言保证。

### e2e：文本插件注册后 `.txt` / `.bat` / 无扩展名文本不再显示「文件信息」

- 日期：2026-11-20
- 症状：文本预览 Task 6 注册 `pch.preview.text` 后，preview / folder 的旧用例在 `getByRole('heading', { name: 'memo.txt' })`、「既定のアプリで開く / Open with default app」处失败：`memo.txt`、`run.bat` 由文本插件显示（扩展名表含 `txt`、`bat`），扩展名表之外的文本（`x.crash` 之外的未知扩展名、无扩展名）也会被 sniff 为文本交给它。
- 解决：要验证 fallback（文件信息、系统动作、可执行确认框）的用例用**开头含 NUL 的文件**（sniff 为二进制）：`memo.dat` = `Buffer.alloc(1536)`、`run.exe` = `MZ` 开头的字节。只关心标签 / 导航、不看内容的用例不用改。
- 预防：新增按扩展名或 `textLike` 匹配的插件时，搜索 e2e 中断言 fallback 内容（`heading`、文件信息、动作按钮）的用例，确认文件类型仍会落到 fallback。

### e2e：约 50MB 文件的行索引在状态栏显示「%」之前就完成，「索引进行中改名」落在索引之后

- 日期：2026-11-20
- 症状：`e2e/text.spec.ts` 的「索引进行中改名」用例 `--repeat-each 2` 时第二次在 `expect(lineCount(page)).toContainText('%')` 失败：状态栏已是「500,000 行」。第一次通过只是碰巧，即使通过，改名也未必发生在索引进行中（用例证明不了它要验证的东西）。
- 原因：第二次运行时文件在系统的磁盘缓存中，按 1MB 块读取 + 找换行的索引对 50MB 只要一百毫秒左右，`doc.open` 返回后到第一次断言之间就结束了。
- 解决：文件加大到约 200MB（`preview.maxTextSizeMB: 500` 保持全量模式；默认上限 50MB 以上只索引 4MB 的窗口），并在改名后断言状态栏出现「読み込みに失敗しました（ファイルまたはフォルダーが見つかりません）…」——改名后的下一块读取找不到文件，证明改名确实发生在索引进行中。`--repeat-each 3` 稳定。
- 预防：「某操作发生在后台处理进行中」的用例要断言能证明「进行中」的可观察结果（这里是读取失败），不要只在操作前看一眼进度；数据量按磁盘缓存命中后的速度估计。

### e2e：Playwright 的 `_electron.launch` 默认模拟浅色（`colorScheme: 'light'`），`nativeTheme` 切换在页面上看不到

- 日期：2026-11-20
- 症状：（M2 先行验证 S2）主进程设 `nativeTheme.themeSource = 'dark'` 后，宿主页与 `WebContentsView` 页面的 `matchMedia('(prefers-color-scheme: dark)').matches` 仍为 `false`，也没有 `change` 事件，看起来像「视图不跟随系统主题」。
- 原因：`_electron.launch` 的 `colorScheme` 选项默认 `'light'`，Playwright 对上下文中的所有页面（包括后来创建的 `WebContentsView` 页面）模拟 `prefers-color-scheme`（`playwright-core` 类型定义：「Passing `null` resets emulation to system defaults. Defaults to `'light'`」）。
- 解决：`_electron.launch({ …, colorScheme: null })` 后，视图与宿主页都随 `themeSource` 即时切换（不重新加载，`change` 事件正常）。
- 预防：凡是断言深浅色、`prefers-color-scheme` 的 e2e，启动时传 `colorScheme: null`；「Playwright 下不成立」的主题类结论先排除模拟再下。

### e2e：取 `WebContentsView` 的页面：按 URL 从 `electronApp.windows()` 中找

- 日期：2026-11-20
- 症状：（M2 先行验证 S1）需要对主窗口中嵌入的 `WebContentsView` 页面做断言。
- 解决：视图的页面与窗口页面一样出现在 `electronApp.windows()` / `context().pages()` 中，`Page` API（`locator`、`evaluate`、`title`）可直接使用：`app.windows().find((p) => p.url().startsWith('pch-web:'))`。Electron 模式下 `context().browser()` 为 `null`，不能开 Browser 级 CDP 会话。备选：`electronApp.evaluate` 中调 `view.webContents.executeJavaScript(...)`。
- 预防：不要假设 `app.windows()` 的顺序，按 URL 找；视图同样受 Playwright 的各种模拟（颜色方案等）影响。

### e2e：Playwright 的 `click` 在被阻止的导航上一直等待；锁屏时系统级输入不可用

- 日期：2026-11-20
- 症状（M2 Task 6 实机验证）：① 浏览器视图中点链接（主进程 `will-navigate` 里 `preventDefault`）后，`page.click` 卡在 `waiting for scheduled navigations to finish` 直到超时，`noWaitAfter` 也会让下一次操作卡在 `waiting for navigation to finish`。② 工作站锁屏时 PowerShell 的 `SetCursorPos` 返回 False、`GetForegroundWindow` 为 0，`mouse_event` / `keybd_event` 不送达任何窗口（系统级侧键、按键、系统截屏都无法进行）。
- 解决：① 视图内的点击改为主进程 `webContents.sendInputEvent` 的 `mouseDown` / `mouseUp`（坐标取元素中心，经 `electronApp.evaluate`），按键同样用 `sendInputEvent`（`rawKeyDown` 会触发 `before-input-event`）。② 系统级输入与截屏需在用户未锁屏时进行；无法进行时在报告中写「未验证」。
- 补充（M2 Task 7 e2e）：被阻止的导航**留在视图中**时（外部链接交给 `shell.openExternal`、其他范围的链接被阻止），之后对该 `Page` 的**任何** `locator` / `evaluate` 都会卡在 `waiting for navigation to finish`，连取元素坐标也不行。这类点击之后改用主进程 `webContents.executeJavaScript(...)` 读取页面（`e2e/web.spec.ts` 的 `evalIn`），视图的 URL 用主进程 `contentView.children[i].webContents.getURL()` 断言。导航被应用接手、视图随之销毁 / 重建的点击（同范围链接）不受影响：新页面是新的 `Page`。
- 预防：系统级验证前先用 `GetForegroundWindow` 是否为 0 判断桌面是否可用。

### e2e：Playwright 的 `page.keyboard` 不触发主进程的 `before-input-event`

- 症状（M2 试用反馈第 1 项）：主进程在应用窗口 webContents 的 `before-input-event` 中记录「用户在应用中按了键」，e2e 用 `page.keyboard.press('Alt+ArrowRight')` 后应用确实后退 / 前进了，但主进程没有收到该事件，依赖它的逻辑不生效（焦点被拉进视图，断言失败）。
- 原因：Playwright 的 `page.keyboard` 经 CDP 直接把按键事件送进页面，不经 Electron 的 `before-input-event`（与 `knowledge/electron.md` 中「不经系统焦点」同源）。
- 解决：需要主进程看到按键时，用 `electronApp.evaluate` 调 `webContents.sendInputEvent`（`rawKeyDown` / `keyUp`，带 `modifiers`），它经过 `before-input-event`，与真实按键相同；最终行为再用系统级 `keybd_event` 确认。
- 预防：主进程按 `before-input-event` / `before-mouse-event` 判断用户操作的功能，e2e 不要用 `page.keyboard` / `page.mouse` 模拟那一步。

### vitest：单元测试是 node 环境、没有 jsdom——DOM 相关的逻辑注入环境再测

- 日期：2026-11-20
- 症状（M2 Task 7）：计划要求在 jsdom 中测试弹出层追踪（`MutationObserver` + Base UI 的 `data-open`），但仓库未安装 jsdom / happy-dom（`vitest.config.ts` 的 `environment: 'node'`），M2 允许的新依赖清单里也没有。
- 解决：把判定与 DOM 访问分开：`lib/overlay-tracker.ts` 的 `createOverlayTracker({ candidates, observe })`（真实实现为 `body.querySelectorAll` 与 `MutationObserver`）与纯函数 `isOverlayPopup`，单元测试注入最小的假 DOM；`web-host.ts` 的 `ResizeObserver` / `requestAnimationFrame` / `window` 事件同样经 `WebHostEnv` 注入。真实 DOM（Base UI 弹出层的属性、选择器）由 e2e 覆盖。
- 预防：要引入 DOM 测试环境（jsdom 等）属于新依赖，先向需求方确认；在此之前按上面的方式写可注入的实现。

### vitest：在 `apps/desktop` 下运行时报 `Cannot find package '@renderer/...'`，部分文件却通过

- 日期：2026-11-21
- 症状（M2 试用反馈第 3 项）：在 `apps/desktop` 目录执行 `pnpm exec vitest run src/renderer/src/features/explorer/`，`reveal.test.ts`、`tree-model.test.ts` 报 `Cannot find package '@renderer/lib/file-uri' imported from .../tree-model.ts`，同目录其他测试文件（如 `open-target.test.ts`）通过，看起来像代码问题。
- 原因：`@renderer` 别名只在仓库根目录的 `vitest.config.ts` 中配置；`apps/desktop` 下没有 vitest 配置，在那里运行时没有别名。只有类型导入（编译时擦除）或不经过别名的文件能通过。
- 解决：在仓库根目录运行，路径写全：`pnpm exec vitest run apps/desktop/src/renderer/src/features/explorer/`。
- 预防：单元测试一律在仓库根目录运行（`pnpm test` 或 `pnpm exec vitest run <从根开始的路径>`）。

### e2e：M3 起点击「閉じる」/ `window.close` 会先弹出退出对话框，等 `close` 事件的用例超时

- 日期：2026-11-22
- 症状（M3 Task 13 全量 e2e）：`e2e/app.spec.ts` 的「custom window controls replace the native ones and work」报 `electronApplication.waitForEvent: Timeout 30000ms exceeded while waiting for event "close"`；分支内各任务只跑 `e2e/desktop.spec.ts`，到全量时才暴露。
- 原因：桌面记录的 `ExitGuard` 在 Windows 上（监控启用）且设置 `desktop.askOnExit` 为默认值 true 时拦截主窗口的 `close`，发出 `desktop.exitRequested`，渲染端显示退出对话框，窗口不关。`app.close()`（经 `before-quit`）不受影响，所以其他用例没事。
- 解决：用例点「閉じる」后等对话框出现，再点「保存しないで終了 / 不保存并退出 / Exit without saving」（提交 `335c6d5`）。只是要关闭应用、不关心退出询问的用例，用 `app.close()`，或先 `settings.set({ 'desktop.askOnExit': false })`。
- 预防：给主窗口的关闭加拦截之类改变全局行为的改动，要跑全量 e2e，而不只是本功能的 spec；`grep` 一下 e2e 里点关闭按钮 / 调 `window.close` 的地方。
