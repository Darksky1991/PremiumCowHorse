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

### Windows：删除被 `fs.watch` 监听的目录只收到 `rename`，没有 `error`

- 日期：2026-11-18
- 症状：目录被删除后监听没有失效，主进程一直保留该监听（「僵尸」条目），目录重建后也不会重新监听（M1-2 Task 3 审查）。
- 原因：本机（Windows 11）实测删除被监听的目录时，`fs.watch` 只发出 `rename` 事件，不发出 `error`；只在 `error` 时关闭的写法永远不会判定失效。
- 解决：`LocalProvider.watch` 在 `rename` 事件后 `fs.stat(目录)`，失败即视为失效：先通知一次变化，再关闭并调用 `onClose`（`vfs/providers/local.provider.ts`），`VfsService` 据此删除条目以便重建。
- 预防：依赖平台文件事件的逻辑要在目标平台上实测「目录自身被删除 / 改名」。rename 后 stat 失败的原因也可能是权限或网络，目前一律视为失效。

### 原生拖放：dragover 读不到数据、系统文件不能用 `move`、合成的 File 没有路径

- 日期：2026-11-18
- 要点（M1-2 Task 7）：
  - dragover 阶段 `dataTransfer.getData()` 返回空，只能读 `types`；树内拖动的来源要在 dragstart 时存进 ref。源行被虚拟滚动卸载时 `dragend` 可能不触发，所以「是否系统文件」用 `types.includes('Files')` 判断，不依赖该 ref。
  - 从资源管理器拖入时 `dropEffect` 若设为 `move`，来源端会把原文件**移走**；只能用 `copy` / `link`，且要落在 `effectAllowed` 允许的范围内，否则 drop 被取消（`features/explorer/drag-drop.ts` 的 `osDropEffect`）。
  - 拖出应用时，只要 dragstart 不设置 `text/uri-list`、`DownloadURL`、文件，系统资源管理器 / 桌面就没有可落地的数据。
  - 文件路径只能经 preload 的 `webUtils.getPathForFile(file)` 取得；页面内合成的 `File`（Playwright / `new File()`）得到空字符串，因此系统拖入无法 e2e，只能单元测试 + 手动确认。
  - （未经真机验证）从 zip 内文件、Outlook 附件、浏览器图片等「虚拟文件」拖入时，Chromium 可能先在 %TEMP% 生成副本，`getPathForFile` 返回副本路径。
- 预防：拖放相关改动后检查 dragstart 设置的类型（e2e 断言 `dt.types` 只有自定义 MIME），系统拖入请需求方手动确认。
