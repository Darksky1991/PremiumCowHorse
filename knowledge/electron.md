# Electron

### sandbox preload 里 `Buffer` 不可用（解码失败被静默吞掉）

- 日期：2026-11-18
- 症状：`window.pch.bootstrap` 为 `null`，首帧主题闪烁（先浅色再过渡到深色）；没有任何报错。
- 原因：preload 运行在 sandbox 中，不能使用 `Buffer` 等 Node API；解码函数里的 try/catch 把异常吞掉返回了 null。
- 解决：bootstrap 参数改用 `encodeURIComponent(JSON.stringify(...))` 编解码（`packages/shared/src/ipc/bootstrap.ts`）。e2e 中断言 bootstrap 非空。
- 预防：preload 及其依赖（`@pch/shared/preload` 入口）只使用浏览器也有的 API；对「失败时静默回退」的逻辑要有测试覆盖回退不被触发。

### `titleBarOverlay` 的系统按钮遮挡标题栏边框

- 日期：2026-11-18
- 症状：Windows 下标题栏右上角的系统按钮区域盖住了自绘标题栏底部的分隔线。
- 原因：Window Controls Overlay 由系统绘制在网页之上，按钮区域高度覆盖到了边框。
- 解决：去掉 `titleBarOverlay`（只保留 `titleBarStyle: 'hidden'`），由渲染端自绘窗口按钮，经 `window.*` IPC 控制窗口（`modules/window/`、`features/shell/components/window-controls.tsx`）。
- 预防：取舍是失去 Windows 11 悬停最大化按钮时的贴靠布局面板。双击标题栏最大化仍由系统处理（已验证）；验证这类系统行为要用系统级鼠标事件（Playwright 的鼠标事件不经过系统标题栏逻辑），方法见 testing.md。

### `pnpm dev` 启动后什么也没发生（main.log 没有 starting 行）

- 日期：2026-11-18
- 症状：electron-vite 输出 `Port 5173 is in use, trying another one...` 与 `starting electron app...`，但没有窗口，`main.log` 没有新的 `[app] starting` 行。
- 原因（推测，未能复现确认）：已有一个使用同一 userData（`PremiumCowHorse-dev`）的实例在运行；应用的单实例锁让新实例直接退出（并聚焦已有窗口）。当时占用 5173 端口的进程即为该实例的 dev server。
- 解决：关闭已有实例后重试。已在单实例锁失败时向控制台输出 `[app] another instance is already running`。
- 预防：启动前检查 `Get-Process electron` 与 5173 端口；e2e / 截屏脚本使用独立的 `PCH_USER_DATA_DIR`，不受影响。

### 主进程的超时 / 取消不能依赖 provider 响应 AbortSignal

- 日期：2026-11-18
- 症状：（预防性）`fs.promises.readdir` 不接受 signal；网络共享无响应时 readdir 可能一直挂起，超时形同虚设。
- 解决：`VfsService` 让调用与中止信号赛跑（`Promise.race`），中止即以 `FS_CANCELLED` / `FS_TIMEOUT` 结束；同时给操作的 promise 挂一个空 `catch`，避免它在中止后迟到失败时产生 unhandled rejection。
- 注意：赛跑只**释放调用方**，不会停止已经发出的工作。`fs.promises` 的每个调用占用 libuv 线程池（默认 4 个线程）中的一个线程；无响应的网络共享上，已发出的 readdir / lstat 会一直占着线程直到系统超时，4 个这样的调用就能让主进程所有文件操作排队。因此 `LocalProvider.list` 把子项 lstat 限制为最多 16 个并发、每开始一项前检查中止信号（中止后不再发出新工作）。已发出的单个调用仍无法中止，对失联主机的「快速失败」待评估。
- 预防：所有可能访问网络路径的操作都经过 `VfsService`，不要在模块里直接调用 `fs`；不要一次性对大量路径发起 `fs` 调用。

### tsup / esbuild 打包 Electron 主进程的两个坑（历史，tsup 已移除）

- 日期：2026-11-18
- 症状：①「Electron failed to install correctly」；②`Cannot find module 'sqlite'`。
- 原因：①`noExternal: [/.*/]` 优先于 `external: ['electron']`，把 npm 的 `electron` 启动器包打进了主进程；②tsup 默认去掉 `node:` 前缀，而 `node:sqlite` 只能带前缀引用。
- 解决：现已改用 electron-vite（默认正确处理二者）。
- 预防：自行配置打包器时检查产物中的 `require("electron")` 与 `require("node:...")`。

### Windows：删除被 `fs.watch` 监听的目录只收到 `rename`，没有 `error`（历史：2026-11-19 起不再使用 `fs.watch`）

- 日期：2026-11-18
- 症状：目录被删除后监听没有失效，主进程一直保留该监听（「僵尸」条目），目录重建后也不会重新监听（M1-2 Task 3 审查）。
- 原因：本机（Windows 11）实测删除被监听的目录时，`fs.watch` 只发出 `rename` 事件，不发出 `error`；只在 `error` 时关闭的写法永远不会判定失效。
- 解决：`LocalProvider.watch` 在 `rename` 事件后 `fs.stat(目录)`，失败即视为失效：先通知一次变化，再关闭并调用 `onClose`（`vfs/providers/local.provider.ts`），`VfsService` 据此删除条目以便重建。
- 预防：依赖平台文件事件的逻辑要在目标平台上实测「目录自身被删除 / 改名」。rename 后 stat 失败的原因也可能是权限或网络，目前一律视为失效。
- 现状（2026-11-19）：**不再使用 `fs.watch`**（监听句柄阻止上级目录改名，见 `windows-and-tooling.md`），`LocalProvider.watch` 已删除，本条只作历史记录。目录被删除改由扫描进程的检查发现（`FS_NOT_FOUND` → 删除缓存子树并发 `vfs.changed`）。

### 原生拖放：dragover 读不到数据、系统文件不能用 `move`、合成的 File 没有路径

- 日期：2026-11-18
- 要点（M1-2 Task 7）：
  - dragover 阶段 `dataTransfer.getData()` 返回空，只能读 `types`；树内拖动的来源要在 dragstart 时存进 ref。源行被虚拟滚动卸载时 `dragend` 可能不触发，所以「是否系统文件」用 `types.includes('Files')` 判断，不依赖该 ref。
  - 从资源管理器拖入时 `dropEffect` 若设为 `move`，来源端会把原文件**移走**；只能用 `copy` / `link`，且要落在 `effectAllowed` 允许的范围内，否则 drop 被取消（`features/explorer/drag-drop.ts` 的 `osDropEffect`）。
  - 拖出应用时，只要 dragstart 不设置 `text/uri-list`、`DownloadURL`、文件，系统资源管理器 / 桌面就没有可落地的数据。
  - 文件路径只能经 preload 的 `webUtils.getPathForFile(file)` 取得；页面内合成的 `File`（Playwright / `new File()`）得到空字符串，因此系统拖入无法 e2e，只能单元测试 + 手动确认。
  - （未经真机验证）从 zip 内文件、Outlook 附件、浏览器图片等「虚拟文件」拖入时，Chromium 可能先在 %TEMP% 生成副本，`getPathForFile` 返回副本路径。
- 预防：拖放相关改动后检查 dragstart 设置的类型（e2e 断言 `dt.types` 只有自定义 MIME），系统拖入请需求方手动确认。

### 看门狗从「发出调用」起计时：并发超过 libuv 线程池会把排队误判为超时

- 日期：2026-11-19
- 症状：（预防性，扫描进程调度器设计时发现）koffi 的异步调用与 `fs` 都在 libuv 线程池（默认 `UV_THREADPOOL_SIZE` = 4）中执行。若同时发出的原生调用多于线程数，多出的调用在 libuv 内部排队；调度器的看门狗从发出调用起计时，排队时间也被算进去，健康的共享会被误判为超时、甚至「断开」。另外被中止的 koffi 调用无法真正取消：系统调用返回前线程一直被占着。
- 解决：`scanner/schedule/scheduler.ts` 让同时进行的原生调用总数不超过 `threadPoolSize`（默认取 `UV_THREADPOOL_SIZE`，未设置为 4），并发按位置组（本地卷 / 网络主机）各限后台 1 个 + P0 1 个，本地合计、网络合计、单个组都最多占 `threadPoolSize - 1`（卡住的一方不会占掉最后一个线程）；被看门狗中止的调用在其 promise 真正 settle 之前继续占着并发名额（同一主机不会因重试而堆积卡住的线程）。
- 注意：Win32 枚举器解析链接目标时内部还有并发的 `fs` 调用，未计入上限；扫描进程 fork 时经环境变量设置 `UV_THREADPOOL_SIZE=16`（必须在线程池首次使用之前设置；`main/vfs/scanner-process.ts`），扫描进程把同一值作为调度器的 `threadPoolSize`。
- 预防：给原生 / `fs` 调用加超时时，确认调用数受线程池约束，或从「实际开始执行」起计时。

### 主进程按窗口持有的资源：重新加载 / 渲染进程崩溃时 webContents 不销毁

- 日期：2026-11-20
- 症状：（预防性，文本预览 Task 4 审查发现）按 owner（webContents id）持有的文本文档只在 `destroyed` 时释放；按 F5 / Ctrl+R 重新加载、渲染进程崩溃后，webContents（及其 id）不变、`destroyed` 不触发，新页面不知道旧的 docId，旧文档一直占着每窗口 16 个的名额，直到被 LRU 挤掉。
- 解决：`vfs/document/document-owner.ts` 的 `bindDocumentOwner` 另外监听 `did-start-navigation`（只处理 `isMainFrame && !isSameDocument`；Electron 45 的第一个参数是带 `isMainFrame` / `isSameDocument` 的事件对象，其余位置参数已废弃）与 `render-process-gone`，调用 `DocumentService.resetOwner`：关闭全部文档并递增该 owner 的页面代号，旧页面发起、之后才完成的 `doc.open` 也关闭。与 `releaseOwner` 不同，之后的 open 照常受理（id 还会被新页面使用）。
- 预防：主进程按窗口持有状态时，同时考虑「窗口销毁」与「同一 webContents 换了页面」两种生命周期。
- 补充（2026-11-20，M2 Task 6 实测，修正上面的做法）：**被 `will-navigate` 阻止的导航也会先发出 `did-start-navigation`**（`isMainFrame && !isSameDocument` 同样为真）。应用窗口里点外部链接（`windows/security.ts` 阻止并交给 `openExternal`）时，按上面的写法会误清理该窗口的全部资源（实测：浏览器视图全部被销毁）。浏览器视图的 `bindWebViewOwner`（`modules/web/web-session.ts`）因此改用 `did-navigate`（主框架提交了新文档才发出；重新加载也会发出）。`bindDocumentOwner` 仍用 `did-start-navigation`，同样会在点外部链接时关闭全部文本文档——已报告，未修改。

### 渲染端：宿主对象在 useState 中惰性创建，卸载时 dispose，之后仍可使用（StrictMode）

- 日期：2026-11-20
- 症状：（预防性，文本预览 Task 5）预览宿主的 `doc` API 要在插件第一次渲染时就可用，且子组件的 effect（插件打开文档）先于父组件的 effect 执行——在父组件 effect 里创建会晚；而开发模式的 StrictMode 会执行「effect → cleanup → effect」，cleanup 中 dispose 后对象若不能再用，第二轮 effect 中插件的调用就失效。
- 解决：`features/preview/use-doc-session.ts` 用 `useState(() => createDocSession(...))` 惰性创建；IPC 事件订阅在第一个文档打开时建立、最后一个关闭时取消；`dispose` 只关闭现有文档并递增代号（之前发出、之后才完成的 open 关闭并拒绝），对象之后照常可用。
- 预防：在 effect 中释放、在渲染中创建的对象，按「dispose 之后还会被再次使用」设计，并加单元测试（`doc-session.test.ts` 的 StrictMode 用例）。

### `View.setBounds` 的单位是 DIP（类型定义未写明）；`capturePage()` 返回物理像素

- 日期：2026-11-20
- 症状：（M2 先行验证）`electron.d.ts` 的 `View.setBounds(bounds: Rectangle, options?)` 没有说明单位，只写了 `Rectangle` 各字段「must be an integer」；不确定要不要乘 `devicePixelRatio`。
- 原因 / 结论（实测）：单位是 DIP。宿主页 `getBoundingClientRect()` 的 CSS 像素（页面缩放为 1）直接传给 `setBounds`，在 125%（`--force-device-scale-factor=1.25`）与 150% 下视图都与占位元素逐像素对齐。传小数不报错，Electron 四舍五入（`{120.4, 80.6, 400.5, 300.5}` → `{120, 81, 401, 300}`）。`webContents.capturePage()` 的图是物理像素尺寸（400×300 DIP 在 150% 下为 600×450）。
- 解决：宿主自行取整（`x = round(left)`、`width = round(right) - x`）后发送，不乘 `devicePixelRatio`；截图替身按 CSS 尺寸缩放显示。
- 预防：宿主页面若被缩放（`zoomFactor ≠ 1`），CSS 像素不再等于 DIP，需要乘缩放系数（未验证）。视图的 `prefers-color-scheme` 跟随 `nativeTheme.themeSource`、自定义协议提供的 PDF 用内置查看器直接显示（不需要 `plugins: true`）——见 `devDoc/2026-11-20-24-m2-ledger.md`。

### 浏览器视图（WebContentsView）中的几个事件行为（Electron 45，实测）

- 日期：2026-11-20
- 症状 / 原因（M2 Task 6，一次性脚本与已构建应用实测）：
  - 自定义协议处理器返回 4xx / 5xx 且响应体为空时，**不触发 `did-fail-load`**，Chromium 显示空白页；`did-navigate` 的 `httpResponseCode` 为 404 等。
  - 页面（`pch-web://`）中点击 `file:` 链接（主框架与 `target=_blank`）在渲染进程就被拦截（控制台 `Not allowed to load local resource`），**`will-navigate` 与 `setWindowOpenHandler` 都不触发**。
  - `before-input-event` 的 `input.type`：真实按键的 RawKeyDown 也报告为 `keyDown`（抬起为 `keyUp`）；被 `preventDefault` 的按下之后不再收到对应的 `keyUp`。
  - `before-mouse-event` 的 `button` 类型定义只列 left / middle / right，但 Electron 源码（`shell/common/gin_converters/blink_converter.cc` 的 ToV8）对侧键输出 `back` / `forward`；`sendInputEvent` 的 FromV8 只接受 left / middle / right（其他值当作 left），因此**无法用 `sendInputEvent` 合成侧键**。
  - `web-contents-created` 在 `new WebContentsView()` 的构造中同步发出（早于构造函数返回），其中 `contents.session` 已是视图的会话。
  - `request.initiatorOrigin`（`protocol.handle`）：应用 `loadURL` 的主框架请求不存在该字段；同源子资源为 `pch-web://<主机>`；沙箱 iframe / `data:` 框架为 `"null"`；URL 中的主机名已被 Chromium 转为小写，`%2e%2e` / `..` 段已折叠，`%5c` 原样保留。
- 解决：处理方式见 `modules/web/web-session.ts`（失败状态同时看 `did-navigate` 的状态码；导航判定中的 `file:` 分支只在 Chromium 放行时起作用）。
- 预防：视图的失败 / 导航相关行为以实测为准，不按类型定义或文档推断。

### 浏览器视图中的 PDF 查看器：下载被会话取消；打印打开系统的打印对话框（模态，期间主进程阻塞）

- 日期：2026-11-20
- 症状（M2 Task 7，核实先行验证 S3 的遗留项；Electron 45.3.3，系统级鼠标点击工具栏按钮）：① 下载按钮 → 会话的 `will-download` 被 `modules/web` 取消，状态行显示「ダウンロードには対応していません」，`Downloads` 中没有新文件。② PDF 查看器的内部页面没有被导航判定 / 全局安全策略误拦（PDF 正常渲染）。③ 打印按钮 → 打开 Windows 的系统打印对话框（「Electron - 打印」，预览区显示「此应用不支持打印预览」）。对话框打开期间**主进程阻塞**（`electronApp.evaluate` 一直等到对话框关闭）。
- 原因：Chromium 内置 PDF 查看器的打印走 `webContents.print` 一类的系统对话框路径，Windows 上同步弹出。
- 解决 / 现状：打印未禁用（设计 5.3.9 把打印列为推迟功能；查看器自带的打印是否放行由控制者 / 需求方决定）。e2e 不点打印按钮；手工验证时用「取消」关闭（不要点「打印」）。注意「Electron - 打印」标题中的应用名来自 Electron 默认名。
- 预防：自动化脚本点击 PDF 查看器工具栏前确认目标按钮。对视图 `webContents.sendInputEvent` 在同一位置点击下载按钮没有任何反应（未查明是事件没有送达查看器的内部框架——扩展页、进程外 iframe——还是坐标换算有误），系统级鼠标事件（`SetCursorPos` + `mouse_event`）有效。

### 隐藏 / 销毁持有键盘焦点的 `WebContentsView` 后，应用快捷键不生效（焦点没有回到窗口）

- 日期：2026-11-20
- 症状（M2 Task 7 审查，系统级鼠标 / 按键实测）：点击浏览器视图（焦点进入页面）后按 Alt+←，标签回到文本文件、视图被销毁，但再按 Alt+→ / F5 没有反应，要先点一下应用界面。主进程中应用渲染端的 `webContents.isFocused()` 为 false。
- 原因：`setVisible(false)` 或销毁视图不会把焦点交回所属窗口的渲染端；焦点留在看不见的视图（按键落进隐藏的页面）或无处可去。
- 解决：`WebViewManager` 在 `hide` / `release` / `freeze` 时，视图 `webContents.isFocused()` 为真则调用所属窗口渲染端的 `webContents.focus()`。`freeze`（截图替身）同样交回（隐藏的视图拿不住焦点：`setVisible(false)` 后视图与应用的 `isFocused()` 都为假，按键无处可去，页面里的输入法组字也被取消），是否在 `unfreeze` 时还给视图由渲染端判断——只在期间用户没有在应用中操作时还，否则会抢走用户刚移到资源树等处的焦点。
- 预防：任何隐藏 / 移除原生视图的路径都要考虑焦点归属；e2e 中可用主进程 `webContents.isFocused()` 断言（Playwright 的 `page.keyboard` 直接发给页面、不经系统焦点，不能证明真实按键的去向——真实行为用系统级 `keybd_event` 确认）。

### `WebContentsView` 加载时拿走键盘焦点；在其 `focus` 事件中同步交回不生效

- 日期：2026-11-20
- 症状（M2 最终审查 I3 / Q18）：在资源树中用 ↑↓ 浏览，选中 html / pdf / 图片 / md 时在当前标签打开浏览器视图，视图加载后键盘焦点进入页面，之后方向键滚动页面而不是继续移动树的选中。e2e 中主进程 `webContents.isFocused()`：应用 false、视图 true。
- 原因：新建视图并 `loadURL`（以及复用视图加载新地址）时，Chromium 在加载开始后约 50 ms 把焦点给视图（应用 `blur`、视图 `focus`，早于 `dom-ready`）。在视图 `focus` 事件的处理函数中**同步**调用应用 `webContents.focus()` 不生效（焦点仍在视图，之后也没有新的 focus / blur 事件）。
- 解决：`attach` 时视图没有焦点（用户在应用界面中操作）就记一个标记；视图之后自己拿到的焦点在 `setImmediate` 之后交回应用渲染端（推迟后生效，`dom-ready` / `did-finish-load` 不会再拿走）；用户在视图内按下鼠标（`before-mouse-event` 的 `mouseDown`）时清除标记，焦点已被交回时主动 `webContents.focus()` 给视图（焦点事件与鼠标事件的先后不确定）。代码：`modules/web/web-view-manager.ts`（`guardFocus`）、`web-session.ts`。注意：页面中点链接 / 按 Alt+←→ 时渲染端先 hide / release（焦点已交回应用）再 attach，只按「attach 时视图有没有焦点」判断会把这种导航也当成应用中的操作；因此 hide / release 交回焦点时另记「交接」，同一标签紧接着的 attach 把焦点给视图，应用中的按键 / 鼠标按下作废交接（M2 试用反馈第 1 项）。
- 预防：在焦点事件里改焦点要推迟到事件之后；e2e 中模拟「用户点击视图」要用 `sendInputEvent` 的鼠标事件（会触发 `before-mouse-event`），只调 `webContents.focus()` 会被上述规则交回应用。
