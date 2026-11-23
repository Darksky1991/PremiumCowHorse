# PremiumCowHorse 架构设计方案

> 版本：v1.28　｜　日期：2026-11-23　｜　位置：`doc/`（项目的最新事实依据，实现变化时同步更新，见第 20 节）
> v1.28 变更（M5 完善与发布完成，待合并；设计 `devDoc/2026-11-23-42-m5-design.md`（设计稿 `devDoc/assets/2026-11-23-m5-design/`），计划 `devDoc/2026-11-23-43-m5-plan.md`，台账 `devDoc/2026-11-23-44-m5-ledger.md`，实现记录（控制者决定 D1–D15 / 裁定 R1–R6、推迟项、未验证项、待需求方确认 / 决定）`devDoc/2026-11-23-45-m5.md`）：**主题**——三套完整配色 `aitetsu`（藍鉄）/ `washi`（和紙）/ `matsuba`（松葉）加 `default`，`<html data-theme>`，强调色 `:root[data-accent]` 覆盖主题（`neutral` = 「テーマの既定」），扩展令牌 `--log-*` / `--ws-*` / `--fi-*` / `--logo-*`，`BootstrapData.themeName` 与窗口底色按主题 × 明暗，Markdown 外壳与 mermaid 跟随主题（14.3、15 节）；**动效**——`motion` 14.14.0 只作为 `packages/ui` 的依赖，渲染端经 `@pch/ui/lib/motion` 引入（令牌 + re-export），根部 `MotionConfig` 接 `appearance.reduceMotion`；**文件图标**按类别着色（27 类，A 级饱和 / B 级降饱和，颜色只分明暗）；**Logo「環」**与应用图标（`pnpm icons` 生成 `build/icon.ico` 与 `resources/icon.png`，`win.icon`、`BrowserWindow.icon`，标题栏与关于页为随主题的内联版，16.4 节）；**内置页面**设置页 `pch-settings:` 与关于页 `pch-about:`（取代 14.1 原写的 `internal://settings` 内部插件；`app.getInfo` 增加 `userDataDir` / `logsDir`，新通道 `system.openAppFolder`）；**命令注册表**（`stores/command-store.ts`，唯一的 keydown 分发 `features/shell/use-command-shortcuts.ts`，M1-K14：有模态 / 焦点在输入框时 `Ctrl+W` 不关标签）；**命令面板**（`Ctrl+K` / `Ctrl+Shift+P`，shadcn `command` + `cmdk` 1.1.1：最近使用 / 工作区 / 命令 / 文件四组）；**最近使用**（迁移 0008 `recent_items`，每工作区 100 条，只记明确的打开动作，IPC `recent.*`）；**工作区选择器**（圆环 / 列表，`Alt+W`、`Alt+1–9`、编辑模式；设置 `workspace.pickerStyle` / `pickerDetail` / `pickerView`；工作区 `color` 存颜色键；IPC `workspace.summaries` / `workspace.reorder`）；新设置键 `appearance.theme` / `appearance.reduceMotion` / `workspace.picker*`（14.1 节）；**beta 前修正**——M4 K1–K6（打包排除 `ssh2/util/**`；`CONN_AUTH_UNSUPPORTED` 与连接状态 `auth-unsupported`；改主机 / 端口解除 sudo 锁；超时后到达的 SFTP 通道关闭；清除私钥口令；地址栏复制提示），M2 F2 / Q19 / Q20 / Q24（外部链接要求最近 5 秒内有用户输入）/ Q25 / K2 / K3 / K5（launcher 只接受 Office 扩展名、`openExternal` 先确认可执行类扩展名）/ K6（`web.attach` 拒绝点段），M1-K17（UNC 访问范围，`entry.add` 例外为残余风险，15 节）/ K19（e2e 纳入 typecheck）/ K23（`shadcn` 移到 devDependencies，`pnpm audit --prod` 无已知漏洞）。涉及 5.3、6.3、6.6、7.6、12.2、13、14.1、14.3、15、16.4、17、18 节
>
> v1.27 变更（M4 远程目录（SFTP 只读）完成；设计 `devDoc/2026-11-22-37-m4-sftp-design.md`，计划 `devDoc/2026-11-22-38-m4-sftp-plan.md`，台账 `devDoc/2026-11-22-39-m4-ledger.md`，总结（控制者裁定 D1–D10 / R1–R25、推迟项、未验证项）`devDoc/2026-11-22-40-m4.md`）：**M4 改为「SFTP 只读」**——需求方 2026-11-22 放弃 SMB（未挂载 SMB 的 SmbProvider 不再做），FTP / FTPS、Office 远程编辑会话（10.5 节）、远程文件下载缓存（7.4 节）移到路线图「后续」。新增 7.6 节「远程目录（SFTP，M4）」：URI `sftp://[<身份>@]<connectionId>/<路径>`、第三种位置 `remote`（并发与可达性单位 = 一条 SSH 连接 `sftp://<connectionId>`）、主进程 `modules/connection`（连接池、保活、空闲断开、主机密钥确认、认证锁定 `auth_state` 跨重启、`sudo su - <身份>` 后在命令通道上走 `sftp-server -R`、进程表轮询判定 sudo 成功）、`vfs/providers/sftp.provider.ts`（只读：`stat` / `list`）、访问范围检查 `vfs/remote-access.ts`（K17 的 sftp 部分）、扫描进程的远程方针（只在展开 / 选中 / 标签 / F5 与「建立索引」时读取，扫描进程 ↔ 主进程消息 `remoteOp` / `remoteCancel` / `remoteResult`）、锁定的解除语义、超时语义、断线显示、残余风险与限制；迁移 0007（`connections`，取代 13 节的草案）；`index.db` 的 `entries` 加列 `owner`，`CACHE_VERSION` 5 → 6（**升级后首次启动重建整个 `index.db`，本地目录的缓存也全部重建**）；IPC `connection.*`（list / save / delete / test / reconnect / trustHostKey（带用户看到的密钥）/ answerHostKey / pendingHostKeyPrompts / home）与事件 `connection.changed` / `status` / `hostKeyPrompt` / `hostKeyPromptClosed`；错误码 `CONN_*` 11 个（含 `CONN_KEY_INVALID`）；设置 `remote.keepaliveSec` / `remote.idleDisconnectMin` / `vfs.timeoutSec.remote` / `cache.backgroundGapMs.remote` / `cache.remoteIndexIntervalMin`（`remote.cacheSizeMB` 暂无用途）；新依赖 `ssh2` 1.17.0（精确版本，不放行安装脚本）。涉及 2.3、3.2、5.2、6.3、6.6、7.1、7.2、7.4、7.6、8.3、10.5、13、14.1、18、19 节
>
> v1.26 变更（M3 完成并合并到 `main`，标签 `m3`）：路线图 M3 标为合并完成；合并前的进度、待需求方确认的决定（D1–D4、R 系列）、手动验证清单（V1–V11）与已知问题（K1–K15）见 `devDoc/2026-11-22-36-m3-summary.md`。涉及 18 节
>
> v1.25 变更（M3 试用反馈第 2 轮，记录 `devDoc/2026-11-22-35-m3-feedback-2.md`）：**自动快照尽量与现场实时同步**——自动保存兜底间隔 `300_000` → `60_000` ms，另在现场每次变化后合并 `1000` ms 立即写入（`DesktopService.liveChanged`，组合根接到 `DesktopMonitor.onChange`），消失项目到期（`LiveState.nextExpiry`）时再写一次；窗口枚举 `5000` → `2000` ms、防抖 `2000` → `1000` ms、完整读取兜底 `300_000` → `60_000` ms（VS Code 防抖保持 `10_000` ms）；**恢复后不再自动删除快照**，改为确认框（默认「保留」，「删除」→ 新通道 `desktop.clear`：删除全部快照并立即重新写本次登录的 `auto`），`DesktopRestoreOutcome.cleared` 删除（`desktop.restore` 返回 `DesktopRestoreResult`）；**Explorer 每个标签一张卡片、分别勾选**，同一窗口的多个标签用虚线框围起（「同一窗口 · N 个标签」），`desktop.save` / `desktop.exit` 的 `keys` 改为 `picks: { key, tabs? }[]`、`desktop.restore` 的 `itemIds` 改为 `picks: { id, tabs? }[]`（共享 `pickTabs`）；卡片固定高度（两行各自单行省略）；项目数统一为「Explorer 每个标签算一项」（`desktopEntryCount`，快照列表的 `itemCount` 同此）。涉及 6.2、11.4 节
>
> v1.24 变更（M3 合并前审查的修正波，实现记录 `devDoc/2026-11-22-34-m3.md` 第 8 节，设计第 9 节追加 Ruling 14–17）：**每次登录只占 1 个可见名额**——同一登录内重启本应用时接回本次登录的 `auto`（没有时接回由它改成的 `exit`），「保存して終了」把本次登录的 `auto` 原地改为 `exit`、「保存しないで終了」删除它并写 `exit-none`；**恢复后清空的条件**——只有没有 `unreachable` / `failed` 的跳过项时才清空（`open` / `missing` 视为已处理），`desktop.restore` 的结果带 `cleared`，清空失败只记 warn；第一次完整读取之前退出不写 `exit`（`DesktopCurrent.ready`，退出对话框显示读取中并禁用「保存して終了」）；退出开始后不再自动保存、重新扫描、恢复后清空；Explorer 多标签恢复中第 2 个及以后的 `::{CLSID}` 标签加 `shell:` 前缀（此前必定失败）；Excel 没有可见窗口的工作簿不记录；恢复只接受 `X:\` 与 UNC 开头的路径与 exe（Eclipse 的正斜杠 `-data` 在采集时规范化）；`desktop.save` / `desktop.exit` 的 key 上限放宽为 `65_536`；侧栏标题行「…」菜单的「終了時に確認する」（`desktop.askOnExit`）；从快照页恢复并清空后该标签改为「現在」页；`DESKTOP_SNAPSHOT_NOT_FOUND` 的 IPC 日志降为 warn；Explorer 卡片的标签数单独显示；e2e 默认假桌面模式。涉及 6.2、6.6、11.4、14.1、15 节
>
> v1.23 变更（M3 桌面记录完成；设计 `devDoc/2026-11-21-31-m3-desktop-snapshot-design.md`（含第 9 节需求方试用反馈），计划 `devDoc/2026-11-21-32-m3-desktop-snapshot-plan.md`，先行验证台账 `devDoc/2026-11-21-33-m3-ledger.md`，实现记录 `devDoc/2026-11-22-34-m3.md`）：**M3 的内容改为「桌面记录」**（需求方 2026-11-21：不恢复本应用的标签、不弹出标签；原 M3「多窗口与会话」移到路线图「后续」，是否还做以后再定）——记录并恢复本应用之外的资源管理器（含标签）、Word / Excel / PowerPoint 打开的文件、VS Code 的文件夹 / workspace、Eclipse 的 workspace。主进程新增 `modules/desktop`（koffi 每 5 秒枚举窗口 + 有变化时经固定 PowerShell 脚本 / 只读状态文件取详情、当前现场与消失 60 秒后才移除、每次登录一份原地更新的自动快照、手动 / 退出时快照、可见快照最多 3 个、`query-session-end` 冻结、退出时的保存询问与「确认已显示」保护、恢复的 exe 白名单与逐项存在性检查、恢复后清空并在 10 秒后重新扫描）；`infra/powershell.ts`（由 launcher 移来，launcher 与 desktop 共用）；迁移 0006（`desktop_snapshots` / `desktop_items`）；IPC `desktop.*` 11 个通道与 `desktop.changed` / `exitRequested` / `exitCancelled` 事件；错误码 `DESKTOP_SNAPSHOT_NOT_FOUND`（并补登记 M2 起已有的 `LAUNCH_FAILED`）；设置 `desktop.askOnExit`；渲染端 `features/desktop`（活动栏「桌面记录」视图、快照页 `pch-desktop:<id>` / `pch-desktop:current`、卡片式清单、恢复对话框与退出对话框）、`LocationKind` 增加 `desktop`。11.3 节「会话快照」标为被取代，新增 11.4 节「桌面记录」。原 M3 设想的设置键 `session.restoreOnStartup` / `window.onDetachedClose` 暂无用途，保留待确认（实现记录）。涉及 5.2、5.3、6.1、6.2、6.3、6.6、11.3、11.4、13、14.1、15、18 节
>
> v1.22 变更（M2 完成并合并到 `main`，标签 `m2`）：路线图 M2 标为合并完成；合并前的进度、待需求方确认的决定（Q3–Q25、F1–F7）、手动验证清单（V1–V11）与已知问题（K1–K9）见 `devDoc/2026-11-21-29-m2-summary.md`；Q2 / Q13（`pch-web` 范围与符号链接）需求方决定维持现状。涉及 18 节
>
> v1.21 变更（地址栏与工作区一览的追加修改，记录 `devDoc/2026-11-21-28-address-bar-copy-workspace-cards.md`）：工作区图标改为 lucide `GalleryVerticalIcon`（地址框的工作区按钮、工作区一览的标签；资源树 / 总览的分组仍为 Layers）；地址框中工作区部分（按钮 + 工作区段）成为地址框左端底色不同、以分隔线隔开、固定在左端的区域（不是框中的框）；单击当前位置（最后一段）或其后的空白处复制路径；工作区一览改为卡片网格（不显示图标，重命名 / 删除直接以按钮显示，各行等高），新建也是一张卡片（12.2、11.1 节）。
>
> v1.20 变更（M2 试用反馈的修改，记录 `devDoc/2026-11-21-26-m2-feedback.md`）：网页视图焦点交接（页面中点链接 / Alt+←→ 后焦点留在新页面）；资源树文件节点单击 / ↑↓ 停留 = 当前标签「文件信息」、双击 / Enter = 默认预览器、Ctrl+单击 / 中键 / Ctrl+Enter = 新标签默认预览器（`tab/open` / `tab/navigate` 的可选 `viewer`）；SDK `tabs.selectedViewer()`，fallback 的「无法预览」只在自动选择时显示；Office 打开方式检测结果按机器持久保存（迁移 0005 `launch_capabilities`）；预览区 → 树同步时目标目录本身也展开（跟随展开，离开时收起）；地址栏的地址框与前置工作区按钮（`LayersIcon` 快速切换菜单 +「管理工作区…」）；工作区一览页（`kind: 'workspaces'`，工作区总览的上一级）；Alt+↑ 为全局「上一级」快捷键。涉及 8、9、10、11、15、18 节
>
> v1.19 变更（M2 预览插件体系完成；设计 `devDoc/2026-11-20-22-m2-design.md`，计划 `devDoc/2026-11-20-23-m2-plan.md`，台账 `devDoc/2026-11-20-24-m2-ledger.md`，实现记录 `devDoc/2026-11-20-25-m2.md`）：查看器切换（`TabState.viewer`、`tab/viewer`、地址栏「表示」下拉与「常にこれで開く」写入 `preview.associations`）；应用消息收纳（`notify`、状态栏消息按钮、四向拖拽丢弃）；主进程 `modules/web`（每标签一个 `WebContentsView`、`pch-web://` 范围协议、`pch-asset://`、导航判定、LRU 8 个视图）与 `PreviewHost.web`；内置插件 html（含 PDF / 图片）、markdown（unified + mermaid，单独 vite 构建 `out/web-assets/markdown`）、office（启动面板）；`modules/launcher`（PowerShell 检测文件关联与 verb、`ProcessStartInfo` 经 ShellExecute 启动，删除设置 `launcher.officeDefaultAction` / `launcher.officeExtensions`）；provider `createReadStream`；第 15 节浏览器视图的安全模型。路线图 M2 标为完成；待需求方确认的决定、记录的问题与未验证项见实现记录。合并前最终修复（实现记录「已修复」）：范围根改为「首次取最外层 folder 条目根 ?? 文件所在目录，标签内跳转沿用」、跨页链接的 `?查询#锚点` 带到视图、资源树键盘浏览时视图不再抢焦点、整文件读取以 stat 大小为准、dev 代理不出 dev server 的源、外部链接每视图 2 秒一次、应用窗口的导航限制只跳过 `persist:pch-web`、launcher 只启动文件。核对 3.4、5.1、5.2、7.1、7.3、9、10、12、14、15、16、18 节与代码一致。涉及 3.4、5、7、9、10、12、14、15、16、18 节
>
> v1.18 变更（M1 完成并合并到 `main`，标签 `m1`）：路线图 M1 标为完成；合并前的进度、待需求方确认的决定（D1–D35）、手动验证清单（V1–V21）与已知问题（K1–K24）见 `devDoc/2026-11-20-21-m1-summary.md`；单窗口会话保存 / 恢复暂缓到 M3。涉及 18 节
>
> v1.17 变更（文本 / 日志预览完成；设计 `devDoc/2026-11-20-18-text-preview-design.md`，记录 `devDoc/2026-11-20-20-text-preview.md`）：新增纯逻辑包 `@pch/text-engine`（行索引、按行读取、编码判断、解码、分页数学；不依赖任何包、不碰 Node / DOM / Electron，eslint 以 `no-restricted-imports` / `no-restricted-globals` 强制）；provider 增加 `read(uri, offset, length, signal?)`（每次开-读-关；读取进行中其上级目录无法改名，已知限制，7.1）；主进程 `vfs/document/` 文档服务（字节窗口、1MB 分块后台索引、`doc.open` / `readLines` / `refresh` / `setEncoding` / `close`、归属窗口与上限、轮转 / 消失 / 追加判定）与 `vfs.sniff`（7.5）；编码判断自写（BOM、UTF-16 无 BOM、UTF-8 校验、CJK 逐字节评分），不引入 `encoding-japanese`（对比实验与验收样本见设计第 4 节与 devDoc 记录）；插件体系：`PreviewHost.doc`、`match.textLike`、`manifest.handlesMissing`、`tabs.viewAs` / `canViewAs`、未匹配文件的 sniff（9.3）；内置文本插件 `pch.preview.text`（自绘分页视图、块缓存、编码下拉、日志跟随末尾、部分模式「读取全部」，9.4）；设置 `preview.maxTextSizeMB` 改为「自动建立完整行索引的上限」（14 节）；路线图中文本 / 日志预览标为完成。核对 3.4、5、7.1、7.5、9.1、9.3、9.4、14、18 节与代码一致。涉及 3.4、5、7.1、7.5、9、14、18 节
>
> v1.16 变更（M1-3b 导航、同步与资源树改进完成；设计 `devDoc/2026-11-19-15-navigation-design.md`，记录 `devDoc/2026-11-19-17-navigation.md`）：标签显示「位置」并带各自的后退 / 前进历史（`TabLocation` / `TabHistory`，后退 / 前进恢复离开时的 `viewState`），逻辑路径（`lib/logical-path.ts`）与工作区总览（`kind: 'workspace'`，应用内置视图）；**浏览器式打开**（需求方 2026-11-20 确认）：单击 / Enter 在当前标签打开，中键 / `Ctrl+单击` / 右键在新标签打开，↑↓ 防抖 400ms 后打开并入历史，**取消预览标签**（`TabState.preview`、`tab/promote`、斜体、SDK 的 `preview` 选项均删除），`explorer.singleClickPreview` 键名保留、语义改为「单击 / 键盘移动选中即在当前标签打开」；应用级地址栏（`features/address-bar`：后退 / 前进 / 上一级 / 刷新 + 逻辑路径段 + 工作区下拉，`Alt+←` / `Alt+→` / `F5` / 鼠标侧键；有模态对话框时不处理）；刷新经 tabs-store 的 `refreshSeq` 与 `host.tabs.onRefresh`，显式刷新（按钮 / F5 → `vfs.refresh`）越过扫描进程的 2 秒 P0 去重；资源树与预览区双向同步（`stores/navigation-store.ts`，树跟随标签、找不到目标时不改选中）；按类型显示图标（`@pch/ui` 的 `iconFor` / `FileIcon`）；资源树工具（定位到当前项、全部折叠）与分组抽屉（顶层分组互斥展开、被挡住的选中显示在最近的可见祖先、根下拖放按同类吸附）。核对 8.2、9、11、12 节与代码一致；路线图中 M1-3b 标为完成。涉及 5.1、5.2、8.2、8.3、9、11、12、14、18 节
>
> v1.15 变更（M1-3 完成，**最低可用原型**；设计 `devDoc/2026-11-19-12-m1-3-design.md`（需求方尚未确认，按其第 6 节的控制者决定实现），记录 `devDoc/2026-11-19-14-m1-3.md`）：单窗口标签（`layoutReducer` 在 `packages/shared`，状态由渲染端 `stores/tabs-store.ts` 持有，M3 再移到主进程）、预览模式、最小插件体系（注册表计分、`PreviewContainer` 每标签 ErrorBoundary + Suspense、`PreviewHost` 子集）、内置 folder（详细信息列表、排序、面包屑、虚拟滚动、同标签导航）与 fallback（文件信息、用系统应用打开）插件；`system.openPath` 恢复为 IPC（只由预览插件的宿主调用，可执行类扩展名先确认）；`vfs.interest` 增加 `tabs`（激活标签显示的目录按关注点处理）。**预览标签转常驻的规则裁定（控制者 2026-11-19）**：双击标签头，或插件调用宿主动作（`tabs.*` / `system.*`）后转为常驻；在标签内滚动、点击、按键不转常驻（否则在预览标签里浏览文件夹会使其变常驻，预览复用失去意义）；旧说法「双击或开始交互后转为常驻」已更正。目录视图不显示「基于缓存（N 前）」（无变化时没有事件，时间会越来越旧而误导）。核对 9、11、12、18 节与代码一致，并删除 12.2 / 5.2 中「进行中 / 后续任务」的过时表述。最终审查修复波（`devDoc/2026-11-19-14-m1-3.md`「最终审查修复」）：目录标签不等 stat（用标签的类型与标题交给 folder 插件，断开 / 无响应 / 删除由 `fs.list` 表现），文件标签 stat 新鲜期 5 秒、共享断开时不 stat；`fs.list` 的「已断开」以渲染端可达状态为准，可达状态变化时目录视图重新列出；扫描进程删除目录缓存时也通知其下按关注点处理的目录（目录视图据此显示「找不到」）；`tabs.navigate(uri, kind?)` 接受类型提示以省掉 stat；新增 `fs.refresh` 与目录视图的「刷新」按钮 / `F5`（越过条目根的目录不进缓存、不自动更新）；可执行类扩展名追加 21 个；5.1 节 folder `format.ts` 的描述更正。涉及 5.1、5.2、8.3、9、11、12、18 节
>
> v1.14 变更（缓存目录编号与两个遗留问题，设计 `devDoc/2026-11-19-10-dir-id-plan.md`，记录 `devDoc/2026-11-19-11-dir-id.md`）：`index.db` 的 `entries` 不再保存目录 URI，改为 `dir_id` 引用 `dirs.id`（`INTEGER PRIMARY KEY AUTOINCREMENT`，编号不复用），`dirs.parent_id` 取代 `parent_uri`，`CACHE_VERSION` 5；同一棵合成树（1 万目录 / 11 万条目、平均 URI 204 字符）的 `index.db` 由 75.19MB 降为 23.45MB，搜索与队列耗时不变或更快，删除更快，写入略慢；父行不存在时 `parent_id` 为 NULL，新建目录行后认领孤儿。遗留问题：系统时钟回拨时 `listNow` 的 fresh 判断与 P0 去重把「确认时刻在未来」视为不新鲜 / 不重复（此前 F5 与展开会静默失效到时钟追上）；读取得到 `FS_NOT_A_DIRECTORY`（目录被同名文件替换）时只删除该目录自身的缓存，并对父目录排一次确认（P0，不与刚完成的合并），不再从父目录的缓存列表中删除该项。读取得到 `FS_NOT_FOUND` 时除了从父目录的缓存列表中删除该项，还让父目录的修改时间比较失效（`dir_mtime` 置 NULL）并对父目录排一次确认（P0，`force`），该目录行保留为 `not-found`，再次出错不再强制父目录（此前上级目录改名后改回时，父目录的列表会永远缺少该子目录，e2e 原则用例偶发失败）。涉及 5.2、8.3、13、19 节
>
> v1.13 变更（缓存策略：第二版调度，设计 `devDoc/2026-11-19-01-refresh-cache-design.md` 第 8 节，记录 `devDoc/2026-11-19-09-cache-strategy.md`）：「刷新级别」改称「缓存策略」（ja「キャッシュ方針」/ zh-CN「缓存策略」/ en「Cache strategy」，级别名不变）：设置键 `refresh.*` → `cache.*`（`cache.strategy.*`、`cache.activeDepth`、关注点 / 近 / 远三层的定期确认间隔 `cache.interval.{focus,near,far}.*`、后台休息 `cache.backgroundGapMs.*`），IPC `entry.setCacheStrategy`，迁移 0004 把列改名为 `cache_strategy`；缓存不设过期（去掉「超过 1 小时强制完整读取」与按轮次的后台扫描 `refresh.backgroundIntervalMin` / `refresh.intervalSec.*`），只在发现信息错误时更新或删除；定期确认按离关注点的远近分三层；后台改为优先级队列（`scanner/schedule/background-queue.ts`：每个位置组同时 1 个、每个完成后休息、用户操作中加倍，从 `index.db` 按部分索引批量取候选，`CACHE_VERSION` 3 新增 `depth` 生成列）；从搜索结果定位失败时顺带确认出错的那一层目录；性能数字写明测量条件（内存库 / 文件库、层数上限、数据形状），新增「全部」策略下从空缓存补满的实测与外推。最终审查修复波（`devDoc/2026-11-19-09-cache-strategy.md`「最终审查修复」）：近层、远层各至多 100 个目录（`TIER_LIMIT`，每个窗口；按离关注点的远近取），同一位置组的近 / 远层确认之间至少间隔 `PERIODIC_GAP_MS`（网络 200ms、本地 50ms），层的间隔因此是下限；目录读取得到「不存在」时也从父目录的缓存列表中删除该项（`Cache.removeMissing`）；系统时钟回拨时按现在计算到期 / 可选时刻；`Cache.hot` 改走部分索引 `dirs_hot`（`CACHE_VERSION` 4）；写明后台队列的稳态、盲区的统一说明与「消极」根下建立索引目标的发现时机，③④ 顺序的理由按当前机制更新。涉及 5.2、7.1、8.2、8.3、8.4、13、14.1、19 节
>
> v1.12 变更（去掉访问时间保护，原则改为新表述，记录 `devDoc/2026-11-19-06-refresh-cache.md`「去掉访问时间保护」）：需求方决定读目录一律以只读方式（`FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES`）打开，不再以 `FILE_WRITE_ATTRIBUTES` 打开、不再用 `SetFileInformationByHandle` 设置 LastAccessTime = -1，因此不会在文件服务器上留下 WriteAttributes 类审核记录，I5 随之消除；目录的访问时间按系统设置被更新，属于新原则允许的范围；变化检测用目录的修改时间，与访问时间无关。项目原则改为：「应用不变动文件和目录的数据：不写入、不新建、不删除、不移动、不改名，不长期持有句柄（不能妨碍用户改名或移动）。读取时由系统自动更新的元数据（如访问时间）不在此列。」。涉及 7.1、7.2、19 节与目录结构说明
>
> v1.11 变更（扫描引擎与搜索的最终审查修复，记录 `devDoc/2026-11-19-06-refresh-cache.md`「最终审查修复」）：Win32 错误码只有确定的网络 / 设备不可用类映射为 `FS_UNAVAILABLE`（其余为 `UNKNOWN`，只记该目录 unreachable），以写属性打开失败时除不存在与网络 / 设备不可用外都退回只读句柄，87 只在第一批且确认目标不是目录时才是「不是目录」；扫描进程重启 / 降级时主进程对断开的共享发出 `online`，新增 IPC `vfs.offlineShares`，渲染端启动时以它初始化断开状态；共享恢复在线时该共享下的目录查询失效；`listNow` 在 2 秒内检查过（fresh）时不再排 P0（检测到变化后不再多一次完整枚举）；缓存的子树删除改为走主键索引的范围条件（与搜索共用 `subtreeCondition`）；客户端 60 秒兜底超时改为 `FS_TIMEOUT`、不再回退直接枚举；通配符 `?` 按码点匹配；扫描进程 shutdown 的步骤抛错时仍关闭缓存库并退出。新增已知限制 I5（以写属性打开目录在开启对象访问审核的文件服务器上留下 WriteAttributes 记录）。涉及 5.2、5.3、6.3、6.6、7.1、8.3、8.4、12.1、19 节
> v1.10 变更（文件名搜索完成，设计 `devDoc/2026-11-19-02-search-design.md`（需求方尚未确认，按其第 6 节的控制者决定实现），记录 `devDoc/2026-11-19-07-search.md`）：扫描进程在 `index.db` 中按名称查询（FTS5 trigram + 短词 / 通配词过滤，只读缓存、不访问文件系统），IPC `search.query`；活动栏新增「搜索」视图与 `Ctrl+Shift+F`：输入防抖 150ms、类型筛选、虚拟滚动的结果列表（匹配片段高亮、「条目标签 › 父目录」）、「基于缓存（N 分钟前更新）」与「部分目录尚未扫描」、无结果 / 截断 / 搜索不可用的状态；Enter / 单击经 `stores/navigation-store.ts` 在资源树中定位（展开祖先、逐层等待列表、选中并滚动）。新增 8.4 节，涉及 5.3、6.3、8.4、12.1、12.2、14.2、18 节
> v1.9 变更（目录刷新与缓存引擎完成，设计 `devDoc/2026-11-19-01-refresh-cache-design.md`，记录 `devDoc/2026-11-19-06-refresh-cache.md`）：删除 `fs.watch` 目录监听，改为扫描进程（utilityProcess）+ 缓存库 `index.db`：koffi 原生枚举（按隐藏属性判断、不更新目录的访问时间）、4 级刷新级别与「建立索引」、P0 / P1 / P2 调度与按位置分组的并发、按「没有进展的时间」计的超时、共享断开时显示缓存与退避重试；条目级刷新级别 / 建立索引的右键菜单与断开图标；按松手位置插入、拒绝临时目录下的系统拖入；删除「用系统应用打开」与 `system.openPath`（需求方决定：资源树只用于展示，对文件的操作都放在将来的预览窗口中，相关的未来设计段落已标注）；主进程启动时记录 koffi（GetDriveTypeW）是否可用。新增原则回归 e2e（展开 `A\B\C` 时改名 `A`）与打包实测、性能记录。涉及 5.2、6.3、7.1、7.2、7.4、8.2、8.3、9.3、9.4、10.6、13、14.1、17、18、19 节
> v1.8 变更（M1-2 最终审查修复）：窗口聚焦刷新改为实际生效（focusManager 同时监听 `focus` 与 `visibilitychange`；目录列表单独设 2 秒新鲜期并在重新挂载 / 聚焦时重新列出，此前写的 `'always'` 在 Electron 中常见情况下不触发、且折叠后再展开会显示旧缓存）；监听出错但目录仍在时不再循环重建（provider 只报告失效、`VfsService` 对失效的 URI 退避 60 秒）；不再需要的目录列表请求会取消；`vfs.watch` 超过 500 个时截断并警告。新增已知限制 / 待需求方决定：监听句柄阻止上级目录改名或移动（三个候选方案）、虚拟文件拖入的描述按 Chromium 的实际行为改写（三个选项）；拖放导航的主防线改为 `navigateOnDragDrop` 默认值。涉及 7.1、8.2、8.3、12.1、19 节
> v1.7 变更（M1-2 资源树完成）：工作区切换器、虚拟化资源树（懒加载、状态行、键盘）、只管理条目的拖放、右键菜单、目录监听（`vfs.watch` / `vfs.changed`）与系统操作 IPC 已实现；按代码修正 `vfs.changed` 的负载、Provider 的 `watch` 签名与错误码列表；新增已知限制（虚拟文件拖入可能固定 %TEMP% 副本；条目目录删除后重建需「重试」/ F5 / 聚焦才恢复，恢复后监听自动重建）。涉及 3.3、5.2、5.3、6.3、6.6、7.1、7.2、8.1–8.3、12.1、12.2、14.2、17、18、19 节
> v1.6 变更（M1-2 开工前的决策）：资源树的拖放只管理自定义条目、绝不产生文件操作；树内拖动用浏览器原生拖放；列目录时解析符号链接 / 目录联接的目标类型；可把真实子目录「固定」为条目（条目也可按 URI 添加）；复制路径的格式；外壳通过插槽组合各 feature。涉及 5.3、7.1、8.2 节
> v1.5 变更（M1-1 数据层完成）：工作区 / 条目的存储与规则、VFS（LocalProvider、VfsService）与对应 IPC 已实现；更新 5.2、6.1、6.3、6.6、7.1、7.2、8.1、13 节的「已实现」标注与细节
> v1.4 变更（M1 开工前的决策）：标签状态在 M1 即按最终设计由主进程的 layoutReducer 持有（先支持单窗口）；M1 实现最小插件体系（PreviewContainer + 只含 folder 的注册表）；内置插件合并为单个 `plugins/builtin` 包；目录变更感知改用 Node 内置 `fs.watch`（不引入 chokidar），并明确网络路径与 FTP/SFTP 的刷新策略。涉及 2.5、3.2、3.3、5.1、8.3、18 节
> v1.3 变更（M0 完成）：Windows 下不再使用系统窗口按钮（Window Controls Overlay），改为自绘窗口按钮；分发形式改为 zip 免安装文件夹版（不提供安装程序）；新增第 20 节「文档与知识管理」；修正 5.2、6.1、6.2、6.3、12.2、14.2、14.3、16.4 等处与实现不一致的描述；目录结构区分「目标结构」与「M0 已实现」
> v1.2 变更（M0 实施后的技术栈复审）：渲染端由 Next.js 静态导出改为 electron-vite（Vite + React），去掉 tsup 与自写开发脚本；数据库访问由 Drizzle 改为 Kysely；shadcn/ui 底层由 Radix 改为 Base UI；IPC 改为单通道传输；新增模块边界 lint、渲染端错误落盘、Electron Fuses 与打包工具链说明。涉及 2.1、2.2、2.6、3、5、6.3、6.5、12.3、13、16、17、19 节
> v1.1 变更：Office 文件改为调用本机 Office（只读 / 编辑 / 新建打开），新增第 10 节；移除 SheetJS 与 docx-preview；后续章节顺延编号
> 选型原则：依赖包、架构与设计层面有可选项时，优先采用官方推荐、默认或代表演进方向的选项，因安全原因偏离时在文中注明；交互行为不适用此原则，以实际效果和使用者立场判断
> 定位：面向对日 IT 保守（运维）人员的「工作区式」自定义文件管理器
> 技术基线：Electron 45（内置 Node 24）、electron-vite（Vite + React 19）、shadcn/ui（Base UI、Tailwind CSS v4）、TypeScript

---

## 1. 需求理解与设计回应

**需求方要解决的痛点与目标**（需求方原话整理，2026-11-19；作为功能取舍与优先级的依据）：

1. 文件总是不知道放在哪里：各种地址、目录太多，Windows 资源管理器又把所有东西都作为对象。希望只把关注的目录组织起来管理、直接浏览。
2. 常见文件类型的浏览简单化、集中化：很多时候并不需要编辑，有时又需要打开各种软件。
3. 工作区记录与隔离：同时对应多个案件时，一下打开很多目录很乱；今天做这件事、明天做那件事，相关的目录和文件按工作区组织，容易找到、容易区分。
4. 很多事情集中在一个软件里完成，更容易进入心流。
5. 将来：工作区的导入导出，让新人快速上手、熟悉项目。
6. 将来：恢复工作区，电脑重启后快速恢复关机前打开的文件和目录，直接继续工作。
7. 好看、有面子。
8. 所以起名「高级牛马」（PremiumCowHorse）。

对应关系（2026-11-19 时点）：1 → 工作区条目、资源树、扫描缓存与文件名搜索（M1，已实现）；2 → 标签页与预览插件（M1-3 目录视图已实现，文本 / 日志预览随后，其余 M2）；3、6 → 会话快照与恢复（单窗口版先行，多窗口原定 M3；2026-11-21 起 6 改由 M3「桌面记录」回应：重启后恢复本应用之外的程序与资源管理器，应用内会话与多窗口移到「后续」，11.3 / 11.4 节）；4 → 命令面板、最近使用（M5）；5 → 工作区导出 / 导入（后续）。


| 需求 | 设计回应 |
|---|---|
| 管理对象完全自定义（本地目录、已挂载 SMB、未挂载 SMB、FTP/SFTP、单个文件） | 统一资源模型：一切皆 **URI**，由 **虚拟文件系统（VFS）+ Provider 插件化** 屏蔽差异 |
| 文件树展示 | 工作区「条目树」（用户自定义）＋ 真实目录（懒加载）混合成一棵虚拟化树 |
| 工作区（一个案件一个工作区） | Workspace 为一等公民，条目、会话（打开的标签等）均按工作区隔离 |
| 文件预览，必须插件化 | **预览插件 SDK**：声明式匹配 + 懒加载组件 + 受限的 Host API |
| Excel 等用本机 Office 打开（只读 / 编辑 / 新建） | 读取 Windows 文件关联检测 Office 实际提供的打开方式，只提供检测到的；FTP/SFTP 文件通过「远程编辑会话」自动回传 |
| 目录内容也是一种预览 | 目录视图本身就是内置预览插件 `pch.preview.folder`，与文件预览走同一套机制 |
| 标签化、可同时打开多个、可独立弹窗 | 主进程统一管理「窗口 × 标签」布局状态，标签可在窗口间移动、弹出 |
| 关机后从中断处恢复 | 会话快照（窗口、标签、插件视图状态、树展开状态）按工作区持久化到 SQLite |
| 国际化 | i18next 主进程与渲染进程共用同一份语言资源（ja / zh-CN / en） |
| 设置等数据存 SQLite | Node 24 内置 `node:sqlite` + Kysely（类型安全查询构建器），无原生模块编译负担 |
| 现代简约风格、可切换主题 | shadcn/ui + 自绘标题栏（含自绘窗口按钮，不使用系统原生按钮）；明/暗/跟随系统 + 多套强调色 |

---

## 2. 关键技术决策

### 2.1 渲染端构建：electron-vite + 自定义协议

使用 electron-vite（官方脚手架 `@quick-start/electron` 的 react-ts 模板为基准）统一构建主进程、preload 与渲染端：开发环境渲染端由 Vite dev server 提供（HMR），主进程 / preload 改动后自动重启 Electron；生产环境渲染端产物位于 asar 内，通过自定义协议 `app://renderer/` 加载（Electron 安全指南建议以自定义协议代替 `file://`）。

v1.2 由 Next.js 静态导出改为此方案，理由：桌面应用不需要 SSR，静态导出下 Next.js 只剩打包与两个页面的路由，却带来客户端渲染门控、CSP 必须允许内联脚本、`transpilePackages` 等额外成本；去掉后 tsup 与自写的开发编排脚本也一并移除。主窗口与弹出窗口共用同一个单页应用，窗口角色由启动参数（bootstrap）区分，不需要路由库。

与官方模板的差异（均出于 Electron 安全指南）：`sandbox: true`；不使用 `@electron-toolkit/preload`（它向页面暴露完整的 ipcRenderer）；不使用 `loadFile`，改用 `app://` 协议。

### 2.2 数据库：内置 `node:sqlite` + Kysely

Electron 内置 Node 24，`node:sqlite` 随 Node 自带，无需 `better-sqlite3` 那样针对 Electron ABI 重新编译原生模块（企业网络下预编译包下载失败时还需要本机编译环境）。访问层使用 Kysely（类型安全的 SQL 查询构建器，非 ORM）：其 SQLite 方言声明为单连接，运行时用连接互斥锁串行化所有查询，事务期间其他查询排队等待，不会混入事务；`node:sqlite` 与其接口仅差参数传递方式与 `reader` 属性，适配约 20 行。

迁移以 TypeScript 代码编写（`infra/db/migrations/`），随主进程一起打包，运行时不读取 SQL 文件；表的 TypeScript 类型在 `infra/db/schema.ts` 中手写维护。

v1.2 变更说明：Drizzle 稳定版（0.45）尚无 `node:sqlite` 驱动（仅 1.0 RC 提供），经 sqlite-proxy 驱动接入时事务在并发请求下不安全，因此改用 Kysely。

风险兜底：数据访问全部收敛在 `infra/db/client.ts` 与各模块的 `*.repo.ts`，若将来 `node:sqlite` 出现问题，切换到 `better-sqlite3` 只影响 `client.ts`。

### 2.3 统一资源模型：URI + 虚拟文件系统

| 资源类型 | URI 形式 | Provider |
|---|---|---|
| 本地目录/文件 | `file:///C:/work/案件A/設計書.xlsx` | LocalProvider |
| 已挂载 SMB（盘符） | `file:///Z:/share/doc` | LocalProvider |
| 已认证的 UNC 路径 | `file://fileserver/share/doc` | LocalProvider |
| 未挂载 SMB（需凭据） | `smb://{connectionId}/share/doc` | SmbProvider（**放弃**：需求方 2026-11-22） |
| FTP / FTPS | `ftp://{connectionId}/var/log/app.log` | FtpProvider（路线图「后续」） |
| SFTP | `sftp://{connectionId}/home/ope/batch`；切换身份 `sftp://app1@{connectionId}/opt/app1/log` | SftpProvider（M4 已实现，只读，7.6 节） |
| 应用内置页面 | `pch-workspaces:`、`pch-desktop:<id>`、`pch-settings:`、`pch-about:` 等 | （非 VFS，由 `PreviewContainer` 渲染应用内置视图；M5 起取代原写的 `internal://settings` 内部插件，14.1 节） |

URI 的 authority 部分使用 **connectionId** 而不是主机名：凭据不会出现在 URI 和条目数据中；服务器地址变更时只需改连接配置，所有引用自动生效。

### 2.4 「目录也是预览」

标签页打开的永远是「某个 URI + 某个预览插件」。目录视图（列表/网格/详细信息、排序、面包屑）就是 `pch.preview.folder` 插件。这样标签、弹窗、会话恢复、"用其他方式打开" 等机制对目录和文件完全一致，没有特殊分支。

### 2.5 主进程是「窗口与标签」状态的唯一事实来源

多窗口下如果每个渲染进程各自保存标签状态，移动标签、弹出窗口、会话保存都会出现一致性问题。因此布局状态（Layout）由主进程持有，渲染进程只发送「意图」（打开、关闭、移动、弹出），主进程用一个**纯函数 reducer** 计算新状态并广播给相关窗口。reducer 放在 `packages/shared`，可单元测试。M1 即按此实现（先只支持单窗口），原计划 M3 在其上增加弹出窗口与会话持久化（2026-11-21 起移到路线图「后续」，M3 改为桌面记录）。

### 2.6 IPC：类型化契约 + zod 校验 + 单通道传输（自研薄封装）

在 `packages/shared` 中集中定义所有通道的输入 schema 和输出类型，主进程注册时强制穷尽实现，渲染端调用时自动获得类型提示。传输层只有两个固定的 Electron 通道：渲染端调用经 `pch:invoke`（`{ channel, input }`）进入，由主进程按契约分发与校验；主进程广播经 `pch:event`（`{ event, payload }`）发出。通道白名单只存在于主进程的契约中，preload 不维护任何列表。没有选用 electron-trpc 等库，原因是封装代码不足 100 行，可控性更高，也少一个依赖。

### 2.7 Office 文件交给本机 Office，能力以检测为准

不在应用内渲染 Office 文件，而是调用本机 Office。只读、编辑、新建三种方式是否提供，以 Windows 文件关联中实际注册的动作和 Office 官方命令行开关为准，检测不到就不提供，不做模拟。详见第 10 节。

---

## 3. 技术栈与依赖清单（新引入包须知）

除指定的 Electron、shadcn/ui 外（v1.2 起不再使用 Next.js，见 2.1 节），以下均为**新引入**的包，按用途分组说明。表中包含各里程碑**计划**引入的包；实际已安装的包与版本以各 `package.json` 与 `pnpm-lock.yaml` 为准（截至 M1-2 尚未安装：basic-ftp、ssh2-sftp-client、iconv-lite、jschardet、mime、@dnd-kit/*、react-hook-form、CodeMirror、react-markdown、pdfjs-dist；@tanstack/react-virtual 于 M1-2 安装）。新增依赖前先向需求方说明。

### 3.1 工程与构建

| 包 | 用途 | 选择理由 / 备选 |
|---|---|---|
| pnpm（工具，非依赖） | monorepo 包管理 | workspace 支持好、磁盘占用小 |
| typescript | 全项目语言 | — |
| electron-vite（含 vite、@vitejs/plugin-react） | 构建主进程、preload、渲染端；开发时 HMR 与主进程自动重启 | 官方脚手架模板为基准；取代 v1.1 的 Next.js + tsup |
| electron-builder | 打包（zip 免安装文件夹版，见 16.4 节） | 生态成熟，electron-vite 模板默认；备选 Electron Forge |
| tailwindcss v4（@tailwindcss/vite） | 样式 | shadcn/ui 前置依赖；Vite 项目官方推荐的插件方式 |
| @electron-toolkit/tsconfig | TypeScript 预设 | electron-vite 模板默认 |

### 3.2 主进程

| 包 | 用途 | 选择理由 / 备选 |
|---|---|---|
| kysely | 类型安全的 SQL 查询构建器，驱动 `node:sqlite`；迁移 | 单连接互斥锁保证事务安全；v1.1 的 drizzle-orm 见 2.2 节 |
| @electron-toolkit/utils | 开发环境判断、DevTools 快捷键、AppUserModelId | electron-vite 模板默认 |
| zod | IPC 输入、设置项、连接配置的校验（三端共用） | 事实标准；同时服务 react-hook-form |
| basic-ftp | FTP / FTPS 客户端（FTP 在路线图「后续」，尚未引入） | 纯 JS、维护活跃、支持断点续传（startAt） |
| ssh2 1.17.0（M4 已引入，精确版本；`@types/ssh2` 1.15.6） | SSH / SFTP 客户端：保活、异步 `hostVerifier`、自定义 `authHandler`、同一连接上多个通道；在 `sudo su -` 之后的命令通道上走 SFTP 借用其内部类 `lib/protocol/SFTP.js`（7.6 节） | 纯 JS；可选的原生加速 `cpu-features` 不需要，`allowBuilds` 中 `ssh2` / `cpu-features` 均为 false（不放行安装脚本）。原计划的 `ssh2-sftp-client` 是其 Promise 封装，不能在命令通道上走 SFTP，未采用（设计 4.3 节） |
| （不再使用）Node 内置 `fs.watch` | 目录变更监听（M1-2；2026-11-19 起改为扫描 + 缓存，8.3 节） | 监听句柄阻止上级目录改名 / 移动，已删除。v1.4 起不使用 chokidar：只需非递归监听已展开的目录，Windows 上 `fs.watch` 即系统原生的目录监听；chokidar 在网络路径上同样依赖 `fs.watch`（官方建议改用轮询），不能解决网络路径的问题 |
| electron-log | 日志落盘与轮转 | Electron 场景最常用 |
| koffi 3.3.8（已引入） | FFI 调用 Windows API：目录枚举（`CreateFileW` 只读打开 + `GetFileInformationByHandleEx`，一次取得名称、大小、时间、隐藏属性）、`GetDriveTypeW`（区分映射的网络盘） | Node-API 预编译二进制在可选依赖 `@koromix/koffi-win32-x64` 中，安装脚本只检查二进制能否加载、不联网下载；无需针对 Electron ABI 重新编译；打包时 electron-builder 自动把 `koffi.node` 解包到 `app.asar.unpacked` |
| iconv-lite + jschardet | 文本编码检测与转换 | 对日项目大量 Shift_JIS / EUC-JP 的 CSV、日志、bat |
| mime | 由扩展名推断 MIME | 体积小 |
| i18next | 国际化核心（主进程菜单、对话框也要翻译） | 与渲染端共享资源 |

### 3.3 渲染进程

| 包 | 用途 | 选择理由 / 备选 |
|---|---|---|
| @tanstack/react-query | 「来自主进程的数据」的缓存、失效、加载状态 | 目录列表、工作区、连接等天然是异步数据 |
| zustand | 纯 UI 状态（布局镜像、树展开、侧栏等） | 轻量、无样板代码；备选 Jotai |
| react-i18next | React 绑定 | 与 i18next 配套 |
| @tanstack/react-virtual | 文件树、目录列表虚拟滚动 | 上万文件的目录也流畅（M1-2 引入 3.14，需求方已确认） |
| @dnd-kit/core、@dnd-kit/sortable | 标签排序（是否引入在 M1-3 决定） | 可访问性好；备选 pragmatic-drag-and-drop。资源树不使用：v1.6 起树内拖动与系统拖入共用浏览器原生拖放（8.2 节） |
| react-hook-form + @hookform/resolvers | 设置页、连接编辑表单 | shadcn Form 组件的官方搭配 |
| lucide-react | 图标 | shadcn 默认图标库 |
| shadcn 组件附带依赖 | @base-ui/react（v1.2 由 radix-ui 改为 shadcn 当前默认的 Base UI）、react-resizable-panels（分栏）、sonner（通知）、class-variance-authority、cn（shadcn 官方的类名合并库，替代 clsx + tailwind-merge）、tw-animate-css；命令面板等组件随里程碑按需添加 | 由 shadcn CLI 随组件安装 |

### 3.4 内置预览插件

| 包 | 用途 | 备注 |
|---|---|---|
| CodeMirror 6（@codemirror/* 及 @uiw/react-codemirror） | **将来**的文本编辑 / 语法高亮（小文件）；当前文本 / 日志预览是自绘分页视图，不使用（设计第 8 节） | 比 Monaco 轻得多；尚未引入 |
| unified + remark-parse + remark-gfm + remark-rehype + rehype-slug + rehype-stringify | Markdown 预览（GFM 表格 / 任务列表 / 删除线 / 自动链接 / **脚注**、GitHub 风格标题锚点、原始 HTML 原样输出） | M2 安装（取代 react-markdown）。在浏览器视图中由应用自带的查看脚本运行（9.4 节 markdown），不进应用渲染端；不需要 rehype-raw（raw 节点由 rehype-stringify 输出、浏览器插入时解析） |
| mermaid | Markdown 中 ` ```mermaid ` 代码块渲染为图 | M2 安装；只在页面含 mermaid 代码块时动态加载。打进产物约 5.2MB（未压缩 JS 分块，zip 中约 1.5MB；台账 S8） |
| pdfjs-dist | PDF 预览 | Mozilla 官方；**推迟**：M2 起 PDF 先由浏览器视图（Chromium 内置 PDF 查看器）显示 |
Markdown 的 7 个包都放在 `apps/desktop` 的 devDependencies：查看脚本由单独的 vite 构建打包进 `out/web-assets/markdown`（`vite.markdown.config.ts`），运行时不 require，electron-builder 只打包 dependencies，不会重复进入安装包。

文本 / 日志预览（设计 `devDoc/2026-11-20-18-text-preview-design.md`）的行索引、按行读取与编码判断由工作区包 `@pch/text-engine` 自写，不引入第三方依赖（检测库的取舍见该设计第 4 节）。图片、音视频使用浏览器原生能力，无需依赖。Office 文件改由本机 Office 打开（第 10 节），因此**不再引入** xlsx（SheetJS）与 docx-preview；Office 联动只使用系统自带的 PowerShell，不新增依赖。

### 3.5 质量保障

| 包 | 用途 |
|---|---|
| eslint、prettier | 规范与格式 |
| vitest | 单元/集成测试 |
| @playwright/test | Electron 端到端测试 |
| eslint-plugin-boundaries | 用 lint 强制模块依赖方向（规则见 5.5 节） |
| @electron-toolkit/eslint-config-ts 等 | electron-vite 模板默认的 ESLint / Prettier 配置 |

### 3.6 后续阶段可能引入（届时再确认）

electron-updater（自动更新）。koffi 已作为依赖引入（3.2 节），以下用途尚未实现：用 `WNetAddConnection2` 做 SMB 认证以替代 `net use`；用 `ShellExecuteExW` 调用 Office 打开动作以替代 PowerShell（适用于终端策略禁止 PowerShell 的环境）；用 `WNetGetConnectionW` 把映射盘符转换为 UNC。

---

## 4. 总体架构

```
┌──────────────────────────── Renderer（Vite + React 单页应用，每个窗口一个）───────────────────────┐
│  app/（根组件） → features/（工作区·资源树·标签·预览·连接·设置·外壳） → data/·lib/                    │
│  状态：TanStack Query（主进程数据）｜ Zustand（UI 状态与布局镜像）                                   │
│  预览插件：plugins/* ──只依赖──▶ plugin-sdk（PreviewHost）                                           │
└───────────────▲──────────────────────────────────────────────▲─────────────────────────────────────┘
                │ window.pch.invoke / on（类型化 IPC）           │ pcfs://（文件内容流，支持 Range）
┌───────────────┴─── Preload（contextBridge，白名单 API）────────┴─────────────────────────────────────┐
└───────────────▲──────────────────────────────────────────────▲─────────────────────────────────────┘
┌───────────────┴──────────────────────── Main Process ─────────┴─────────────────────────────────────┐
│  ipc/ 路由（校验 + 错误包装）                                                                         │
│  modules/：workspace · connection · layout · session · settings · plugin · system · launcher        │
│  vfs/：VfsService ─▶ Local / Smb / Ftp / Sftp Provider ｜ 连接池 ｜ 远程文件缓存 ｜ pcfs 协议          │
│  infra/：db（node:sqlite + Kysely）· logger · secret-store（safeStorage）· paths · i18n              │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

依赖方向是单向的：Renderer → Preload → Main；Main 内部 `ipc → modules → vfs/infra`；`packages/shared` 被三端共用但不依赖任何一端。

---

## 5. 代码组织结构

### 5.1 Monorepo 全貌

```
premium-cow-horse/
├── apps/
│   └── desktop/                  # Electron 应用：src/main · src/preload · src/renderer（electron-vite 目录约定）；src/web-assets/markdown（Markdown 查看脚本，浏览器入口，由 vite.markdown.config.ts 单独构建，M2）
├── packages/
│   ├── shared/                   # 三端共用：IPC 契约、领域类型、zod schema、URI 工具、布局 reducer
│   ├── i18n/                     # 语言资源（ja / zh-CN / en）与 i18next 初始化工厂
│   ├── ui/                       # shadcn/ui（Base UI）组件与主题 CSS（供渲染端与插件共用）
│   ├── plugin-sdk/               # 预览插件的类型定义与 definePreviewPlugin 辅助函数
│   └── text-engine/              # 文本预览的纯逻辑（行索引、按行读取、编码判断等）：不依赖任何包，主进程与插件共用
├── plugins/
│   └── builtin/                  # 内置预览插件（单个 workspace 包，M1 创建），每个插件一个子目录
│       └── src/
│           ├── html/             # 浏览器显示：本地 HTML，以及 Chromium 能直接显示的 PDF / 图片（M2 已实现）
│           ├── markdown/         # Markdown：在浏览器视图中由应用自带的查看脚本渲染（M2 已实现）
│           ├── web-page/         # html / markdown 共用的界面（状态行、加载失败、外部打开；M2 已实现，不是插件）
│           ├── office/           # Office 文件启动面板（调用本机 Office；M2 已实现）
│           ├── text/             # 文本 / 日志（M1 已实现）
│           ├── image/            # 专用图片 / PDF / 音视频插件：推迟（M2 起 html 插件代为显示）
│           ├── pdf/
│           ├── media/
│           ├── folder/           # 目录视图：详细信息列表（M1-3 已实现；面包屑、「上一级」与刷新按钮 M1-3b 移到应用的地址栏）
│           └── fallback/         # 无法预览时：显示文件信息 + 用系统应用打开（预览窗口内的动作；M1-3 已实现）
├── e2e/                          # Playwright Electron 端到端测试
├── doc/                          # 设计文档（本文档）：最新事实依据
├── devDoc/                       # 开发过程记录（按日期）
├── knowledge/                    # 开发中的 tips、错误与解决方法
├── CLAUDE.md                     # AI 协作约定
├── eslint.config.mjs             # 含模块边界规则
├── pnpm-workspace.yaml
└── tsconfig.base.json            # packages/* 共用；apps/desktop 使用 @electron-toolkit/tsconfig
```

内置插件放在独立于应用的包中：插件只能依赖 `plugin-sdk`、`ui` 与纯逻辑包 `text-engine`，无法直接 import 应用内部代码，这保证了内置插件与将来的第三方插件走完全相同的接口，插件化不会名存实亡。v1.4 起所有内置插件合并为单个 `plugins/builtin` 包（每个插件一个子目录），插件之间、插件与应用之间的隔离由 5.5 节的模块边界规则保证，只需维护一份 package.json / tsconfig。

已实现（M1-3）：`plugins/builtin`（包名 `@pch/plugin-builtin`，与 `plugin-sdk` 相同的形式：`exports` 直接指向源码 `src/index.ts`，不单独构建；依赖 `@pch/plugin-sdk`、`@pch/ui`、`lucide-react`、`@tanstack/react-virtual`（与渲染端同版本），`react` 为 peer）。`src/index.ts` 导出 `builtinPlugins`（注册顺序即同分时的优先顺序：folder、fallback），`src/folder/` 为 folder 插件（`index.ts` 定义、`folder-view.tsx` 懒加载组件、`i18n.ts` 自带三语资源、`model.ts` 排序 / 隐藏项的纯函数（面包屑 M1-3b 移除，逻辑路径在渲染端 `lib/logical-path.ts`）、`format.ts` 大小 / 时间格式化纯函数；「N 前」的格式化随状态行的「基于缓存（N 前）」一起删除），`src/fallback/` 为 fallback 插件（`index.ts` 定义、`fallback-preview.tsx` 懒加载组件、`i18n.ts` 自带三语资源、`format.ts` 大小 / 时间格式化纯函数）。渲染端由 `app/app.tsx` import 插件列表交给 `features/preview`（feature 不直接依赖插件包）；vitest 的 include 增加 `plugins/*/src/**/*.test.ts`。

已实现（M1-3b Task 4）：按类型的图标在 `@pch/ui`（`exports` 增加 `./file-icon`）：`src/lib/file-icon-map.ts` 的纯函数 `iconFor(name, kind, target?)` 按扩展名（小写，取最后一个）返回图标类别（文件夹 / 文件夹链接 / 文件链接 / 失效链接 / 文本 / 日志 / 代码 / JSON / 表格 / 文档 / 演示 / PDF / 图片 / 音频 / 视频 / 压缩包 / 可执行 / 配置 / 兜底），`src/file-icon.tsx` 的 `FileIcon({ name, kind, target, open, className })` 把类别映射到 lucide 图标（失效链接红色）。资源树行、folder 插件目录视图、工作区总览的文件条目使用；分组与条目根保留固定图标。可执行扩展名在 ui 内另列一份（不依赖渲染端）。

已实现（文本预览 Task 1）：`packages/text-engine`（包名 `@pch/text-engine`，与 `shared` 相同的形式：`exports` 直接指向 `src/index.ts`，不单独构建；**不依赖任何包**，不使用 Node / DOM / Electron 专有 API，Node 与浏览器通用、无 I/O）。`src/types.ts` 为公共类型（`EncodingLabel` / `ENCODING_LABELS`（与 `@pch/shared` 各有一份，两包互不依赖）、`NewlineUnit`、`ReadAt`、`LineBlock`），`src/newline.ts` 为换行识别（`unitOf`：UTF-16LE / BE 按 2 字节单元、其余编码按字节找 `0x0A`），`src/line-index.ts` 为增量稀疏行索引 `LineIndex`（对一个字节窗口按顺序 `feed`；行号为 1000 的倍数或行首距上一个检查点超过 1MB 时记录「行号 → 行首偏移」；`finish` 后末尾无换行的部分计为一行，`reopen` 后追加使末行延长），`src/line-reader.ts` 为按行读取 `readLines(index, readAt, start, count, limits)`（从最近的检查点读起；单行保留前 64KB 并列入 `truncated`，截断行之后若有检查点直接跳过去；一次 ≤ 4MB；`readAt` 由调用方注入），`src/chunk-source.ts` 为其内部的按块读取（64KB 起倍增到 1MB）。基准测试 `src/benchmark.test.ts` 只在 `PCH_BENCH=1` 时运行。文本预览 Task 3 起：`src/sniff.ts` 为文本 / 二进制判断 `sniff(head)`（只看开头 8KB：BOM 或无 BOM 的 UTF-16 → text；否则出现 NUL 或除 TAB / LF / CR / ESC / Ctrl-Z 等之外的控制字符超过 5% → binary；空 → empty）；`src/encoding.ts` 为编码判断 `detectEncoding(samples, { preferred })` 与取样范围 `sampleRanges(size)`（不大于 192KB 整份一个样本，否则开头 / 中间 / 末尾各 64KB；中间与末尾样本从其中第一个 LF 之后算起），顺序为 BOM（certain，`src/bom.ts`）→ 无 BOM UTF-16（`src/utf16-guess.ts`：NUL 集中在奇 / 偶位且码点可显示；或按字节编码都解释不通且码点集中在 CJK / 假名区）→ 全 7 位时 ISO-2022-JP 转义序列 / ASCII（归 UTF-8）→ 严格 UTF-8（`src/strict-decode.ts`，容忍样本末尾截断）→ Shift_JIS / EUC-JP / GB18030 / Big5 / windows-1252 中 fatal 解码成功者按常用字区打分（`src/legacy-score.ts`），最高分 < 8 或前两名差 < 4 → `guess`，平局按 `preferred`（未指定时日文编码在前），没有正分 → UTF-8 `guess`；`src/decode.ts` 为按行解码 `decodeBlock(block, label, { skipBytesAtStart, maxChars })`（`TextDecoder` 加 `ignoreBOM: true`，BOM 由调用方跳过；被截断的行丢弃末尾残缺字符；每行默认最多 10000 字符；出现 U+FFFD → `replaced`）。依赖方：主进程 `vfs`（`apps/desktop` 的 devDependencies，随主进程打包）与 `plugins/builtin`。

5.2、5.3 节的目录树是**目标结构**，各目录随对应里程碑创建；M0 已实现的部分在树后注明。

### 5.2 主进程 `apps/desktop/src/main`

```
apps/desktop/src/
├── main/
│   ├── index.ts                      # 入口：只调用 bootstrap()
│   ├── bootstrap/
│   │   ├── bootstrap.ts              # 启动编排（顺序见 6.2）
│   │   ├── container.ts              # 组合根：手动装配所有 service（不引入 DI 框架）
│   │   └── shutdown.ts               # 退出编排：保存会话、关闭连接池、关闭 DB
│   ├── core/
│   │   ├── event-bus.ts              # 主进程内部事件总线（类型化）
│   │   └── events.ts                 # 主进程内部事件的类型登记（AppError 与错误码在 packages/shared）
│   ├── infra/
│   │   ├── db/
│   │   │   ├── client.ts             # node:sqlite 连接、PRAGMA、Kysely、执行迁移
│   │   │   ├── schema.ts             # 表的 TypeScript 类型（Kysely 查询类型来源）
│   │   │   └── migrations/           # TypeScript 迁移（随主进程打包）
│   │   ├── logger.ts
│   │   ├── secret-store.ts           # safeStorage 加解密
│   │   ├── paths.ts                  # userData / cache（index.db）/ logs 路径
│   │   ├── powershell.ts             # runPowerShell(script, env, timeoutMs)：固定脚本、输入只经环境变量（M3 由 launcher 移来，launcher 与 desktop 共用）
│   │   └── i18n.ts                   # 主进程 i18next 实例
│   ├── vfs/
│   │   ├── types.ts                  # FileSystemProvider 接口
│   │   ├── errors.ts                 # Node 文件系统错误 → AppError（FS_*）
│   │   ├── vfs.service.ts            # 一次性调用：按 scheme 路由到 provider；取消与超时（vfs.timeoutSec.*）
│   │   ├── vfs.ipc.ts                # vfs.stat / vfs.list（经扫描进程，不可用时直接枚举）/ vfs.cancel / vfs.interest / vfs.refresh / vfs.offlineShares / vfs.cacheInfo / vfs.clearCache / vfs.sniff
│   │   ├── document/                 # 文本文档（分页模型，7.5 节）：document-service（文档表、owner、LRU 16）/ text-document（单个文档：窗口、编码、刷新）/ document-indexer（后台索引）/ document-window・document-identity・document-encoding・utf8-validator（纯判定）/ document.ipc（doc.*）
│   │   ├── input-path.ts             # 渲染端传入的本地路径 → file URI（去引号 / 空白、拒绝相对路径）
│   │   ├── local-path.ts             # file URI → 本地路径（系统操作 IPC 使用）
│   │   ├── path-name.ts              # 显示名称（驱动器根 `C:`、UNC 共享根 `\\server\share`）
│   │   ├── location.ts               # 位置类型 local / network（UNC、GetDriveTypeW 的 DRIVE_REMOTE）与并发分组键 shareKey / hostKey
│   │   ├── fs-list.ts                # node:fs 列目录（readdir + 16 并发 lstat + 链接目标）：LocalProvider 与扫描进程的 fs 回退共用
│   │   ├── scanner-client.ts         # ScannerClient：与扫描进程收发消息（按 id 对应结果）、意外退出时重启、超过上限进入降级
│   │   ├── scanner-process.ts        # utilityProcess.fork 扫描进程（`?modulePath` 引用入口，UV_THREADPOOL_SIZE=16）
│   │   ├── providers/
│   │   │   ├── local.provider.ts
│   │   │   ├── smb.provider.ts       # 放弃（需求方 2026-11-22）
│   │   │   ├── ftp.provider.ts       # 路线图「后续」
│   │   │   └── sftp.provider.ts      # M4 已实现：只读 stat / list（7.6 节）
│   │   ├── sftp-errors.ts            # M4：SFTP 状态码 / ssh2 错误 → AppError
│   │   ├── remote-access.ts          # 访问范围（M1-K17）：sftp: 须在远程 folder 条目之下（M4）；UNC 须在 folder 条目或 file 条目所在目录之下（M5）
│   │   ├── remote-op.ts              # M4：扫描进程的 remoteOp 经 SftpProvider 执行（含访问范围检查）
│   │   ├── remote-cache.ts           # 远程文件本地缓存（LRU；路线图「后续」，7.4 节）
│   │   └── pcfs-protocol.ts          # pcfs:// 协议处理
│   ├── modules/                      # 按业务领域划分，每个模块结构一致
│   │   ├── workspace/
│   │   │   ├── workspace.repo.ts     # 只做数据存取
│   │   │   ├── entry.repo.ts         # 条目的数据存取
│   │   │   ├── workspace.service.ts  # 业务规则
│   │   │   └── workspace.ipc.ts      # IPC handler：参数已校验，只转发给 service
│   │   ├── connection/               # M4 已实现（7.6 节）：connection.repo / service / ipc、connection-pool（连接池）、identity-sessions（切换身份的会话与记忆）、sudo-switch（sudo 状态机与轮询命令）、server-probe（sftp-server 位置与进程表可见性）、ssh-session（ssh2 Client 封装、一次只交一次密码）、sftp-bridge（借用 ssh2 内部 SFTP 类）、sftp-session、host-key-gate（主机密钥确认）、credentials（凭据比较）、offline-refresh（断线时刷新条目根）、secret-box（safeStorage）、testing/（假 SFTP 服务器、测试密钥）
│   │   ├── layout/                   # 窗口与标签（持有布局状态；原 M3，已移到路线图「后续」）
│   │   ├── session/                  # 会话快照保存与恢复（原 M3，已移到「后续」，11.3 节）
│   │   ├── desktop/                  # 桌面记录（M3 已实现，11.4 节）：window-list（koffi 枚举）、logon（登录时刻）、collectors/（explorer・office・vscode・eclipse 与固定 PowerShell 脚本 scripts.ts）、monitor（扫描与采集编排）、live-state（当前现场与延迟移除）、restore-candidate、snapshot.repo、restore（白名单与启动）、exit-guard（退出询问状态机）、desktop.service、desktop.ipc、fake（仅 e2e）
│   │   ├── settings/
│   │   ├── plugin/                   # 插件发现与元数据（外部插件阶段启用）
│   │   ├── launcher/                 # 外部应用联动：Office 只读/编辑/新建打开、远程编辑会话
│   │   ├── web/                      # 浏览器视图（M2 已实现）：WebContentsView 管理、pch-web / pch-asset 协议、范围表、导航判定、快捷键、IPC（7.3、15 节）
│   │   ├── system/                   # 应用信息、渲染端日志写入、在资源管理器显示、剪贴板、选择路径对话框
│   │   └── window/                   # 自绘窗口按钮：最小化 / 最大化 / 关闭发起调用的窗口
│   ├── windows/
│   │   ├── window-factory.ts         # 统一的 BrowserWindow 创建（安全选项集中在此）
│   │   ├── window.service.ts         # 窗口管理与事件广播（M3 起提供主窗口的 close / query-session-end / session-end 钩子；多窗口时由 LayoutService 驱动，已移到「后续」）
│   │   ├── app-protocol.ts           # app:// 协议：提供渲染端静态文件（CSP 由 index.html meta 声明）
│   │   └── security.ts               # 导航拦截、新窗口拦截、权限请求拦截
│   ├── menu/                         # 托盘等（M5；无边框窗口不使用原生应用菜单）
│   └── ipc/
│       ├── router.ts                 # 单通道路由：来源校验 → 通道校验 → 输入校验 → 分发
│       └── handlers.ts               # 汇总各模块 handler
├── scanner/                          # 扫描进程（utilityProcess；不得 import electron，只能使用 vfs 中不依赖 electron 的文件）
│   ├── main.ts                       # 进程入口：process.parentPort 收发消息；createScannerHost 组装 Enumerator + Cache + Scheduler
│   ├── enum/
│   │   ├── types.ts                  # RawEntry、Enumerator 接口
│   │   ├── composite-enumerator.ts   # M4：按 scheme 分派（file: → 本地枚举器，sftp: → 远程枚举器）
│   │   ├── remote-enumerator.ts      # M4：经 remoteOp 请主进程代读远程目录
│   │   ├── win32-enumerator.ts       # koffi：只读句柄的目录枚举、GetFileAttributesExW 取目录修改时间、Win32 错误码分类
│   │   ├── fs-enumerator.ts          # 回退：fs-list（隐藏按 . 开头）
│   │   └── create-enumerator.ts      # koffi 可用则用 win32 版，否则回退并记日志
│   ├── cache/                        # index.db（node:sqlite，可随时删除重建）
│   └── schedule/                     # scope（范围计算）、scheduler（优先级、并发、退避）、background-queue（后台队列的候选）、backoff
└── preload/
    └── index.ts                      # 暴露 window.pch
```

`scanner/` 的进程结构见 `devDoc/2026-11-19-01-refresh-cache-design.md` 4.1 节。scanner 与 vfs 的依赖由 lint 约束：scanner 只允许 import `shared` 与 vfs 中登记为 `vfs-portable` 的文件（`local-path`、`errors`、`location`、`path-name`、`fs-list`），这些文件与 scanner 一起禁止 import `electron`；反方向 `main-vfs` 只能以 `../../scanner/main?modulePath` 引用扫描进程入口（electron-vite 把入口单独打包，得到的只是文件路径，主进程不加载扫描进程的代码）。

主进程与扫描进程的消息定义在 `packages/shared/src/scanner/protocol.ts`（zod，两端收到后都校验，无效消息记日志并忽略）：主 → 扫描 `init { cacheFile }`（fork 后第一条）、`configure { config: ScannerConfig }`、`list { id, uri }`、`interest { ownerId, focus, visible, offscreen }`、`windowFocus`、`releaseOwner`、`refresh { uris }`、`cacheInfo { id }`、`clearCache { id }`、`search { id, scopes, terms, kind, showHidden, limit }`、`cancel { id }`（保留；搜索是同步 SQL 无法中途打断，主进程客户端以「丢弃旧结果」实现取消，不发送本消息）、`shutdown`；扫描 → 主 `result { id, ok, value | error }`、`changed { uri }`、`reachability { share, state, since }`、`log { level, message }`（扫描进程的调度器与枚举器日志经此写入 `main.log`，前缀 `[scanner]`）、`ready`。远程目录（M4，D1）方向相反：扫描 → 主 `remoteOp { id, op: 'stat' | 'list', uri, userAction }`（id 由扫描进程分配，与上面的请求 id 是独立的编号空间）、`remoteCancel { id }`（扫描进程已不需要结果：中止 / 超时），主 → 扫描 `remoteResult { id, ok, value | error }`（value 由扫描进程按 op 校验：`RemoteStatValue` / `RemoteListValue`）。`ScannerConfig = { roots, allRootUris, indexTargets, settings }`；`Interest`、`ReachabilityEvent` 在 `shared/scanner/types.ts`。

扫描进程的生命周期：组合根创建 `ScannerClient` 并 `start()`（`utilityProcess.fork`，`serviceName: 'pch-scanner'`，`stdio: 'pipe'`，stdout / stderr 转写到日志；环境变量 `UV_THREADPOOL_SIZE=16`，扫描进程把同一值作为调度器的 `threadPoolSize`）；退出时 `dispose()` 发送 `shutdown`（扫描进程释放调度器、关闭 `index.db` 后退出；任一步抛错时仍执行后面的步骤并 `exit(0)`），2 秒内不退出则 `kill()`。意外退出：进行中的请求以 `INDEX_UNAVAILABLE` 拒绝并立即重启，重启后重发 `init`、最后一次 `configure` 与各窗口最后的焦点 / 关注点；5 分钟内意外退出 3 次则不再重启，`available` 变为 `false`（降级模式：`vfs.list` 由 `VfsService` 直接枚举、不缓存）。进程退出（将重启）或进入降级模式时，客户端对它记录的每个断开的共享（随 `reachability` 消息维护）发出 `online` 并清空——断开由该进程的探测判定，新进程若仍连不上会重新发出 `offline`，降级模式直接枚举；`ScannerClient.offlineShares()` 返回当前集合（IPC `vfs.offlineShares`）。请求另有兜底超时：60 秒没有结果即以 `FS_TIMEOUT` 拒绝（防扫描进程的事件循环卡住、结果丢失；不用 `INDEX_UNAVAILABLE`，因为扫描进程可能仍在同一共享上枚举，`vfs.list` 回退直接枚举会并发第二次访问）；结果消息校验失败但能读出 `id` 时同样以 `INDEX_UNAVAILABLE` 拒绝对应的请求。`index.db` 打不开（例如 `file is not a database`）时删除 `index.db`、`-wal`、`-shm` 重建一次，仍失败则记错误日志、所有请求以 `INDEX_UNAVAILABLE` 回应（进程不退出，避免反复重启）。

已实现（M0、M1-1、M1-2）：`bootstrap/`、`core/`、`infra/`（db、logger、paths、i18n）、`ipc/`、`modules/`（settings、system、window、workspace）、`vfs/`（types、errors、input-path、local-path、path-name、location、fs-list、vfs.service、vfs.ipc、providers/local.provider）、`windows/`、`preload/`；`scanner/main.ts` 与 `vfs/scanner-client.ts`、`vfs/scanner-process.ts`（扫描进程随应用启动；渲染端的目录请求经由它，见 7.1、8.3 节；`vfs/scanner-config.ts` 的 `buildScannerConfig` 在启动、`workspace.changed`（含切换工作区）与 `cache.*` / `vfs.*` 设置变化时下发配置）；`scanner/enum/`（目录枚举器，已有单元测试；`scanner/cache/`：缓存库 `index.db`（`Cache` 类，node:sqlite，`dirs` / `entries` / FTS5 trigram `entries_fts`；子目录 URI 与 LocalProvider 同法生成，驱动器根 URI 以 `/` 结尾，「在根之下」由纯函数 `isUnder` 判断且大小写敏感；`user_version` 不符则删表重建；队列查询 `nextUnlisted` / `oldestChecked(scopes: Scope[], limit, exclude?)`：`Scope = {uri, maxDepth}`；「从未尝试读取」= `checked_at IS NULL`（`nextUnlisted`，深度浅的优先、同深度按 uri），尝试过的（含读取失败的：`applyListing` / `markChecked` / `setState` 都写 `checked_at`）进入 `oldestChecked`（按 `checked_at` 升序）；范围走 `subtreeCondition`，层数用生成列 `dirs.depth`（URI 中 `/` 的个数，驱动器根末尾的 `/` 不计）；多范围合并去重、limit 为合并后总数；范围小（< 2000 个目录）走主键范围 + 排序，范围大用 `INDEXED BY` 按部分索引 `dirs_unlisted (depth, uri)` / `dirs_checked (checked_at, uri, depth)` 的顺序扫描 + LIMIT（30 万行合成数据、整卷且层数不限：内存库 / 文件库约 0.2–0.3ms；层数上限很小（`maxDepth` 1）时 `oldestChecked` 要沿 `checked_at` 顺序扫很多行，内存库约 15ms、文件库约 25–45ms，由后台队列的批量候选平摊，见 8.3 节）；`CACHE_VERSION` = 6（M4 在 `entries` 加列 `owner`）；热点 `hot(k)` 走覆盖部分索引 `dirs_hot (visit_score, visited_at, uri) WHERE visit_score > 0`，不扫描整张表（30 万行合成数据、其中 30 个访问过：约 6.8ms → 0.04ms）；`removeMissing(uri)`：目录不存在时删除它与子树，并从父目录的缓存列表中删除该项（同名的是符号链接时保留），删除了该项时把父目录的 `dir_mtime` 置为 NULL（这是推断，父目录下一次确认必须完整读取），一个事务）；`scanner/schedule/scope.ts`（范围计算纯函数 `computeScope`，设计 8.2：输出定期确认的对象 `periodic: {uri, tier: 'focus'|'near'|'far', full}[]`（关注点 / 近 / 远，同一 URI 取更近的层，只有关注点 `full`；近层、远层各至多 `TIER_LIMIT` = 100 个：按目录树上离关注点的距离取，同等距离时热点优先、再按 URI，近层中视口内可见的已展开目录最优先）与后台队列的范围 `background: {indexTargets: Scope[], hot: string[], ranges: Scope[]}`；目录的策略取包含它的根中最高者，「消极」只有关注点一层；`RootConfig` / `CacheStrategy`（`CACHE_STRATEGIES`）在 `shared/scanner/types.ts`）；`scanner/schedule/background-queue.ts`（后台队列的候选 `BackgroundQueue`：按位置组分别从缓存批量取候选、在内存中逐个消费，见 8.3 节）；`scanner/schedule/scheduler.ts`（调度器 `Scheduler`：P0 用户动作 / 定期确认按层与位置的间隔 / 后台队列每个位置组同时 1 个、完成后休息 `backgroundGapMs`（用户正在操作时加倍），各窗口的范围分别计算后合并、全部失焦时定期确认暂停（后台队列照常）；缓存不设过期（没有「超过 1 小时强制完整读取」）；并发：每个位置组（本地卷 / 网络主机）「定期确认 / 后台队列 / 探测」共用 1 个 + P0 1 个，本地合计最多 4 个，总数不超过 libuv 线程池，本地合计、网络合计、单个组都不占用最后一个线程（被中止但未返回的原生调用继续占名额）；排队的 P0 调用方等待超过 `timeoutSec` 以 `FS_TIMEOUT` 拒绝；调度循环的异常记日志（构造参数 `log`）并在 1 秒后重试；看门狗按「没有进展的时间」计时；探测超时 / `FS_UNAVAILABLE` 使共享断开并按 `backoff.ts` 退避（30 秒起翻倍，最长 5 分钟）——`FS_UNAVAILABLE` 只来自确定的网络 / 设备类错误（win32 枚举器的 `UNAVAILABLE_ERRORS`：15、21、51、53、55、59、64、67、121、1167、1201、1222、1225、1231、1232、1236、1256、2250），因此枚举中途（已有批次）收到时同样判为断开；其他错误码为 `UNKNOWN`，只把该目录记为 `unreachable`（出错的目录在定期确认中按远层的间隔重试，在后台队列中以失败时刻为确认时刻排到后面）；`listNow` 在 2 秒内检查过（任何优先级）时直接返回 `fresh`、不再排 P0（确认时刻在「未来」即系统时钟回拨后，不算 fresh；P0 去重同理，差为负不算重复）；读取得到「不是目录」（`FS_NOT_A_DIRECTORY`，目录被同名文件替换）时删除该目录自身的子树缓存、该行保留为 `unreachable` / `FS_NOT_A_DIRECTORY`（带确认时刻），并对父目录排一次确认（P0，不与刚完成 / 正在执行的 P0 合并），由确认更正该项的类型，不从父目录的缓存列表中删除它；该目录已是此状态时再次出错不再强制父目录（父目录仍列为目录的情形，避免循环），按远层间隔重试（「不存在」才连同父目录列表中的该项一起删除）；读取得到「不存在」（`FS_NOT_FOUND`）时 `removeMissing`，并同样对父目录排一次确认（P0，`force`），由真实列表决定父目录的内容（上级目录改名期间读取、随即改回时，父目录的修改时间不变，只靠推断删除会永远缺少该项）；该目录行保留为 `not-found` / `FS_NOT_FOUND`（带确认时刻，父目录的确认不再列出它时删除这一行），已是此状态时再次出错（父目录仍列出它）不再强制父目录、不再从父目录列表中删除，按远层间隔重试；父目录的确认再次列出一个 `not-found` 子目录时把它的 `checked_at` 置 NULL（状态保持 `not-found`），使它作为「从未尝试过」尽快被重读（上级目录改走又改回后即可恢复，防循环的判断看的是状态，不受影响）；根没有父目录，只删除缓存并通知根；`ScanSettings` 在 `shared/scanner/types.ts`，`listNow` 的返回类型 `DirectoryListing` 在 `shared/vfs/types.ts`）；`scanner/search/search.ts`（文件名搜索后端，Task 11：只读缓存、绝不访问文件系统；`parseQuery` / `matchesName` 在 `packages/shared/src/search/query.ts`，扫描进程与主进程共用；3 字符以上的包含词走 `entries_fts MATCH`，短词与通配词用 `LIKE ... ESCAPE` / `lower() GLOB`；范围用 URI 前缀的范围比较（`scanner/cache/cache.ts` 的 `subtreeCondition`，缓存的子树删除也用它，都走主键索引）；IPC `search.query` 由 `main/ipc/search.ipc.ts` 组装 scopes 并合并固定的单个文件条目，`ScannerClient.search` 以同一 requestId 的新查询 / `vfs.cancel` 丢弃旧结果；见 `devDoc/2026-11-19-07-search.md`）；`packages/shared/src/vfs/normalize-uri.ts`（`normalizeRootUri` / `isUnderUri`，主进程、扫描进程与渲染端共用，缓存的 `isUnder` 即它）；`vfs/location.ts` 由 scanner 与主进程（组合根的超时、扫描配置）共用，主进程启动时按 `driveTypeStatus()` 记一条日志：`[vfs] drive type detection: native (koffi)`，koffi 不可用时为警告（映射的网络盘按本地处理）。M1-2 在 `vfs/` 中加入的目录监听（`fs.watch`）已于 2026-11-19 删除（7.1 节），在 `modules/system` 中加入 `system.revealInOs` / `copyText` / `selectPaths`（均不修改文件；`system.openPath` 于 2026-11-19 删除，M1-3 恢复为只由预览插件的宿主经用户点击调用：先经 `VfsService.stat` 确认存在（带超时与错误码映射），再 `shell.openPath`，失败时以 `UNKNOWN` 拒绝、detail 为系统返回的描述）。主进程至今**没有任何写文件、移动、删除文件的 API**。

已实现（M4 SFTP 只读，2026-11-23）：`modules/connection/`、`vfs/providers/sftp.provider.ts`、`vfs/sftp-errors.ts`、`vfs/remote-access.ts`、`vfs/remote-op.ts`、`scanner/enum/{composite,remote}-enumerator.ts`（见上面的目录树与 7.6 节）；`vfs/location.ts` 增加位置 `remote`（`shareKey` / `hostKey` = `sftp://<connectionId>`）。`vfs/` 中的 `connection-pool.ts`、`remote-cache.ts` 与 SMB / FTP provider 未实现（连接池在 `modules/connection`，经 `SftpSessionSource` 接口注入 provider：`main-vfs` 不 import `main-module`）。

已实现（M3 桌面记录，2026-11-22）：`modules/desktop/`（各文件见上面的目录树，设计与行为见 11.4 节）与 `infra/powershell.ts`（M2 的 `modules/launcher/powershell.ts` 原样移来，launcher 改为从 infra 引用）。`modules/desktop` 与其他模块一样只依赖 `main-ipc` / `main-vfs` / `main-infra` / `main-core` / `shared`（`modules/*` 通配登记，不 import `modules/launcher`：PowerShell 执行在 infra、存在性检查经注入的 `VfsService`）；组合根 `createDesktop()` 按平台与假模式装配依赖。

模块内的分层约定：`*.ipc.ts → *.service.ts → *.repo.ts / vfs / infra`。service 之间可以相互调用，但必须通过构造函数注入，禁止模块间直接 import 对方的 repo。

### 5.3 渲染进程 `apps/desktop/src/renderer`

```
apps/desktop/src/renderer/
├── index.html                        # CSP（meta）、首帧主题脚本、挂载点
├── public/theme-init.js              # 首帧前应用主题（外部脚本，CSP 不需要允许内联）
└── src/
    ├── main.tsx                      # 入口：错误边界 + Providers + App
    ├── app/                          # 根组件、最外层错误边界（不写业务）
    ├── features/                     # 按功能切片，每个切片通过 index.ts 暴露公开 API
    │   ├── shell/                    # 标题栏、活动栏、状态栏、整体布局、唯一的快捷键分发（M5）
    │   ├── command-palette/          # 命令面板与最近使用的记录（M5）
    │   ├── address-bar/              # 应用级地址栏（后退 / 前进 / 上一级 / 刷新 + 逻辑路径，M1-3b）
    │   ├── workspace/                # 工作区切换、创建、编辑
    │   ├── explorer/                 # 资源树（条目 + 真实目录）
    │   ├── tabs/                     # 标签栏、拖拽、弹出
    │   ├── preview/                  # 插件注册表、PreviewHost 实现、PreviewContainer
    │   ├── connections/              # 远程连接管理
    │   ├── desktop/                  # 桌面记录（M3）：活动栏视图、快照页、卡片式清单、恢复 / 退出对话框
    │   ├── settings/                 # 设置页（内置页面 pch-settings:，M5）
    │   └── about/                    # 关于页（内置页面 pch-about:，M5）
    ├── data/                         # 跨功能的主进程数据查询（TanStack Query hooks，如 settings、window）
    ├── lib/                          # ipc.ts、query-client.ts、query-keys.ts、report-error.ts
    ├── providers/                    # QueryProvider、I18nProvider、ThemeProvider
    ├── stores/                       # 跨功能的 zustand store（布局镜像、UI）
    └── styles/globals.css            # 引入 packages/ui 的主题变量
```

已实现：
- M0：`app/`、`features/shell/`、`data/`（settings、window）、`lib/`、`providers/`、`stores/`、`styles/`。
- M1-2：`features/explorer/`（资源树，8.2 节）、`features/workspace/`（标题栏的工作区切换器与新建 / 重命名 / 删除对话框）；`data/` 增加 `workspace.ts`、`entries.ts`、`vfs.ts`（工作区、条目、目录列表与关注点 `vfs.interest` 的 hooks；监听的 hooks 已于 2026-11-19 删除）；`lib/` 增加 `file-uri.ts`（file URI → Windows 路径，用于「复制路径」；URI 规范化 `normalizeRootUri` 与 `isUnderUri` 在 `packages/shared/src/vfs/normalize-uri.ts`，主进程、扫描进程、渲染端共用）；`stores/ui-store.ts` 增加「新建工作区」对话框的开关（标题栏切换器与欢迎页共用）。
- 文件名搜索（2026-11-19，8.4 节）：`features/search/`（搜索视图 `search-view.tsx`、结果列表 `search-results.tsx`、按工作区保存输入与类型筛选的 `search-store.ts`、格式化纯函数 `format.ts`）；`data/search.ts`（`search.query` 的查询与取消）；`stores/navigation-store.ts`（跨 feature 的「在树中定位」请求：搜索视图发出、资源树处理）；`features/explorer/reveal.ts`（URI → 所属条目与节点 id、定位进展，纯函数）与 `use-reveal.ts`；`stores/ui-store.ts` 的 `SidebarView` 增加 `search`，并增加 `showView`（显示视图而不折叠）与 `searchFocusRequest`（`Ctrl+Shift+F` 聚焦搜索框）。
- 扫描引擎（2026-11-19）：`features/explorer/interest.ts`（树 → 关注点与视口内外的已展开目录，纯函数）；`stores/reachability-store.ts`（断开的共享 / 卷，由 `features/shell/use-reachability-events.ts` 写入：先订阅 `vfs.reachability`，再以 `vfs.offlineShares` 初始化（查询返回前已收到事件的共享以事件为准），窗口启动 / 重新加载前已断开的共享也能显示——按分层规则 store 只能由 feature 写入，外壳在窗口存在期间一直挂载）。
- M1-3 标签与预览（✅ 2026-11-19 完成，11 节「已实现」）；`plugins/builtin`（folder / fallback 插件，9.4 节「已实现」）：`features/tabs/`（标签栏 `tab-bar.tsx`、标签区 `tabs-area.tsx`：标签栏 + 内容区，`Ctrl+W`）；`stores/tabs-store.ts`（按工作区保存标签集合，包装 `packages/shared/src/layout/` 的 `layoutReducer`；lint 放行 `stores → shared`）；`features/explorer/open-target.ts`（节点 → 打开目标，纯函数）。`features/preview/`（9.3 节「已实现」）：`registry.ts`（`scoreResource` / `pickPlugin` / `fallbackOf`，纯函数）、`executable.ts`（`isExecutableExtension`）、`host.ts`（`createPreviewHost(deps)`：PreviewHost 的实现，依赖注入便于单元测试）、`preview-container.tsx`、`plugin-error-boundary.tsx`、`confirm-executable-dialog.tsx`、`plugins.ts`（`previewPlugins(builtin)`：e2e 时追加测试插件）；`data/vfs.ts` 增加 `useResourceStat`（预览标签的 stat，`staleTime` 0）与 `fetchDirectory`（与资源树共用目录查询的缓存）；`vfs.interest` 的发送改为本窗口唯一的合并器 `createInterestHub`（资源树的 `useVfsInterest` 与标签区的 `useVfsTabsInterest` 各管一部分，合并后经同一个 300ms 防抖发送；一个来源卸载只清空自己的部分）；`stores/tabs-store.ts` 增加 `selectActiveDirectory`（激活标签显示目录时为其 URI），标签区据此发送 `tabs`；`lib/query-keys.ts` 增加 `stat` / `statRoot`，`vfs.changed` 同时让该目录自身与其直接子项的 stat 失效。
- M1-3b 导航：`lib/logical-path.ts`（逻辑路径）、`features/preview/workspace-overview.tsx`（工作区总览）；`features/address-bar/`（应用级地址栏 `address-bar.tsx`、全局快捷键 `use-navigation-shortcuts.ts`、按键 / 侧键 → 命令的纯函数 `commands.ts`，12.2 节）；`stores/tabs-store.ts` 增加 `selectActiveTab`、刷新请求 `refreshSeq` / `requestRefresh` 与订阅函数 `onTabRefresh`（地址栏发出，标签内容订阅）。
- M2 反馈第 6–8 项（2026-11-21）：`features/workspace/workspaces-page.tsx`（工作区一览，11.1 节「已实现」）；`features/address-bar/address-bar.tsx` 的地址框与前置的工作区按钮（12.2 节）；`stores/tabs-store.ts` 增加 `backFrom`
- M3 桌面记录（2026-11-22，11.4 节）：`features/desktop/`（侧栏视图 `desktop-view.tsx`、快照页 `snapshot-page.tsx`（「現在」与各快照）、卡片式清单 `item-checklist.tsx`（快照页与两个对话框共用）、恢复对话框 `restore-dialog.tsx`、退出对话框 `exit-dialog.tsx`、两者的组合 `desktop-prompts.tsx` 与 `use-desktop-dialogs.ts`、改名 / 删除对话框、显示名与标签文字的纯函数 `item-label.ts` / `snapshot-label.ts`）；`data/desktop.ts`（`desktop.*` 的查询与操作，`lib/query-client.ts` 把 `desktop.changed` 桥接为查询失效）；`stores/ui-store.ts` 的 `SidebarView` 增加 `desktop`（活动栏「搜索」之后，lucide `MonitorIcon`）；`features/preview/preview-container.tsx` 对 `kind: 'desktop'` 渲染快照页（应用内置视图，不是插件）。
- M5 完善与发布（2026-11-23，12.2、14 节）：`features/settings/`（`settings-page.tsx`、分区定义 `sections.ts`（9 个分区；隐藏键 `session.restoreOnStartup` / `window.onDetachedClose` / `launcher.autoUploadRemoteEdits` / `remote.cacheSizeMB` / `workspace.pickerView`）、按 zod schema 取控件类型与 min / max 的 `validate.ts`、`setting-row.tsx`、缓存占用 / 文件关联 / 隐私的 `blocks.tsx`、`use-open-builtin.ts`、`use-settings-commands.ts`）；`features/about/about-page.tsx`；`features/command-palette/`（`command-palette.tsx`、分组纯函数 `use-palette-items.ts`、IME 守卫 `palette-keys.ts`、最近使用的记录 `recent-recorder.tsx` / `recent-recording.ts`）；`features/workspace/picker/`（圆环布局纯函数 `ring-layout.ts`、`pickerReducer` 与按键映射 `use-picker-state.ts`、`ring-view.tsx` / `list-view.tsx` / `picker-card.tsx` / `picker-edit-card.tsx` / `picker-chrome.tsx` / `use-picker-edit.ts` / `workspace-picker.tsx`），以及 `workspace-menu.tsx`（菜单式，合并原两份菜单）、`workspace-filter.ts`、`use-filter-input.ts`、`color-swatches.tsx` / `color-dot.tsx` / `workspace-color.ts`、`workspace-time.ts`、`use-workspace-commands.ts`；`features/shell/use-command-shortcuts.ts`（取代 `use-shell-shortcuts.ts`）、`use-shell-commands.ts`、`use-appearance-commands.ts`；`features/explorer/use-explorer-commands.ts`；`stores/command-store.ts`（命令注册表）；`lib/shortcut.ts`、`lib/key-context.ts`、`lib/text-match.ts`（选择器与命令面板共用的筛选）、`lib/focus-return.ts`（浮层关闭后把焦点还给网页视图或原元素）、`lib/recent-policy.ts`（re-export `packages/shared/src/recent/policy.ts`）；`data/recent.ts`；`stores/ui-store.ts` 增加 `paletteOpen`、`pickerOpen`、`deleteWorkspaceTarget`；`stores/tabs-store.ts` 的 `open` / `openHere` / `navigate` 增加 `opts.source` 与 `recentSignal`。`features/shell/coming-soon.ts` 仍被欢迎页「打开文件夹」使用（R3，保留）。

切片规则：`app → features → (providers, data, stores, lib, @pch/ui, @pch/shared)`；`providers → data → lib`；feature 之间不得互相 import（需要共享的数据放 `data/`，共享的 UI 放 `packages/ui`，跨 feature 的纯 UI 状态放 `stores/`）。`app/` 不直接依赖 `data/`（lint 强制），需要数据的组件放在 feature 中。

外壳插槽（已实现）：`Shell` 的 props 为 `{ sidebarViews: Record<SidebarView, ReactNode>; workspaceSwitcher: ReactNode; addressBar: ReactNode; tabsArea: ReactNode }`，`app/app.tsx` 把 `ExplorerView`、`WorkspaceSwitcher`、`AddressBar`（M1-3b，标题栏正下方的一行）、`TabsArea` 等组合进去；标签内容同样经插槽组合：`TabsArea` 的 `renderContent(tab)` 由 `app/` 传入 `<PreviewContainer tab plugins renderWorkspaces />`（features/tabs 与 features/preview 互不 import；`renderWorkspaces(tab)` 返回 features/workspace 的 `WorkspacesPage`——工作区一览要用工作区的对话框，放在 features/workspace，由 `app/` 交给 PreviewContainer，M2 反馈第 8 项）；外壳读 `stores/tabs-store.ts`，当前工作区有标签时显示 `tabsArea`，否则显示欢迎页。侧栏 `SideBar` 只提供外框，标题行由各视图自己渲染（资源管理器的标题行带刷新按钮）；新增侧栏视图需要自带标题行。

### 5.4 命名与编码约定

文件名一律 kebab-case；主进程以后缀区分职责（`.service.ts`、`.repo.ts`、`.ipc.ts`、`.provider.ts`）；除插件组件外不使用 default export；包名统一 `@pch/*`；提交信息遵循 Conventional Commits；格式由 Prettier 统一（electron-vite 模板约定：单引号、无分号、行宽 100）。

### 5.5 模块边界的强制执行

5.2、5.3 节的分层规则由 `eslint-plugin-boundaries` 在 lint 时强制：每一层（以及每个主进程模块、每个渲染端 feature、每个插件）是一个元素，依赖方向默认禁止、按白名单放行；新增文件必须归入已登记的元素。典型约束：主进程模块之间不得互相 import（经构造函数注入）；preload 只能依赖 `@pch/shared`；渲染端 feature 之间不得互相 import；插件只能依赖 `plugin-sdk`、`ui` 与纯逻辑包 `text-engine`；`text-engine` 只被主进程 `vfs` 与插件引用，自身不依赖任何包——boundaries 管不到第三方包与 Node 内置模块，因此对 `packages/text-engine/src`（测试除外）另以 `no-restricted-imports`（只允许相对路径）与 `no-restricted-globals`（`process`、`Buffer`、`window`、`document` 等）限制。内置插件包中每个子目录（`plugins/builtin/src/*`）是一个 `plugin` 元素，子目录之间不得互相 import；包入口 `src/index.ts` 归为文件类别 `plugin-entry`（只能依赖各插件与 `plugin-sdk`），只有 `app/` 可以 import 它（M1-3 已用临时文件验证：插件 import `@pch/shared` / 另一插件子目录、feature import 插件包均被拒绝）。

---

## 6. 主进程设计

### 6.1 组合根（不引入 DI 框架）

```ts
// apps/desktop/src/main/bootstrap/container.ts（目标形态；已装配 paths、logger、db、bus、settings、workspaces、vfs、i18n、windows）
export async function createContainer(rendererUrl: string): Promise<Container> {
  const paths = createPaths();
  const logger = createLogger(paths);
  const db = await openDatabase(paths.database, logger);    // 内部执行迁移
  const secrets = new SecretStore();
  const bus = new EventBus<MainEvents>();

  const settings = await SettingsService.create(new SettingsRepo(db), bus);
  const connections = new ConnectionService(new ConnectionRepo(db), secrets, bus);
  const cache = new RemoteCache(paths.remoteCache, settings);
  const vfs = new VfsService([
    new LocalProvider(),
    new SmbProvider(connections),
    new FtpProvider(new ConnectionPool(connections, 'ftp')),
    new SftpProvider(new ConnectionPool(connections, 'sftp')),
  ], cache, bus);
  const workspaces = new WorkspaceService(new WorkspaceRepo(db), vfs, bus);
  const layout = new LayoutService(bus);
  const windows = new WindowService(paths, settings, rendererUrl, layout);
  const sessions = new SessionService(new SessionRepo(db), layout, windows, bus);

  return { paths, logger, db, settings, connections, vfs, workspaces, layout, windows, sessions, bus };
}
// Container 以接口显式声明（不从返回值推断），各字段类型一目了然
```

所有依赖关系在这一个文件里一目了然，测试时可以替换任意依赖。

已实现（M3）：组合根另装配 `desktop`（`DesktopService`）与 `exitGuard`（`ExitGuard`），由 `createDesktop()` 按平台与 e2e 假模式（`PCH_E2E_FAKE_DESKTOP=1`，只在未打包时读取）选择窗口枚举、采集器与恢复的依赖；窗口枚举不可用（非 Windows、koffi 加载失败）时 `monitor` 为 null、不监控，IPC 照常返回空结果。上面代码中的 `layout` / `sessions`（原 M3 的多窗口与会话）已移到路线图「后续」，尚未实现。

### 6.2 启动与退出流程

启动：开发环境的独立 userData → 单实例锁 → `protocol.registerSchemesAsPrivileged`（必须在 ready 之前）→ `app.whenReady()` → 创建容器（日志、DB 迁移、设置）→ 应用主题（`nativeTheme.themeSource`）→ 注册 `app://` 协议（M2 起加 `pcfs://`）→ 安全策略 → 注册 IPC → 去掉原生应用菜单（自绘标题栏）→ 联动主进程事件 → 注册退出处理 → 创建主窗口（多窗口与会话恢复时改为 `SessionService.restoreLastWorkspace()`，已移到「后续」）。远程连接全部懒连接，不阻塞启动。M3 起在创建主窗口之前 `desktop.start()`（取登录时刻 → 选出恢复候选 → 开始监控并完整读取一次 → 写本次登录的自动快照，11.4 节），并在主窗口上挂 `close`（交给 `ExitGuard` 决定是否拦截、询问保存）、`query-session-end`（冻结现场并立即写自动快照，不阻止关机）与 `session-end`（停止监控）钩子。

退出：`before-quit` 时先阻止退出，按顺序异步释放资源（目标：先保存会话快照 → 关闭连接池 → 关闭监听器 → 注销 IPC → 关闭数据库）后再真正退出。会话平时也会在变化后防抖保存，即使异常断电，最多丢失约 1 秒的状态（会话快照已移到「后续」）。已实现（M3）：用户关闭主窗口时先经 `ExitGuard`（11.4 节「退出与关机」）询问保存哪些桌面项目，`before-quit` 开始后不再拦截；`shutdown` 中 `desktop.stop()` 后等待桌面记录已排队的写入（`desktop.idle()`）结束，再关闭数据库。

### 6.3 IPC 契约（共享）

```ts
// packages/shared/src/ipc/contract.ts
import { z } from 'zod';

const route = <O>() => <I extends z.ZodType>(input: I) =>
  ({ input, output: undefined as unknown as O });

// 目标形态节选；已实现：app.getInfo、settings.*、workspace.{list,active,create,update,delete,activate}、
// entry.{list,add,update,remove,move,setCacheStrategy}、index.{setTarget,list}、
// vfs.{stat,list,cancel,interest,refresh,offlineShares,cacheInfo,clearCache,sniff}、doc.*（7.5 节）、search.query、system.{revealInOs,openPath,copyText,selectPaths}、
// window.*、log.write、web.{attach,setBounds,hide,release,reload,freeze,unfreeze}（M2 浏览器视图，15 节）、
// connection.{list,save,delete,test,reconnect,trustHostKey,answerHostKey,pendingHostKeyPrompts,home}（M4，7.6 节）、
// desktop.{list,get,current,save,rename,delete,restore,clear,restorePrompt,exit,cancelExit,exitShown}（M3 桌面记录，11.4 节）、
// workspace.{summaries,reorder}、recent.{list,record,clear}、system.openAppFolder（M5）；
// 事件：recent.changed（M5，广播）、settings.changed、workspace.changed、vfs.changed、vfs.reachability、window.stateChanged、doc.progress、doc.changed、
// web.{state,navigate,notice,shortcut}（只发给视图所属的窗口）、desktop.changed（广播）、desktop.{exitRequested,exitCancelled}（只发给主窗口）
// （vfs.watch 已于 2026-11-19 删除；system.openPath 同日删除、M1-3 恢复，只由预览插件的宿主调用；launcher.* 等为将来的预览窗口所用，见 10 节）
export const ipcContract = {
  'workspace.list':      route<Workspace[]>()(z.void()),
  'workspace.create':    route<Workspace>()(WorkspaceCreateInput),
  'workspace.activate':  route<void>()(z.object({ id: z.string() })),
  'workspace.summaries': route<WorkspaceSummary[]>()(z.void()),   // M5：选择器的详细信息 { id, entryCount, topEntries（根级前 4 个）}，全部工作区含已归档，只查 pch.db
  'workspace.reorder':   route<void>()(WorkspaceReorderInput),    // M5：{ ids } 必须恰好是全部未归档工作区的排列，否则 IPC_BAD_INPUT；一次事务、一次 workspace.changed
  'recent.list':         route<RecentItem[]>()(z.strictObject({ workspaceId: z.string().min(1), limit: z.number().int().min(1).max(100) })),  // M5：openedAt 降序
  'recent.record':       route<void>()(z.strictObject({ workspaceId: z.string().min(1), uri: z.string().min(1), kind: z.enum(['file', 'directory']), title: z.string().max(500) })),  // 同 URI 只更新时间；每工作区保留 100 条
  'recent.clear':        route<void>()(z.strictObject({ workspaceId: z.string().min(1).optional() })),  // 省略 = 全部工作区
  'entry.list':          route<WorkspaceEntry[]>()(z.object({ workspaceId: z.string() })),
  'entry.add':           route<WorkspaceEntry>()(EntryAddInput),
  'entry.move':          route<void>()(EntryMoveInput),
  'entry.setCacheStrategy': route<WorkspaceEntry>()(EntrySetCacheStrategyInput),   // 仅 folder，否则 ENTRY_KIND_MISMATCH
  'index.setTarget':     route<void>()(IndexSetTargetInput),   // uri 须位于该工作区某 folder 条目之下，否则 ENTRY_INVALID_PARENT；幂等
  'index.list':          route<string[]>()(z.object({ workspaceId: z.string() })),
  'vfs.list':            route<DirectoryListing>()(z.object({ uri: z.string(), requestId: z.string().optional() })),  // { items, state: fresh|cached|offline, checkedAt }
  'vfs.stat':            route<FileStat>()(z.object({ uri: z.string() })),
  'vfs.sniff':           route<SniffInfo>()(z.object({ uri: z.string() })),   // 开头 8KB → { kind: text | binary | empty }
  'doc.open':            route<DocumentInfo>()(z.object({ uri: z.string(), encoding: DOC_ENCODINGS.optional(), at: z.enum(['start', 'end']).optional() })),
  'doc.readLines':       route<DocLineBlock>()(z.object({ docId: z.string(), start: z.number().int().min(0), count: z.number().int().min(1).max(2000) })),
  'doc.refresh':         route<DocumentInfo>()(z.object({ docId: z.string() })),
  'doc.setEncoding':     route<DocumentInfo>()(z.object({ docId: z.string(), encoding: DOC_ENCODINGS.nullable() })),
  'doc.buildIndex':      route<DocumentInfo>()(z.object({ docId: z.string() })),
  'doc.close':           route<void>()(z.object({ docId: z.string() })),
  'vfs.cancel':          route<void>()(z.object({ requestId: z.string() })),
  'vfs.interest':        route<void>()(z.object({ focus: z.string().nullable(), visible: z.array(z.string()).max(2000), offscreen: z.array(z.string()).max(5000), tabs: z.array(z.string()).max(8) })),  // 整体替换本窗口的关注点
  'vfs.refresh':         route<void>()(z.object({ uris: z.array(z.string()).max(500) })),  // F5 / 重试：P0
  'vfs.offlineShares':   route<OfflineShare[]>()(z.object({})),  // 当前断开的共享 { share, since }[]（渲染端启动时初始化断开状态）
  'vfs.cacheInfo':       route<{ bytes: number }>()(z.object({})),
  'vfs.clearCache':      route<void>()(z.object({})),
  'search.query':        route<SearchResult>()(z.object({ workspaceId: z.string(), text: z.string().max(500), kind: z.enum(['all', 'file', 'directory']), limit: z.number().int().max(1000).optional(), requestId: z.string() })),  // 只查缓存；{ items, total（≤ 10000）, truncated, indexedAt, incomplete }；取消用 vfs.cancel；扫描进程不可用时 INDEX_UNAVAILABLE（8.4 节）
  'layout.dispatch':     route<void>()(LayoutAction),        // 打开/关闭/移动/弹出标签
  'layout.getWindow':    route<WindowView>()(z.object({ windowId: z.string() })),
  'connection.save':     route<ConnectionDto>()(ConnectionSaveInput),
  'connection.test':     route<ConnectionTestResult>()(ConnectionSaveInput),
  'settings.getAll':     route<Settings>()(z.void()),
  'settings.set':        route<void>()(SettingsPatch),
  'launcher.capabilities': route<LaunchCapabilities>()(z.object({ uri: z.string() })),
  'launcher.open':       route<void>()(z.object({ uri: z.string(), mode: LaunchModeSchema })),
  // 桌面记录（M3）：快照只含本机的；id 不存在 → DESKTOP_SNAPSHOT_NOT_FOUND。恢复只传快照 id 与项目 id（15 节第 10 项）
  'desktop.list':        route<DesktopSnapshotSummary[]>()(z.void()),
  'desktop.get':         route<DesktopSnapshot>()(z.strictObject({ id: z.number().int().positive() })),
  'desktop.current':     route<DesktopCurrent>()(z.void()),             // { logonAt, ready, items: { key, item }[], unreadable }；ready = 第一次完整读取已完成；非 Windows 为空
  'desktop.save':        route<number>()(z.strictObject({ keys: z.array(z.string().max(DESKTOP_KEY_MAX)).max(500), name: z.string().max(100).nullable() })),  // 手动快照：现场中 key 在列表里的项目
  'desktop.rename':      route<void>()(z.strictObject({ id: z.number().int().positive(), name: z.string().max(100).nullable() })),
  'desktop.delete':      route<void>()(z.strictObject({ id: z.number().int().positive() })),
  'desktop.restore':     route<DesktopRestoreOutcome>()(z.strictObject({ snapshotId: z.number().int().positive(), itemIds: z.array(z.number().int().positive()).max(500) })),  // { launched, skipped: { itemId, reason: open|missing|unreachable|failed }[], cleared }
  'desktop.restorePrompt': route<DesktopSnapshot | null>()(z.void()),  // 启动时的恢复候选（已滤掉开着的项目），每次启动只返回一次
  'desktop.exit':        route<void>()(z.strictObject({ save: z.boolean(), keys: z.array(z.string().max(DESKTOP_KEY_MAX)).max(500), dontAskAgain: z.boolean() })),  // 回应 desktop.exitRequested
  'desktop.cancelExit':  route<void>()(z.void()),
  'desktop.exitShown':   route<void>()(z.void()),                       // 渲染端已显示退出对话框（之后主进程不再超时）
  'editSession.list':    route<EditSessionDto[]>()(z.void()),
  'editSession.finish':  route<void>()(z.object({ id: z.string() })),
  'editSession.resolve': route<void>()(z.object({ id: z.string(), action: z.enum(['overwrite', 'uploadAsCopy', 'skip']) })),
  'system.openExternal': route<void>()(z.object({ uri: z.string() })),
  'system.revealInOs':   route<void>()(z.object({ uri: z.string() })),
  'system.openAppFolder': route<void>()(z.strictObject({ which: z.enum(['logs', 'userData']) })),  // M5 关于页：主进程按固定路径 shell.openPath，不接受渲染端传路径
  'system.copyText':     route<void>()(z.object({ text: z.string().max(32768) })),
  'system.selectPaths':  route<string[]>()(z.object({ kind: z.enum(['folder', 'file']), multiple: z.boolean() })),  // 取消时为空数组
  'window.minimize':     route<void>()(z.void()),            // 自绘窗口按钮：作用于发起调用的窗口
  'window.toggleMaximize': route<void>()(z.void()),
  'window.close':        route<void>()(z.void()),
  'window.getState':     route<WindowState>()(z.void()),     // { maximized }
  'log.write':           route<void>()(LogWriteInput),          // 渲染端错误写入 main.log
  // 浏览器视图（每个（窗口, 标签）一个 WebContentsView，归属调用方窗口；bounds 为 DIP 整数，宿主取整、不乘 devicePixelRatio）
  'web.attach':          route<void>()(z.object({ tabId: z.string(), uri: z.string(), scopeRoot: z.string(), view: z.enum(['page', 'markdown']), bounds: WebBounds, fragment: z.string().regex(/^[?#]/).optional() })),  // 新建或复用并显示；uri 不在 scopeRoot 之下 → FS_INVALID_URI；fragment 拼到加载地址后（是否重新加载不看它）
  'web.setBounds':       route<void>()(z.object({ tabId: z.string(), bounds: WebBounds })),
  'web.hide':            route<void>()(z.object({ tabId: z.string() })),   // 只隐藏（页面状态保留）；web.release 销毁；web.reload 同形
  'web.freeze':          route<{ image: string; yielded: boolean }>()(z.object({ tabId: z.string() })),  // 截图替身（data:image/png，物理像素）并隐藏；视图持有焦点时交回应用界面（yielded）；web.unfreeze({ tabId, refocus }) 恢复
  // ……
} as const;

export type IpcChannel = keyof typeof ipcContract;
export type IpcInput<C extends IpcChannel>  = z.infer<(typeof ipcContract)[C]['input']>;
export type IpcOutput<C extends IpcChannel> = (typeof ipcContract)[C]['output'];

// 主进程 → 渲染进程的事件（大多为广播；window.stateChanged 只发给状态变化的窗口）
export interface IpcEvents {
  'layout.changed':    WindowView;
  'vfs.changed':       { uri: string };             // 缓存内容有变化的目录（扫描进程）
  'vfs.reachability':  { share: string; state: 'online' | 'offline'; since: number };  // 共享 / 卷断开或恢复
  'settings.changed':  Partial<Settings>;
  'workspace.changed': { id: string };
  'recent.changed':    { workspaceId: string | null };   // M5：最近使用有变化（记录 / 清除）；null = 清除了全部
  'connection.changed': Record<string, never>;      // M4：连接列表有变化（保存 / 删除 / 信任密钥 / 重新连接 / 测试之后）
  'connection.status': { id: string; state: 'idle' | 'connecting' | 'online' | 'offline' | 'auth-failed' | 'auth-unsupported' | 'host-key-pending' | 'host-key-changed' };  // M4：连接池的状态（auth-unsupported 为 M5 K2，7.6 节）
  'connection.hostKeyPrompt': HostKeyPrompt;        // M4：首次连接时请求确认主机密钥（只发给主窗口）；以 connection.answerHostKey 回答，5 分钟未回答按拒绝
  'connection.hostKeyPromptClosed': { promptId: string };  // M4：询问已结束（回答 / 超时），渲染端移除确认框
  'editSession.changed': EditSessionDto;
  'window.stateChanged': WindowState;
  'doc.progress':      DocProgressEvent;              // 只发给文档所属的窗口
  'doc.changed':       DocChangedEvent;               // 同上
  'web.state':         WebViewState;                  // { tabId, title, loading, failed }；以下 web.* 只发给视图所属的窗口
  'web.navigate':      { tabId: string; uri: string; newTab: boolean; fragment: string };  // 视图内的链接指向范围内的资源；fragment = 链接的 ?查询#锚点（没有时为空串）
  'web.notice':        { tabId: string; notice: 'outOfScope' | 'download' | 'unsupported' };
  'web.shortcut':      { tabId: string; key: string; ctrl: boolean; shift: boolean; alt: boolean };  // 焦点在视图中的应用快捷键 / 鼠标侧键
  'desktop.changed':   { scope: 'current' | 'snapshots' };   // 桌面记录：现场 / 快照列表有变化
  'desktop.exitRequested': Record<string, never>;          // 用户关闭主窗口、需要询问保存（只发给主窗口）
  'desktop.exitCancelled': Record<string, never>;          // 主进程取消了挂起的询问（关机开始等）
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorPayload };
```

### 6.4 主进程注册器

```ts
// apps/desktop/src/main/ipc/router.ts（节选）
export function registerIpc(handlers: Handlers, logger: Logger, trustedUrlPrefix: string) {
  ipcMain.handle(IPC_INVOKE, async (event, envelope) => {
    if (!event.senderFrame?.url.startsWith(trustedUrlPrefix)) return fail('IPC_FORBIDDEN');
    const { channel, input } = envelope ?? {};
    if (typeof channel !== 'string' || !isIpcChannel(channel)) return fail('IPC_UNKNOWN_CHANNEL');
    const parsed = ipcContract[channel].input.safeParse(input);
    if (!parsed.success) return fail('IPC_BAD_INPUT', parsed.error.message);
    try {
      return { ok: true, data: await handlers[channel](parsed.data as never, toContext(event)) };
    } catch (e) {
      logHandlerError(logger, channel, e);  // 预期内的错误码（DESKTOP_SNAPSHOT_NOT_FOUND）记 warn，其余记 error
      return { ok: false, error: toErrorPayload(e) };
    }
  });
}
```

`Handlers` 类型要求每个通道都必须实现，漏写会编译失败。错误统一包装成 `IpcResult`，因为 Electron 跨进程抛出的 Error 会丢失错误码等信息。

### 6.5 Preload 与渲染端调用

```ts
// apps/desktop/src/preload/index.ts（sandbox：只能 require('electron')，不能使用 Buffer 等 Node API）
const listeners = new Map<string, Set<(payload: unknown) => void>>();
ipcRenderer.on(IPC_EVENT, (_e, { event, payload }) => listeners.get(event)?.forEach((l) => l(payload)));

contextBridge.exposeInMainWorld('pch', {
  invoke: (channel: string, input: unknown) => ipcRenderer.invoke(IPC_INVOKE, { channel, input }),
  on: (event: string, listener: (payload: unknown) => void) => {
    /* 加入 listeners，返回取消订阅函数 */
  },
  getPathForFile: (file: File) => webUtils.getPathForFile(file),   // 拖入文件时取得真实路径
  bootstrap: readBootstrapArg(process.argv),                       // 初始主题/语言/windowId，防首屏闪烁
});
```

```ts
// apps/desktop/src/renderer/src/lib/ipc.ts
export async function call<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutput<C>> {
  const res = (await window.pch.invoke(channel, input)) as IpcResult<IpcOutput<C>>;
  if (!res.ok) throw new AppError(res.error);       // 交给 TanStack Query / ErrorBoundary
  return res.data;
}
```

### 6.6 错误模型

错误码按领域前缀划分，定义在 `packages/shared` 的 `ERROR_CODES`：已有 `UNKNOWN`、`IPC_*`（FORBIDDEN / BAD_INPUT / UNKNOWN_CHANNEL）、`SETTINGS_INVALID`、`WORKSPACE_*`（NOT_FOUND / DEFAULT_PROTECTED / NAME_REQUIRED）、`ENTRY_*`（NOT_FOUND / INVALID_PARENT / KIND_MISMATCH / TEMPORARY_PATH）、`FS_*`（NOT_FOUND / PERMISSION_DENIED / NOT_A_DIRECTORY / INVALID_URI / UNSUPPORTED_SCHEME / CANCELLED / TIMEOUT / UNAVAILABLE）、`INDEX_UNAVAILABLE`（扫描进程或其缓存库不可用）、`DOC_NOT_FOUND`（文本文档已关闭 / 因每窗口上限被关闭 / 窗口已销毁，7.5 节）、`LAUNCH_FAILED`（启动本机程序失败：Office 等的打开方式不可用、启动失败、对象不是文件，M2 `modules/launcher`，10 节）、`DESKTOP_SNAPSHOT_NOT_FOUND`（桌面记录的快照不存在：已删除、恢复后已清空，或属于别的机器，M3，11.4 节；属于正常流程，IPC 路由按 warn 记录，见 `ipc/log-error.ts`）；网络类错误（ETIMEDOUT、ECONNRESET、ECONNREFUSED、ENETUNREACH、ENETDOWN、EHOSTUNREACH、EHOSTDOWN、EIO）映射为 `FS_UNAVAILABLE`（「位置无法访问」）；扫描进程的 win32 枚举器只把确定的网络 / 设备不可用类 Win32 错误码映射为 `FS_UNAVAILABLE`（列表见 5.2 节），其余未知错误码为 `UNKNOWN`（只影响该目录）；扫描进程客户端的 60 秒兜底超时为 `FS_TIMEOUT`；`ERR_INVALID_FILE_URL_*`、`ERR_INVALID_URL`、`ERR_INVALID_ARG_VALUE` 映射为 `FS_INVALID_URI`（M1-2）；M4（已实现）增加 `CONN_*`：`NOT_FOUND`（连接不存在）、`AUTH_FAILED`（登录认证失败，锁定）、`KEY_INVALID`（私钥读不了 / 格式不支持 / 口令错误：本机错误，不连接、不锁定）、`HOST_KEY_REJECTED`、`HOST_KEY_CHANGED`、`SUDO_AUTH_FAILED`（sudo 密码错误，按连接锁定所有切换身份）、`SUDO_DENIED`、`SUDO_FAILED`、`SFTP_SERVER_NOT_FOUND`、`PROCESS_LIST_HIDDEN`、`SECRET_UNAVAILABLE`（语义见 7.6 节）；M5 增加 `CONN_AUTH_UNSUPPORTED`（服务器的 `keyboard-interactive` 提示形式不支持且尚未交出密码：不锁定，D15 / M4-K2，7.6 节）；超时沿用 `FS_TIMEOUT`、断开沿用 `FS_UNAVAILABLE`（设计草案中的 `CONN_TIMEOUT` 未采用）。渲染端用错误码查 i18n 文案（`errors.CONN_AUTH_FAILED`），所以错误提示天然支持多语言，主进程不拼接用户可见文案。渲染端未捕获的异常经 `log.write` 写入 `main.log`（12.3 节），用户反馈问题时只需提供这一个文件。

---

## 7. 虚拟文件系统与远程目录

### 7.1 Provider 接口

```ts
// apps/desktop/src/main/vfs/types.ts
export interface FileSystemProvider {
  readonly scheme: 'file' | 'sftp';   // 已实现：file、sftp（M4）；smb 放弃，ftp 在「后续」
  readonly capabilities: { rangeRead: boolean; write: boolean };

  stat(uri: URL, signal?: AbortSignal): Promise<FileStat>;
  list(uri: URL, signal?: AbortSignal): Promise<FileEntry[]>;
  read(uri: URL, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;  // 开-读-关
  createReadStream(uri: URL, range?: ByteRange, signal?: AbortSignal): Promise<Readable>;
  dispose(): Promise<void>;
}

export interface FileEntry {
  uri: string;
  name: string;
  kind: 'file' | 'directory' | 'symlink';
  target?: 'file' | 'directory' | null;   // 仅 symlink：链接 / 目录联接的目标类型，null 为失效
  size: number;
  mtime: number;
  hidden: boolean;
  owner?: string;                          // M4：远程目录的属主名（取自 SFTP longname），供「无权限」提示
}
```

已实现的是上面接口的子集（`stat`、`list`、`read`、`dispose`；`createReadStream` 于 M2 增加；`capabilities` 尚未引入）。**`read(uri, offset, length, signal?)`**（2026-11-20，文本预览）：每次调用 = 打开 → 读 → 在 `finally` 中关闭，不在调用之间持有句柄；到达文件末尾时返回更短的结果（offset 在末尾之后为空），不存在 → `FS_NOT_FOUND`。本地 provider 用 `fs.promises.open(p, 'r')`：libuv 在 Windows 上以 `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE` 打开（`knowledge/windows-and-tooling.md`），读取期间他人仍可追加、改名、删除该文件；但 **读取进行中的那一刻其上级目录不能改名**（Windows 的限制，与共享标志无关），因此只在一次读取期间打开（本地 1MB 约毫秒级）。`VfsService.read(uri, offset, length, signal?)` 同样按位置超时，并接受调用方的 `AbortSignal`（文档关闭时中止索引中的读取）。`watch` 已于 2026-11-19 删除（目录的持续刷新改由扫描进程负责，见下文），目标结构中也不再有 `watch`。`VfsService` 只负责一次性调用（`stat`、条目添加时的校验、扫描进程不可用时的直接枚举）：按 scheme 路由、统一超时（按位置取 `vfs.timeoutSec.local` / `vfs.timeoutSec.network`，整次调用的总时长，`FS_TIMEOUT`）与取消（`vfs.cancel` 通过 requestId 触发 AbortController，`FS_CANCELLED`；同一 requestId 的新请求取代旧请求）。取消与超时以「调用与中止信号赛跑」实现，即使 provider 不响应信号（例如无响应的网络共享上的 readdir）也能按时结束。Node 的文件系统错误统一转换为 `FS_*` 错误码（`vfs/errors.ts`）。新增一种远程类型（例如将来的 WebDAV、S3）只需新增一个 provider 并在组合根注册，其他代码零修改。

**`createReadStream(uri, range?, signal?)`（M2，已实现）**：打开 → 返回 Node 读取流（`range` 为闭区间字节 `{start, end}`）；句柄由流持有（`autoClose`），流结束、出错、`destroy()` 或 `signal` 中止时关闭，打开方式同 `read`（他人仍可改名 / 删除，读取进行中其上级目录暂不能改名）。`VfsService.createReadStream` 的超时（按位置）只覆盖「打开」阶段，打开之后调用方的 `signal` 中止即销毁流；调用已超时 / 取消之后才打开完成的流立即销毁，不泄漏句柄。

`FileEntry` 对符号链接与目录联接（junction）附带目标类型（`target: 'file' | 'directory' | null`，`null` 表示已失效），列目录时只对链接额外 stat 一次（计入同一并发上限），资源树据此判断能否展开（已实现，M1-2）。目标是文件以外的类型（如设备）也归为 `'file'`；目标 stat 因任何原因失败（不存在、循环、权限、网络）都为 `null`；lstat 本身失败的降级项不带 `target`，资源树按失效链接处理。

**目录刷新：扫描 + 缓存（2026-11-19 起取代目录监听，设计见 `devDoc/2026-11-19-01-refresh-cache-design.md`）**：

M1-2 曾用 `fs.watch` 监听已展开的目录，实测监听句柄会阻止上级目录改名 / 移动（违反原则：「应用不变动文件和目录的数据：不写入、不新建、不删除、不移动、不改名，不长期持有句柄（不能妨碍用户改名或移动）。读取时由系统自动更新的元数据（如访问时间）不在此列。」），因此删除了全部监听代码（`vfs.watch`、`VfsService.setWatched`、`LocalProvider.watch`、渲染端的 `createWatchScheduler` / `useWatchDirectories` / `watchableUris`、`VFS_WATCH_MAX`、目录列表的 2 秒新鲜期与 focusManager 的聚焦设置、设置 `remote.pollIntervalSec`），改为扫描进程（5.2 节）缓存目录列表并按优先级检查。

已实现：

- **`vfs.list({ uri, requestId? })` → `DirectoryListing { items, state, checkedAt }`**：主进程经 `ScannerClient` 交给扫描进程——有缓存立即返回缓存（`state: 'cached'`，并以 P0 安排检查；2 秒内确认过则 `'fresh'`、不再安排检查）；没有缓存则枚举后返回（`'fresh'`）；所在共享断开时返回缓存（`'offline'`），没有缓存则 `FS_UNAVAILABLE`。**降级**：只有 `ScannerClient.available` 为 `false`，或扫描进程明确以 `INDEX_UNAVAILABLE` 拒绝（例如 `index.db` 打不开、进程退出）时，由 `VfsService.list` 直接枚举（`state: 'fresh'`、`checkedAt: Date.now()`，不缓存，requestId 的取消只在这里有效）；扫描进程返回的文件系统错误（`FS_NOT_FOUND` 等）与客户端的 60 秒兜底超时（`FS_TIMEOUT`）原样抛出、不回退（`vfs.ipc.test.ts`）。
- **`vfs.interest({ focus, visible, offscreen, tabs })`**（按窗口整体替换，owner = 调用方的 webContents id）：渲染端 `features/explorer/interest.ts` 的纯函数 `interestFromTree(nodes, range, selectedId)` 求出——关注点：目录节点（条目根、目录、链接目录）为自身 URI，文件 / 链接文件 / 失效链接为父目录，分组、状态行、文件条目为 `null`；`visible`：虚拟滚动实际渲染的行范围（含 overscan）内的行所属的已展开目录与行本身为已展开目录者；`offscreen`：其余已展开目录（加载中 / 出错的目录也算已展开）。按树中顺序去重，超过上限（2000 / 5000）截断。`tabs`（≤ 8，M1-3）：标签中显示的目录——`features/tabs` 的标签区经 `stores/tabs-store.ts` 的 `selectActiveDirectory` 取激活标签显示的目录（文件标签、没有标签时为空），按关注点处理（8.3 节）。两部分由 `data/vfs.ts` 的本窗口合并器 `createInterestHub` 合并（资源树 `useVfsInterest`、标签区 `useVfsTabsInterest`），300ms 防抖发送（内容不变不重发）；一个来源卸载（切换工作区、侧栏切到其他视图、关闭最后一个标签）只清空自己的部分，同样经防抖发送。
- **窗口焦点**：主进程在 `browser-window-created` 时给每个 BrowserWindow 的 `focus` / `blur` 接上 `scanner.windowFocus(webContents.id, focused)`（所有窗口失焦时定期确认暂停、后台队列照常，重新获得焦点时关注点进入 P0），webContents `destroyed` 时 `releaseOwner`。初始状态不主动发送（扫描进程把发来关注点的新窗口视为已聚焦）。
- **配置下发**（`vfs/scanner-config.ts` 的纯函数 `buildScannerConfig`，已实现）：roots = 活动工作区的 folder 条目，策略 = 条目级 `cacheStrategy ?? cache.strategy.<位置>`；`allRootUris` = 所有工作区的 folder 条目；`indexTargets` = 活动工作区的「建立索引」目标；`settings`（`ScanSettings`）由 `cache.*` / `vfs.timeoutSec.*` 组装：`interval.{focus,near,far}.{local,network}`（秒）、`backgroundGapMs.{local,network}`、`timeoutSec`、`activeDepth`。条目 URI 在写入时（`toFileUri` / `entry.add` 的 `uri` / `index.setTarget`）与下发时都经 `normalizeRootUri` 规范化：不带结尾 `/`（驱动器根 `file:///C:/` 除外；缓存的 `isUnder` 与渲染端查询 key 依赖这一点）；迁移 0003 同时规范化已有条目。启动、`workspace.changed`（含切换工作区与索引目标变化）、`cache.*` / `vfs.*` 设置变化时重新下发；多次下发并发时只发最后一次。移除条目（含分组连带移除）时，同一事务删除位于被移除 folder 之下且不在其他 folder 条目之下的索引目标。
- **`vfs.refresh({ uris })`**（≤ 500）：F5 / 刷新按钮对所有已展开目录（渲染端 TanStack Query 中有观察者的目录查询）分批发送，再让条目与所有目录查询失效；状态行的「重试」对该目录发送，再让该查询失效（期间保持错误行）；从搜索结果定位失败时对出错的那一层目录发送（`data/vfs.ts` 的 `confirmDirectory`，只发送、不让查询失效：确认发现变化时由 `vfs.changed` 重新列出，8.4 节）。断开的共享也立即尝试一次。
- **事件**：`vfs.changed { uri }`（缓存内容有差异时才发）→ `lib/query-client.ts` 让该目录查询失效；`vfs.reachability { share, state, since }` → `stores/reachability-store.ts` 的 `offlineShares`（断开图标在 Task 8；启动时先以 `vfs.offlineShares` 初始化，5.3 节）；`online` 时 `lib/query-client.ts` 让该共享 / 卷下的目录查询失效（`state: 'offline'` 随之更新）。`vfs.cacheInfo` / `vfs.clearCache` 已有通道，界面随 M5 设置页。
- **取消**：目录查询的 `queryFn` 仍使用 TanStack Query 的 `signal`，中止时发送 `vfs.cancel`（requestId `dir:<uri>`，只对降级模式的直接枚举有效；经扫描进程的请求很快返回缓存，不可取消）。中止时机与「取消不会落到新请求上」的论证同 M1-2（有单元测试）。
- 已知限制：
  - 枚举期间（本地毫秒级；网络上的大目录可能更长）恰好在资源管理器中改名 / 移动该目录的上级可能失败，这是读取目录本身不可避免的；句柄在一次枚举结束（含出错、取消）后立即关闭，不长期持有（e2e `principle: renaming an ancestor of an expanded directory succeeds`：展开 `A\B\C` 并经过 2 个刷新间隔后改名 `A` 10 次，全部成功）。
  - **读取文件内容期间无法改名其上级目录**（文本预览，2026-11-20）：`provider.read` 每次开-读-关（本地 1MB 约毫秒级），文件本身可被改名 / 删除 / 追加（libuv 以 `FILE_SHARE_READ | WRITE | DELETE` 打开），但读取进行的那一刻上级目录改名会失败（EPERM，与枚举目录同类）；在大文件 / 慢速共享上建立索引期间恰好改名上级目录时用户可能看到「文件夹正在使用」，索引结束后一律可改名（e2e 覆盖：索引期间改名文件成功，上级目录在读取间隙成功）。控制者裁定接受为已知限制。
  - `isUnderUri` 大小写敏感：大小写不同的同一目录被视为不同目录（URI 都来自条目 + `pathToFileURL(path.join(...))`，实际保持一致）。
  - 窗口初始的焦点状态不下发；窗口在后台创建、从未获得焦点时，扫描进程仍按已聚焦调度。
  - Playwright 产生不了真实的焦点切换，e2e 直接触发 BrowserWindow 的 `blur` / `focus` 事件；真实 Alt+Tab 未验证。
  - **访问时间（I5 已消除）**：读目录以只读方式（`FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES`）打开，不再以写属性打开，因此不会产生 WriteAttributes 类审核记录；目录自身的访问时间会按系统设置被更新（属于新原则允许的「读取时由系统自动更新的元数据」）。变化检测用目录的修改时间，与访问时间无关。网络位置上本来就有大量访问，访问时间早已被他人不断更新。

### 7.2 各 Provider 要点

**LocalProvider**（已实现）：基于 `fs/promises`，同时处理盘符路径与 UNC（`file://server/share`），路径与 URI 的转换只用 `node:url` 的 `pathToFileURL` / `fileURLToPath`。`list` 不跟随符号链接（报告为 `symlink`，避免循环；Windows 的目录联接 junction 同样报告为 `symlink`，并附带目标类型 `target`，见 7.1）；`stat` 跟随链接（因此指向目录的链接可按 `folder` 添加为条目）；不监听（`watch` 已于 2026-11-19 删除）；子项 lstat 最多 16 个并发、每开始一项前检查中止信号（避免占满 libuv 线程池、取消后不再发出新工作；这部分在 `vfs/fs-list.ts`，与扫描进程的 fs 回退枚举器共用）；子项在列出后被删除时跳过，存在但读不到（权限不足、网络瞬断）时保留并降级（类型取自 readdir，大小与时间为 0），不让整个列表失败、也不让文件「消失」。名称：驱动器根显示为 `C:`、UNC 共享根显示为 `\\server\share`。隐藏文件：LocalProvider 只把以 `.` 开头的名称视为隐藏。按 Windows 隐藏属性判断（有 `FILE_ATTRIBUTE_HIDDEN` 即隐藏，只有 SYSTEM 的照常显示）的实现在扫描进程的 koffi 枚举器 `scanner/enum/win32-enumerator.ts` 中，它同时以 LastAccessTime = -1 的句柄枚举、不更新目录自身的最后访问时间（本机 NTFS 已实测；网络共享未验证）；资源树的目录列表经扫描进程，因此按属性判断；只有降级模式（扫描进程不可用、由 `VfsService` 直接枚举）按 `.` 判断。

**SmbProvider（未挂载 SMB）**（**放弃**：需求方 2026-11-22「意义不是很大」；以下为原设想，保留备查）：以 Windows 为主要目标平台。将 `smb://{connId}/share/path` 解析为 `\\host\share\path`；首次访问某个共享时，用 `execFile('net', ['use', '\\\\host\\share', password, '/user:DOMAIN\\user', '/persistent:no'])` 建立**不占盘符**的会话（用 execFile 而非 shell，避免注入），之后委托给 LocalProvider 读写。后续阶段可用 koffi 调用 `WNetAddConnection2` 替换 `net use`，避免密码出现在进程参数中。macOS/Linux 如需支持，再单独实现。

**FtpProvider**（路线图「后续」）：basic-ftp 的一个客户端同一时刻只能执行一个操作，因此连接池按连接配置维护少量客户端（默认 2 个：列目录与传输分离），每个客户端内部串行队列。支持 FTPS、主动/被动模式、文件名编码（日本服务器常见 Shift_JIS）等选项，存于连接的 `options`。

**SftpProvider**（M4 已实现，详见 7.6 节）：直接使用 `ssh2`（不用原计划的 `ssh2-sftp-client`：它不能在命令通道上走 SFTP），只读（`stat` / `list`；`read` / `createReadStream` 以 `FS_UNSUPPORTED_SCHEME` 拒绝且不连接）；首次连接时展示主机密钥指纹由用户确认并保存（TOFU），之后指纹变化报 `CONN_HOST_KEY_CHANGED` 拒绝连接。支持密码与私钥两种认证。

**连接池通用策略**：懒连接、空闲 5 分钟回收、断线时用户操作发起的请求自动重连并重试一次（后台读取不重试，由扫描进程的退避探测重连）、认证失败绝不自动重试、连接状态通过 `connection.status` 推送到「远程连接」视图（M4 已实现，7.6 节）。

### 7.3 `pcfs://` 协议：让预览插件「像访问网页资源一样」访问任意文件

> **已实现（M2，浏览器视图用的 `pch-web://`）**：`modules/web/{scope,mime,web-protocol}.ts`。地址 `pch-web://<范围编号>/<逐段 encodeURIComponent 的相对路径>`，范围编号 = `s` + `sha256(范围根 URI)` 前 16 个十六进制字符（`s` 前缀避免主机名被当作 IPv4 数字解析），`ScopeTable` 在内存登记 编号 → 范围根；`fromWebUrl` 逐段解码后拒绝空段、`.` / `..`、含 `/` `\` NUL 的段，并用 `isUnderUri` 复核（未登记 → 404，范围外 → 403）。**范围根的确定**（渲染端 `web-host.ts` 的 `scopeRootFor`，最终修复 I1）：候选 = 包含页面的**最外层** folder 条目根 ?? 文件所在目录（文件条目、地址栏打开的条目外文件；驱动器根为 `file:///C:/`）；`WebViews` 按标签记住最近一次的范围根（与视图分开：release 后保留，标签关闭时忘记），之后该标签 attach 的页面仍在其中就**沿用**（Javadoc 的 `index.html` → `pkg/Class.html` 后 `../stylesheet.css`、`../index.html` 仍指向正确的文件，源不变，localStorage / sessionStorage 不变），只有候选比它更宽（首次 attach 时条目尚未加载）时换成候选；页面不在其中时取候选。嵌套条目首次打开取最外层是控制者裁定，待需求方确认（实现记录 Q2）。`createWebProtocolHandler` 只读：GET / HEAD，单区间 `Range`（206 / 416；没有 `Range` 时也按 stat 的大小读，stat 之后被追加的部分不发，响应体与 `Content-Length` 一致），`Content-Type` 取内置表（`mimeOf`，不引入 `mime` 包），`Cache-Control: no-store`，目录 / 不存在 → 404，`FS_UNAVAILABLE` → 502，`FS_TIMEOUT` → 504；响应体取消或请求中止时销毁流。查询参数只认两个（M2 Task 8，其余忽略）：`?pch-view=markdown` → 文件存在时返回 Markdown 外壳页（`markdown-shell.ts`，`Content-Type: text/html; charset=utf-8` + `Content-Security-Policy` 响应头 `MARKDOWN_CSP`，不读文件内容）；`?pch-raw=1` → 原始字节（`application/octet-stream`，不处理 `Range`，超过 `MARKDOWN_MAX_BYTES` = 5MB → 413），供查看脚本同源 fetch。`registerPrivilegedSchemes` 登记 `pch-web`、`pch-asset`（`standard`、`secure`、`supportFetchAPI`、`corsEnabled`、`stream`）；两个处理器都只注册在浏览器视图的会话（`configureWebSession`），各自外包发起方检查：`pch-web` 只放行无发起方与同一 `pch-web://<范围编号>` 源（`guardInitiator`），`pch-asset` 只放行无发起方与来自 `pch-web://` 页面的请求（`guardAssetInitiator`）。**`pch-asset://viewer/…`**（`createAssetProtocolHandler`）：生产只提供 `out/web-assets/markdown`（asar 内，`AppPaths.webAssets`）中扩展名为 `.js` / `.css` / `.map` 的文件（路径逐段解码后拒绝空段、`.` / `..`、含 `/` `\` NUL 的段并复核仍在该目录下，否则 404），响应带 `Access-Control-Allow-Origin: *`（外壳页是 pch-web 源，module 脚本与动态分块以 CORS 模式请求）、`X-Content-Type-Options: nosniff`；开发模式（渲染端地址为 http 的 dev server）所有路径原样代理到 renderer dev server（`net.fetch`；解析结果不在 dev server 的源上——`//host`、反斜杠开头——时 404），外壳的脚本地址为 `pch-asset://viewer/@fs/<main.ts 的绝对路径>`。下文的 `pcfs://` 仍是目标结构。

插件拿到的是一个 URL（`pcfs://res/<encodeURIComponent(uri)>`），可以直接用于 `<img>`、`<video>`、pdf.js、`fetch()`，无需关心文件在本地还是 FTP 上。

```ts
// apps/desktop/src/main/vfs/pcfs-protocol.ts
export function registerPcfsProtocol(vfs: VfsService, cache: RemoteCache, allowOrigin: string) {
  protocol.handle('pcfs', async (request) => {
    const uri = decodeResourceUrl(request.url);
    // 远程文件先下载到本地缓存（命中则直接用），统一按本地文件提供，天然支持 Range
    const local = uri.protocol === 'file:' ? uri : await cache.ensureLocal(uri, vfs);
    const stat = await vfs.stat(local);
    const range = parseRangeHeader(request.headers.get('range'), stat.size);
    const stream = await vfs.createReadStream(local, range ?? undefined);

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range ? 206 : 200,
      headers: {
        'Content-Type': mime.getType(uri.pathname) ?? 'application/octet-stream',
        'Content-Length': String(range ? range.end - range.start + 1 : stat.size),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': allowOrigin,
        ...(range && { 'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}` }),
      },
    });
  });
}
```

### 7.4 远程文件缓存

> 路线图「后续」（需求方 2026-11-22：M4 只做 SFTP 只读，远程文件不下载、不预览内容）。设置 `remote.cacheSizeMB` 保留但暂无用途。

缓存路径为 `userData/cache/remote/<sha1(uri)>/<mtime>-<size>/<原文件名>`，远端 mtime 或 size 变化即视为新版本。按设置项 `remote.cacheSizeMB` 做 LRU 淘汰。缓存同时服务于「用系统应用打开远程文件」（下载后 `shell.openPath`）——**需求方决定（2026-11-19）：资源树只用于展示，对文件的操作都放在将来的预览窗口中**，因此这一打开动作只由将来的预览窗口提供，资源树的右键菜单不提供。Office 文件的远程编辑与回传由独立的「远程编辑会话」处理（第 10.5 节），不与只读缓存混用。

### 7.5 文本文档（分页模型）与编码

设计：`devDoc/2026-11-20-18-text-preview-design.md`。文本 / 日志预览不一次读入整个文件：主进程对文件的一个**字节窗口**建立稀疏行索引，渲染端按行号分页读取原始字节、用 `TextDecoder` 解码（纯逻辑在 `@pch/text-engine`：行索引、按行读取、sniff、编码判断、解码）。原 `vfs.readText`（一次读入并在主进程解码）不再采用。

目标结构（主进程 `vfs/document/`，渲染端调用与界面随文本插件）：

- **文档**：`doc.open { uri, encoding?, at? }` → `DocumentInfo { docId, uri, size, mtime, encoding { label, confidence, bomLength, manual }, binary, mode, window, index { lines, complete, indexedTo } }`。文档归属调用方窗口（webContents id），每窗口最多 16 个（超出时关闭最久未用的），窗口销毁时全部释放；docId 不存在 / 不属于调用方 → `DOC_NOT_FOUND`。事件 `doc.progress { docId, indexedTo, lines, complete, error? }`（节流 ≥ 200ms，完成 / 出错时必发；error 为错误码）与 `doc.changed { docId, appended? | reset? | missing? }` 只发给所属窗口。
- **模式**：文件不超过 `preview.maxTextSizeMB`（默认 50，语义为「自动建立完整行索引的上限」）或不超过 4MB → 全量（窗口 = 整个文件）；否则部分模式：窗口取开头（`at: 'start'`，默认）或末尾（`at: 'end'`）4MB，边缘对齐到行边界（64KB 内无换行时保留原边缘），末尾窗口的起点取偶数（UTF-16 单元相对文件开头对齐）。`doc.buildIndex` 部分 → 全量。
- **索引**：后台按 1MB 分块读取（每块一次开-读-关），本地与网络相同；超时 / 取消复用 `VfsService`（按位置 `vfs.timeoutSec.*`），失败时 `index.complete` 保持 false、`doc.progress` 带错误码，刷新时重试。`doc.open` 等第一块索引完再返回（1MB 以内的文件返回时已完成；之后的进度事件晚于应答到达渲染端）。块读取只取计划的长度，扫描中文件增长不越过窗口终点。
- **按行读取**：`doc.readLines { docId, start, count ≤ 2000 }` → `DocLineBlock`（与 text-engine 的 `LineBlock` 同构：`start` 为窗口内行号；`bytes` 为各行拼接，未截断的行含行尾，超过 64KB 的行只含前缀，因此不一定是文件中连续的一段；`starts` / `ends` 为 `bytes` 内偏移，`ends` 不含 `\n` 与其前的 `\r`；`truncated` 为被截断行的绝对行号）。
- **刷新** `doc.refresh`（与 provider 无关的判定，`document-identity.ts`）：不存在 → `missing`（保留状态）；变小或开头 4KB 与打开时不同 → `reset`（重新决定模式、窗口、编码并重建索引）；只增长 → `appended`（全量与末尾窗口的终点随之延长，从已索引处续扫；开头窗口不受影响、不发事件）；大小相同但修改时间变了 → `reset`（原地改写）。扫描中读到的比窗口少（文件变短）→ 自动检查（通常为 `reset`）。重建（`reset`、`buildIndex`）与切换编码、重新判断编码时的重新对齐**先读完再一次性提交**（快照最后写；`missing` 在重建成功后才清除）：中途读取失败（UNC 上轮转时超时最常见）时快照、窗口、编码与索引都保持旧的，下一次刷新仍判为 `reset` 并重试（文本预览最终审查修复：此前快照先被换成新文件的，之后永远判为 unchanged / appended，未缓存的行按旧偏移读新文件）。
- **编码**：BOM 看文件开头（certain）；否则 `detectEncoding` 的样本取窗口开头 / 中间 / 末尾各 64KB，`preferred` 取当前界面语言（平局时决定先后）。全量模式、自动判断为 UTF-8 且不是 BOM 确定的：建索引时对全部内容做流式 UTF-8 校验（`utf8-validator.ts`，规则同 `TextDecoder` fatal；末尾不完整的序列不算非法——日志可能正写到一半），发现非法字节后用「窗口开头 + 从该处所在行开始的一段」重新判断，结果改变时发 `doc.changed { reset }`。`doc.setEncoding { encoding | null }`：手动指定（`manual: true`、`certain`，BOM 与所选编码一致时保留 `bomLength`）或恢复自动判断；切换到 / 离开 UTF-16（换行单元改变）时重新对齐窗口并重建索引，其余只换标签（渲染端换解码器）。`bomLength` 只在窗口从文件开头开始时非 0。
- `vfs.sniff { uri }` → `{ kind: 'text' | 'binary' | 'empty' }`：读开头 8KB（开-读-关），供容器为未匹配的文件选插件。

已实现（2026-11-20，文本预览 Task 4）：以上主进程部分全部（`vfs/document/` 与 `vfs.sniff`、`DOC_NOT_FOUND`；`DOC_ENCODINGS` 与 text-engine 的 `ENCODING_LABELS`、`DocLineBlock` 与 `LineBlock` 由类型测试保证一致）。单元测试：`document-service.test.ts`（内存假 provider：全量 / 部分、末尾窗口的行与 UTF-16 偶数对齐、扫描中增长、追加 / 截断 / 开头变化 / 删除 / 扫描中变短、ASCII 开头 + 后部 Shift_JIS 的改判、setEncoding、LRU、owner 释放、索引失败）、`document-window` / `document-identity` / `utf8-validator` / `document.ipc` 的测试、`local.provider.test.ts`（read 之后立即可改名文件与上级目录）。

已实现（2026-11-20，文本预览 Task 5）：文档归属的生命周期补全——主框架开始载入新文档（重新加载 / 导航，同文档导航与子框架除外）与渲染进程崩溃 / 被终止（`render-process-gone`）时关闭该窗口的全部文档（`DocumentService.resetOwner`；旧页面发起、之后才完成的 open 也关闭并以 `DOC_NOT_FOUND` 拒绝），窗口销毁时 `releaseOwner`（`vfs/document/document-owner.ts` 的 `bindDocumentOwner`）；文档关闭后，关闭前已开始的刷新 / 编码重新判断不再发 `doc.changed`。渲染端的调用、自动刷新与「按位置 sniff 选插件」见 9.1、9.3 节；文本插件的界面尚未实现（Task 6）。
已实现（2026-11-20，文本预览 Task 6）：界面——文本插件 `pch.preview.text`（9.4 节：自绘分页视图、块缓存、编码下拉、跟随末尾、部分模式「读取全部」）；视口数学 `pager-model`（`@pch/text-engine`：`clampTop` / `maxTop` / `scrollLines` / `thumb` / `topFromThumb`，拇指最小 20px 的缩放滚动条，纯函数）。Chromium 渲染端的 `TextDecoder` 支持上述 9 个标签（e2e 中除 UTF-8 外 8 个标签的样本都显示正确）。

### 7.6 远程目录（SFTP，M4）

设计（已批准）：`devDoc/2026-11-22-37-m4-sftp-design.md`；计划：`devDoc/2026-11-22-38-m4-sftp-plan.md`；总结（控制者裁定 D1–D10 / R1–R25、推迟项、未验证项）：`devDoc/2026-11-22-40-m4.md`。需求方 2026-11-22：M4 只做 **SFTP 只读**（放弃 SMB；FTP、远程编辑、下载缓存在「后续」）。

**目标结构**（设计第 5 节，M4 范围内已全部实现，取值与实际行为见下面的「已实现」）：

- 资源：`sftp://<connectionId>/<绝对路径>`（登录用户）、`sftp://<身份>@<connectionId>/<绝对路径>`（以该身份浏览；同一路径不同身份是不同的资源，缓存分开）。路径逐段 `encodeURIComponent`；子项 / 父目录 / 名称的推导只在 `packages/shared/src/vfs/sftp-uri.ts` 定义一次（渲染端、主进程、扫描进程共用）。
- 主进程持有 SSH 连接（`modules/connection`，每个连接一条 SSH 连接）；扫描进程读远程目录时经 `remoteOp` 请主进程代读（设计 4.1 方案 A），缓存、调度、搜索沿用扫描进程与 `index.db`。
- 只读：provider 只发读取类请求；切换身份后在服务器上以 `sftp-server -R` 运行；文件只显示兜底的文件信息（不读内容、不 sniff、不下载）。
- 反目标：账号被锁（错误密码被自动重试、一次输错记多次）；机密进入渲染进程 / 日志 / URI / 命令行；未经确认接受主机密钥；向服务器写入；每读一个目录在 sudo 审计日志留一行；后台读取压垮服务器。

**已实现（2026-11-23，分支 `feat/m4-sftp`）**：

- **连接与凭据**：表 `connections`（迁移 0007，13 节）；机密以 safeStorage 加密，渲染端只见 `hasSecret` / `hasSudoSecret`。认证：密码（服务器只提供 `keyboard-interactive` 时以密码作答）、私钥（OpenSSH / PEM；PuTTY `.ppk` 只支持 v2 的 RSA / DSA，v3 与 Ed25519 的 `.ppk` → `CONN_KEY_INVALID`；未加密的 `.ppk` 不传口令——先不带口令解析，需要时再带）。`CONN_KEY_INVALID` 是本机错误，不连接、不锁定（D5）。删除连接时引用它的条目保留（显示「连接不存在」），确认框显示被引用的条目数。编辑时 `host` 或 `port` 变化清除已信任的主机密钥（D6 前半）。
- **一次连接只交一次密码**：自定义 `authHandler` 按服务器提供的方式只选一种（优先 `password`，没有时 `keyboard-interactive`），失败即结束；`keyboard-interactive` 一轮必须恰好 1 个非回显提示，否则中止（detail `keyboard-interactive: unsupported prompt …`，未交出密码，仅限第 1 轮之前或第 1 轮即出现不支持的提示、尚未交出密码时：错误码 `CONN_AUTH_UNSUPPORTED`，不锁定，状态 `auth-unsupported`，M5 K2；第 1 轮已交出密码、第 2 轮才出现不支持的提示 → 无法排除密码错误，按 `CONN_AUTH_FAILED`（detail `undetermined after password (…)`）锁定）。服务器不提供可用方式（detail 以 `no acceptable method` 开头）时报 `CONN_AUTH_FAILED` 但不锁定（未提交凭据）。
- **连接池**（`connection-pool.ts`）：懒连接，同一连接的并发请求共享一次连接尝试；请求被取消只让该请求离开，不中止共享的尝试；新的尝试先等同一连接上进行中（含已丢弃）的尝试结束再重读记录（R12）。登录用户的 SFTP 子系统按连接共享（打开以 `vfs.timeoutSec.remote` 为上限）；每个使用中的切换身份 1 个通道。保活 `keepaliveInterval = remote.keepaliveSec`（15 秒）、`keepaliveCountMax = 3`，静默断线约 `15 × 4 = 60` 秒发现；空闲 `remote.idleDisconnectMin`（5 分钟）无请求时断开（含 sudo 通道；进行中的身份打开过程计入「进行中」）。断线时**用户操作**发起的请求重连并重试一次，后台读取不重试。状态 `idle` / `connecting` / `online` / `offline` / `auth-failed` / `auth-unsupported`（M5 K2）/ `host-key-pending` / `host-key-changed` 经 `connection.status` 推送。`auth-unsupported` 与 `CONN_AUTH_UNSUPPORTED`：**只在尚未交出密码时**使用（服务器的 `keyboard-interactive` 提示一轮多个 / 回显 / 第 1 轮即不支持）；已交出密码后第 2 轮才出现不支持的提示，无法排除密码错误，按 `CONN_AUTH_FAILED` 锁定（「同一个错误密码绝不提交两次」）。连接池只在**内存**中记住 unsupported（不写 `auth_state`、**不跨重启**）：后台请求不再拨号，用户操作过 30 秒冷却（`IDENTITY_RETRY_COOLDOWN_MS`）才重试一次；`disconnect` / 「重新连接」/ 编辑 / 连接成功 / 测试成功时清除。
- **主机密钥**（`host-key-gate.ts`）：`hostVerifier` 必须设置（`ssh2` 不设置时自动接受）。首次连接向主窗口发 `connection.hostKeyPrompt`（算法 + `SHA256:` 指纹），5 分钟未回答按拒绝；回答 / 超时后发 `connection.hostKeyPromptClosed`，渲染端移除确认框；渲染端重新加载后以 `connection.pendingHostKeyPrompts` 取回未回答的询问（R17）。拒绝 / 超时 / 无窗口在内存中记住：后台请求直接 `CONN_HOST_KEY_REJECTED` 不再询问，用户操作重新询问（R13）。已保存的指纹不一致 → `CONN_HOST_KEY_CHANGED`，「远程连接」视图显示新旧指纹；「信任新的密钥」（`connection.trustHostKey { id, key }`）带**用户看到的**密钥，与服务器最新出示的不一致时以 `CONN_HOST_KEY_CHANGED` 拒绝、不保存（R24 I4）。
- **身份切换**（`sudo-switch.ts`、`identity-sessions.ts`、`server-probe.ts`）：第一次使用切换身份时（每条 SSH 连接一次，D4）以登录用户探测 sftp-server 位置（`/usr/libexec/openssh/`、`/usr/lib/openssh/`、`/usr/libexec/ssh/`、`/usr/lib/ssh/` 下第一个可执行的，连接设置可指定）与「能否看到 root 的进程」；看不到 → `CONN_PROCESS_LIST_HIDDEN`，不执行 sudo。命令通道执行 `printf 'PCHPID:%s\n' $$ >&2; exec env LC_ALL=C sudo -k -S -p '<标记>' su - <身份>`（目标为 root 时 `su -`；`LC_ALL=C` 使日文 locale 的服务器也输出英文信息，R8；目标用户与路径先按白名单正则校验，密码绝不进命令行）。同时开**一个长寿命的轮询通道**（D2）：`i=0; while [ $i -lt N ]; do ps -eo pid=,ppid=,comm= || exit; echo PCHEND || exit; sleep 0.15; i=$((i+1)); done`，N = ceil(2 × 切换超时 / 间隔) = 200（约 30 秒）；**服务器端的终止条件**：客户端关闭通道后写失败即退出（不依赖 SIGPIPE 的默认处理），且最多 N 次（R24 I2b）。sudo 的子孙中出现 `su` = 认证成功，之后才写 `printf '\120CHSTART\n'; exec <sftp-server> -R`，标记之前的输出全部跳过。提示出现 → 写一次密码；再次出现提示 = 密码错误 → `CONN_SUDO_AUTH_FAILED`。stderr 含拒绝措辞（传统 sudo 的 `is not allowed to execute` 等、sudo-rs 的 `I'm afraid I can't do that`）→ `CONN_SUDO_DENIED`；`must have a tty` → 以终端方式（pty，`stty raw -echo …`）重试一次并按「连接 + 身份」记住；标记前通道关闭 / 15 秒超时 → `CONN_SUDO_FAILED`。sudo 密码 = 另设的 sudo 密码 ?? 密码登录的登录密码（私钥登录且未另设时 sudo 若要密码 → `CONN_SUDO_AUTH_FAILED`，不写入任何东西）。用户取消不中止进行中的身份打开（15 秒上限内跑完，结果留作会话，R11a）。
  - **服务器配置类失败的记忆**（R10 / R16 / R24 Minor 2）：身份打开以 `CONN_SUDO_FAILED` / `CONN_SUDO_DENIED` / `CONN_PROCESS_LIST_HIDDEN` / `CONN_SFTP_SERVER_NOT_FOUND` 失败时，按（连接, 身份）在内存中记住：后台请求直接以同一错误失败、不再执行 sudo；用户操作才重试一次，且距上次失败 **30 秒内**（`IDENTITY_RETRY_COOLDOWN_MS`）的用户操作也直接以记住的错误失败（防止启动时恢复的多个标签各触发一次 sudo）。**随断线 / 空闲断开清除的只有 `CONN_SUDO_FAILED`**（偶发失败）；其余三种是服务器配置，只在 `unlock`（「重新连接」）、`disconnect`（编辑连接等）时清除。冷却期内服务器修好时「测试连接」可立即重试。
- **认证锁定与解除**（反目标「账号被锁」的核心；`auth_state` 写库并同时记在内存，**跨重启有效**）：
  - 登录认证失败 → `auth-failed`：此后所有请求直接 `CONN_AUTH_FAILED`（detail `locked`），不连服务器。sudo 认证失败 → `sudo-auth-failed`，**按连接锁住所有切换身份**（`pam_faillock` 按登录用户计数），登录用户自己的 SFTP 不受影响。
  - **已交出密码而结果未定也按失败锁定**：登录——交出密码之后、`ready` 之前的超时 / 断开 → `CONN_AUTH_FAILED`（detail `undetermined after password (…)`，R24 I1）；sudo——已写入密码而未判定成功时通道关闭 / 超时 / 轮询通道关闭 / 断线 / teardown → `CONN_SUDO_AUTH_FAILED`（R7、R11b）。
  - **解除**：(1) **编辑连接**只在对应的凭据有变化时解除（R24 C1 / R25，推翻计划 D6「编辑一律解除」，以设计 5.3 为准）：登录锁定看 `secret`（密文）/ `auth` / `keyPath` / `username` / `host` / `port`；sudo 锁定看**实际使用的 sudo 密码**的密文（另设的 sudo 密码；「同登录密码」模式下即登录密码）。判定（`credentials.ts` 的 `sameLoginCredentials` / `sameSudoCredentials`）比较编辑前后的记录，不看字段是否出现在输入里（渲染端在「同登录密码」模式下每次都发 `sudoSecret: null`、无口令私钥每次都发 `secret: ''`，R25）；提交了密码即得到新的密文（safeStorage 每次加密结果不同），重输同一个密码也算变化。只改名称 / 身份列表 / sftp-server 路径保留锁定；只改名称时不断开、不重新检查条目根。(2) **「重新连接」**（`connection.reconnect`）：解除并断开，之后的请求重新连接。(3) **「测试连接」**（D3）：用户的明确动作，锁定中也尝试一次，成功则解除（`auth_state = ok`），失败则写入对应的锁定。
  - **串行化**：测试连接与连接池的尝试串行——测试先等进行中的池尝试结束，那次尝试若是交出了凭据的认证失败则直接作为测试的认证步骤结果、不再拨号；测试自己的拨号也登记为尝试，池随后的请求等它（R24 C2）。sudo 切换按连接串行（`withSudoTurn`：池的身份打开与测试的身份步骤共用一把按 connectionId 的锁，拿到锁后再查一次 sudo 锁定，锁定写入在锁内完成），一个错误的 sudo 密码不会被并发提交两次。拨号之后凭据被编辑过的旧尝试失败时不写锁定（比较凭据字段，不比较 `updatedAt`）。
- **超时语义**：`ssh2` 的 `readyTimeout` 从连接开始计时，到 `USERAUTH_SUCCESS` 才清除——**覆盖认证阶段与主机密钥确认的等待**；平时取 `vfs.timeoutSec.remote`（20 秒），主机密钥尚未信任的首次连接取 `max(timeoutSec × 1000, 300_000)` ms（R5）；握手超时与保活超时同为 `client-timeout`，按消息区分（握手 → `FS_TIMEOUT`，保活 → 断开 `FS_UNAVAILABLE`）。扫描进程的看门狗按「没有进展的时间」计 `vfs.timeoutSec.remote`：`statDir` 探测阶段超时 → 该连接断开（进入退避探测）；**`list` 阶段超时只把该目录记为超时（`FS_TIMEOUT`），不算断开**（R24 I3）。provider 对符号链接的目标 stat 以有界并发 32 执行（`LINK_STAT_CONCURRENCY`），`/usr/lib64` 之类大量链接的目录不至于超时；attrs 缺 `mtime` / `size` 时取 0。
- **扫描进程中的远程目录**：复合枚举器按 scheme 分派，`sftp:` 交给远程枚举器（`remoteOp`，5.2 节）。位置 `remote`：`shareKey` / `hostKey` = `sftp://<connectionId>`（不含身份：一条 SSH 连接是一个可达性与并发单位），每连接同时 1 个用户读取（P0）+ 1 个后台读取，不计入本地 / 网络的线程池名额。**只在用户动作时读取**：展开、选中、标签中新显示的目录（P0，有缓存先显示缓存）、F5 / 刷新 / 状态行「重试」（强制）；关注点 / 近层 / 远层的定期确认、热点、窗口重新获得焦点、滚回视口都不读远程。**后台**只读「建立索引」的远程目录（整棵子树），每个目录距上次读取超过 `cache.remoteIndexIntervalMin`（30 分钟）才再读，每个目录之后休息 `cache.backgroundGapMs.remote`（500 ms）。检查 = 每次完整重新列出。远程条目的右键菜单隐藏「缓存策略」与「在资源管理器中显示」，保留「建立索引」。`CONN_AUTH_FAILED` / `CONN_HOST_KEY_*` / `CONN_SUDO_*` 等不算断开（显示错误行，不进入退避探测）；`FS_UNAVAILABLE` / 探测超时 → 断开，显示缓存与断开图标，退避探测（30 秒起翻倍、最长 5 分钟），探测即重连。`remoteOp` 的 `userAction`：P0 为 true（断线时连接池重连并重试一次），探测与后台为 false。
- **断线在树上的显示**（R21 / R22 / R24 I2，`offline-refresh.ts`）：远程目录没有定期确认，连接池发现断线（状态 `online → offline`）本身不会让树显示断开。因此**已建立的连接稳定存续超过一个保活周期（`remote.keepaliveSec`）之后因错误断开**时，主进程对该连接的远程条目根调用一次 `scanner.refresh`（每个连接 60 秒内最多一次，`OFFLINE_REFRESH_GAP_MS`）；读取失败后由扫描进程的退避探测负责重连。连接失败造成的 offline、短暂 online 后的断开都不触发（防止「认证成功后服务器立即断开」的服务器上形成无退避的重连循环）。实测（WSL Ubuntu，冻结 sshd 不关 TCP，无用户操作）：冻结后约 58 秒保活发现，约 78 秒树显示断开（再加一次 20 秒的连接超时）；之后 +108 秒、+128 秒为退避探测，全程 3 次拨号，无紧循环；解冻后下一次退避探测成功、树恢复。
- **访问范围**（设计 5.7，D10；M5 起同一机制也限制 UNC，见 15 节第 11 项）：`sftp:` URI 必须在某个工作区的远程 folder 条目之下，否则 `IPC_FORBIDDEN`——在 IPC handler（`vfs.*`、`doc.*`、`web.*`、`launcher.*`、`system.revealInOs` / `system.openPath`（M5 加入：二者之后经 `fileUriToLocalPath` 只接受 `file:`；范围外的 sftp URI 先在检查处以 `IPC_FORBIDDEN` 拒绝））与扫描进程 `remoteOp` 的入口检查（`vfs/remote-access.ts`；解码后含 `.` / `..` 段或 NUL 的路径一律拒绝），不放在 `VfsService`（`entry.add` 校验新条目时要对尚不是条目的 URI 调 `vfs.stat`）。远程 file 条目不提供（`entry.add` 拒绝，R14）；sftp 条目的身份必须为 null 或已登记在连接的 identities 中（`entry.add` 与 `pool.session` 都检查）。连接管理的通道按 connectionId 操作，不受此限。
- **界面**：活动栏「远程连接」视图（`features/connections`：列表、状态点、新建 / 编辑 / 删除 / 测试 / 重新连接 / 信任新的密钥；测试逐步显示连接 → 主机密钥 → 认证 → SFTP（home）→ 各身份（sftp-server 路径与方式「非终端 / 终端」），第一次 sudo 认证失败即停止）。资源管理器：「添加远程文件夹…」（连接、身份、路径；默认路径经 `connection.home`：登录用户为 `realpath('.')`，其他身份为 `/`，D8），远程条目用 `ServerIcon`；读取得到权限不足时状态行显示「无权限」，属主（SFTP `longname` 第 3 列，随列表进入缓存 `entries.owner`，D9）在连接登记的身份中时给出「以 <属主> 身份添加为条目」（不自动切换身份）。「复制路径」复制服务器上的绝对路径；地址栏 / 文件信息显示 `<连接名>:<路径>`（切换身份时 `<身份>@<连接名>:<路径>`）。远程文件只匹配兜底插件（office / html / markdown / text 的 manifest 声明 `schemes: ['file']`），兜底插件对非本地资源隐藏「用系统应用打开」「在资源管理器中显示」「作为文本查看」（SDK `fs.isLocal`）；渲染端对非 `file:` 资源不 sniff（D7）。
- **升级影响**：`pch.db` 迁移 0007（新增表，不改旧表）；`index.db` 的 `CACHE_VERSION` 5 → 6（`entries.owner`），**升级后首次启动删表重建整个 `index.db`，本地目录的缓存也全部重建**（重建完成前搜索只能查到已重新读取的目录）。
- **残余风险**（接受，记录）：
  - 交出 sudo 密码后恰好断线 → 判为 `CONN_SUDO_AUTH_FAILED` 锁定（误锁，需「重新连接」；R11）。
  - 已交出 sudo 密码后，非终端方式的 stdout 有输出或 stderr 出现 `su:` 行视为「已通过认证」，之后的失败降级为 `CONN_SUDO_FAILED`（不锁定，随断线清除，后台受 R10 记忆约束）——若这种迹象出现在密码错误的情形，错密码可能在用户操作时再交一次（R9-5）。
  - 交出登录密码后结果未定（超时 / 断开）→ 锁定（I1）：服务器认证慢于超时时，正确的密码也会被锁，需「重新连接」。
  - `keyboard-interactive` 不支持的提示形式（一轮多个提示、回显提示）在**尚未交出密码**时以 `CONN_AUTH_UNSUPPORTED` 中止，不锁定；连接池在内存中记住（状态 `auth-unsupported`，不写库、不跨重启）：后台请求不再拨号，用户操作过 30 秒冷却才重试一次，`disconnect` / 重新连接 / 成功连接清除。已交出密码之后才出现不支持的提示仍按 `CONN_AUTH_FAILED` 锁定（M5 K2 已改；此前一律按「认证失败」锁定）。
  - 进程表轮询中 `ps` 一时失败会提前结束轮询，已交出密码时按 R7 锁定（保守）。
- **限制**：只有 `sudo su - <身份>` 一种切换方式（sudo-rs 不支持 `requiretty` / `targetpw` / `logfile`，其 `requiretty` 场景不存在）；依赖服务器上的 `env` 与 `ps`（`ps -eo pid=,ppid=,comm=`）；`.ppk` 只支持 v2 RSA / DSA；`remote.cacheSizeMB` 暂无用途；非 UTF-8 文件名不支持（`ssh2` 按 UTF-8 编解码）；不支持堡垒机 / ProxyJump、ssh-agent / Pageant、证书 / Kerberos；密码只能保存（不提供「连接时询问」）；在命令通道上走 SFTP 借用 `ssh2` 1.17.0 的内部类（固定精确版本，`sftp-bridge.ts` 一处）；**产品代码不得用 `ssh2` 的 `utils.generateKeyPairSync` 生成 ed25519 密钥**（约 1/256 生成 31 字节公钥的畸形密钥，`knowledge/libraries.md`；只用于测试夹具时也要按根因检查输出，`testing/test-keys.ts`）。
- **验证**：单元 / 集成（进程内 `ssh2` Server 的假 SFTP 服务器 `modules/connection/testing/fake-sftp-server.ts`）、e2e（`e2e/connections.spec.ts`、`e2e/remote.spec.ts`，同一假服务器，`e2e/sftp-support.ts`）、WSL 4 个发行版的实机测试（`wsl.test.ts`，`PCH_WSL_SFTP=1` 才运行，README「WSL 实机测试」）。错误的登录 / sudo 密码各只记 1 次失败（4 个发行版的 journald 与传统 sudo 的 logfile 核对）；数字与未验证项见 `devDoc/2026-11-22-40-m4.md`。

---

## 8. 工作区与资源树

### 8.1 数据模型

工作区由用户自定义的「条目」构成一棵树。条目有三种：

| kind | 含义 | 子节点来源 |
|---|---|---|
| `group` | 虚拟分组（纯组织用途，如「設計書」「ログ」「本番環境」） | 用户放入的其他条目 |
| `folder` | 指向某个目录 URI 的根 | 懒加载，来自 VFS 真实列表 |
| `file` | 指向单个文件 URI | 无 |

远程连接配置是全局的（多个工作区可复用同一台服务器），条目通过 URI 中的 connectionId 引用。条目规则（已实现）：父节点只能是根或同一工作区的 `group`；folder / file 条目以本地路径（`path`）或 URI（`uri`，「固定」真实子项时使用）添加，二者恰好提供一个，目标必须存在且类型一致（`ENTRY_KIND_MISMATCH`），标签缺省为 `vfs.stat` 返回的显示名称；渲染端传入的路径先规范化（去首尾空白与一对双引号，要求绝对路径、拒绝 `C:foo` 这类盘符相对路径与单独的 `\\server`，否则 `FS_INVALID_URI`）；删除 group 时连同所有后代一起删除；`entry.add` 可带 `position`（`{ before: id }` / `{ after: id }`，参照条目必须与新条目同一父节点，否则 `ENTRY_INVALID_PARENT`）插在落点处，缺省追加到同级末尾，插入与移动都在同一事务内把同级的 `sort_order` 重排为 0..n-1；`rejectTemporary: true`（只有系统拖入设置）时，路径位于主进程注入的系统临时目录（`app.getPath('temp')`，按路径段比较、不区分大小写）之下则拒绝（`ENTRY_TEMPORARY_PATH`，先于 `stat` 检查；`%TEMP%2` 这类前缀相同的目录不受影响）；不能把 group 移到它自己的后代下。所有写操作各自在一个事务内完成（更新 / 移动 / 删除条目时在事务内读取条目），成功后广播 `workspace.changed`。

此外提供一个默认工作区（id 为 `default`，显示名称按语言为「默认」/「デフォルト」/「Default」，可改名、不可删除），用于不属于任何案件的常用目录。默认工作区的 `name` 为空字符串时显示本地化名称；把它改名为空字符串即「恢复默认名称」，其他工作区改名为空 → `WORKSPACE_NAME_REQUIRED`（已实现，M1-2）。「当前工作区」指用户当前正在使用的工作区：切换时记录 `last_opened_at`，取最大者，重启后回到上次使用的工作区。

工作区切换器（已实现，M1-2，`features/workspace`）：标题栏按钮显示当前工作区名称，下拉菜单含工作区列表（当前项打勾，选中即切换并关闭菜单）、新建工作区…、重命名当前工作区…、恢复默认名称（仅默认工作区且已改名时）、删除当前工作区…（默认工作区不显示）；欢迎页的「新建工作区」打开同一个对话框。新建 = `create` 后 `activate`（切换失败时提示「已创建但未能切换」并关闭对话框，避免再次提交重复创建）。**删除当前工作区时先切回默认工作区、成功后再删除**（`workspace-flows.ts` 的 `removeWorkspace(deps, targetId, activeId)`；目标在确认时已不是当前工作区——工作区一览中删除其他工作区、或对话框打开期间当前工作区变了——时直接删除、不切换；当前工作区未知（`workspace.active` 查询出错 / 尚无数据）时按「是当前工作区」处理、先切到默认。M2 反馈第 8 项）：主进程的 `workspace.delete` 不改变「当前工作区」，先删除会让 `last_opened_at` 最大的另一个工作区短暂成为当前工作区；切换失败则什么都不删。删除只删工作区与条目，确认框说明不会删除磁盘上的文件。重命名 / 删除对话框的目标在打开时锁定（工作区 id），对话框打开期间当前工作区变化（例如主进程事件）也只作用于打开时的工作区（最终审查 #51，e2e `workspace switcher: rename / delete dialogs act on the workspace they were opened for`）。

### 8.2 树的渲染

树节点 ID：条目节点为 `entry:{entryId}`；真实子节点为 `fs:{entryId}:{relativePath}`。渲染时把「当前展开的节点」拍平成一维数组，交给 @tanstack/react-virtual 虚拟滚动；真实目录的子节点通过 TanStack Query（key：`['vfs','list',uri]`）按需加载并缓存。展开状态存于 zustand，并作为会话快照的一部分持久化。

主要交互：

**拖放的原则：只管理自定义条目，绝不对真实文件做任何操作（移动、复制、删除、新建等）。** 拖放用浏览器原生拖放实现（与从系统拖入是同一套机制，不引入拖放库）。真实目录中的节点不接受放置；从应用拖到系统资源管理器也不会产生文件。

1. 从系统资源管理器拖入文件或文件夹：preload 的 `getPathForFile` 取得路径，stat 后创建 `file` 或 `folder` 条目（只新增条目，不复制文件）。
2. 将真实子目录或文件拖到工作区根部或某个分组：「固定」为新条目（按 URI 添加），适合把深层常用目录提到顶层；原文件不移动。
3. 拖动条目：调整同级顺序，或放进 / 移出分组（只修改条目的父节点与顺序）。
4. 右键菜单：打开、在新窗口打开、在资源管理器中显示、复制路径（路径 / URI 两种格式，方便贴进邮件和工单；映射盘符转换为 UNC 需要 `WNetGetConnectionW`，koffi 已引入、尚未实现）、新建分组、重命名条目、缓存策略、建立索引、移除条目（只移除条目，不删除真实文件，界面上明确说明）。**没有「用系统应用打开」**（2026-11-19 删除：应用本身不对文件系统产生影响；M1-3 起由标签中的 fallback 插件提供，9.4 节）。「打开」「在新窗口打开」随 M1-3 的标签实现。

**已实现（M1-2，`features/explorer`）**：

- **模型**（`tree-model.ts`，纯函数）：`buildVisibleNodes({ entries, expanded, directories, showHidden, offlineShares })` 把条目（按 `sort_order`；**根下未分组的条目在上、分组在下**，各自保持 `sort_order` 的顺序，M1-3b）与已展开目录的列表拍平为可见节点（条目节点带 `rank` = 同级按 `sort_order` 的序号，供拖放换算）；节点 id 为 `entry:<entryId>` 与 `fs:<entryId>:<相对路径>`（各段 `/` 连接），状态行为 `<父 id>#status`。真实子项可展开者（目录、指向目录的链接）优先，名称按 `Intl.Collator('ja', { numeric: true })` 排序（`第2章` 在 `第10章` 前）；`explorer.showHiddenFiles` 关闭时隐藏 `hidden` 字段为真的项（Windows 隐藏属性，由扫描进程枚举得到；降级模式按 `.` 开头判断）。节点类型：`group` / `folder` / `file` / `directory` / `link-directory`（可展开）/ `link-file` / `link-broken`（`target` 为 `null` 或缺失，不可展开）。需要列出的目录集合由 `resolveDirectoryUris` 求出：同时查 TanStack Query 缓存，已缓存的多层展开目录一次求出（避免每发现一层多渲染一次）。
- **渲染**：`@tanstack/react-virtual`（`estimateSize` 28、`measureElement` 实测行高，紧凑密度下行高随 `--spacing` 缩小，`overscan` 10），只渲染可见行（1 万项的目录 DOM 中约 30–40 行）。展开 / 选中状态存于 zustand（`explorer-store.ts`，按工作区区分，目前只在内存中，M3 起纳入会话快照）；切换工作区时树按 `workspaceId` 重新挂载，旧工作区的关注点随之清空（发送空 `vfs.interest`）。
- **状态行**：展开中的目录在加载中 / 出错 / 为空（过滤后）时产出一行状态行（展开的空分组也显示「没有项目」）。错误行显示 `errors:<code>` 文案（如「找不到文件或文件夹」「无法访问该位置」）与「重试」；**最近一次获取的错误优先于缓存中的旧列表**（TanStack Query 在重新获取失败时保留旧 data，若以 data 为先，展开中被删除的目录会一直显示旧列表）。「重试」= `vfs.refresh([uri])`（扫描进程立即检查该目录）+ 该目录查询失效（重新获取期间保留错误行，结果出来后替换，不显示加载中）；刷新按钮 / F5 = `vfs.refresh`（所有已展开目录）+ 让条目与所有目录列表失效（保留旧数据显示）。状态行可被选中（在错误行上按 Enter = 重试），但不可拖动、不接受放置、没有右键菜单、F2 / Delete 无效；「重试」按钮不在 Tab 顺序中（`tabIndex=-1`，鼠标按下不夺取焦点）。选中的状态行消失时选择回到其父节点；选中的节点被删除时停在原位置（钳制到末行）。
- **断开与缓存状态**（Task 8）：`reachability-store` 中有某共享 / 卷（`shareKeyOfUri`：UNC → `\\host\share` 小写，盘符 → `C:`，与主进程 `location.ts` 的 shareKey 同规则；比较不区分大小写，纯函数 `isShareOffline`）时，该共享上的根条目行尾显示 lucide `Unplug` 图标（`role="img"`，`aria-label` =「已断开」），其下的真实子项文字用 `text-muted-foreground`（节点的 `offline` / `dimmed` 标记）；目录显示缓存内容（`state` 为 `cached` / `offline`）时，行的 `title` 追加「最后更新：<本地化时间>」（`checkedAt`，节点的 `checkedAt` 字段）。映射盘的 share 值就是盘符，按盘符匹配根条目的 URI。
- **标题栏工具与分组抽屉**（M1-3b，设计 devDoc/2026-11-19-15 第 2.7 节）：
  - 资源树标题栏（`explorer-view.tsx`）在刷新按钮旁增加「定位到当前项」（lucide `LocateFixed`）与「全部折叠」（`ChevronsDownUp`），`aria-label` 与悬停提示为三语文案（`explorer:locate` / `explorer:collapseAll`）。定位 = 对激活标签的位置发出 `locate` 请求（与搜索结果的定位同一机制：展开祖先、选中、居中滚动、聚焦树，找不到时提示）；没有标签、工作区总览、条目之外的位置（`revealPath` 为 null）时按钮禁用。全部折叠 = 清空该工作区的展开集合（顶层分组也收起），**不清除选中**。
  - **分组抽屉**：根下的分组（`drawerIds(entries)`）同一时刻只展开一个：展开一个时其余顶层分组的展开标记被去掉，**子孙的展开记录保留**（纯函数 `toggleExpanded` / `expandNodes`，`explorer-store.ts`），重新展开时原样恢复；定位 / 同步的祖先链经过被收起的顶层分组时展开它并按同一规则收起其余分组。分组内的子分组按普通节点展开。抽屉标题为分节标题的外观（上边线、浅背景、粗体），仍是树的一行（↑↓ 遍历、→ ← / Enter 展开收起、`aria-expanded`）；**单击标题 = 展开 / 收起**（与箭头相同，不改变选中，双击不再切换回去）。
  - **被折叠挡住的选中**：选中项因祖先被折叠（抽屉互斥、全部折叠、单击收起抽屉）而不可见时，树把最近的可见祖先显示为选中，但不改写 store 中的选中（`hiddenSelectionIndex`，`selection.ts`）；重新展开后原来的选中项恢复。最近的可见祖先已展开、但其子项尚未加载（只有「加载中 / 出错」状态行——例如抽屉收起期间无观察者的目录查询被 TanStack Query 按 `gcTime` 回收，重新展开时重新列出）同样视为被挡住，加载完成后恢复（M1-3b 最终审查修复）。用户在其他行上的操作照常改变选中。显式折叠普通节点（箭头 / 双击 / ←）时选择仍移到被折叠的节点（M1-2 行为不变）。
  - **拖放与根下顺序**：显示顺序与 `sort_order` 不同，`resolveDrop` 按 `rank` 把落点换算为 `entry.move` 的 index；落在另一类条目的边缘（未分组条目落在分组的上 / 下缘、分组落在未分组条目之间）时，插在线之前最近的同类条目之后（没有时在线之后最近的同类条目之前），即未分组条目放到未分组区的相应端、分组放到分组区的相应端；新增（固定真实子项 / 系统拖入）同理改写 `position`。拖进被收起的分组时不展开它。
- **键盘与无障碍**：`role="tree"` 只有一个 Tab 停靠点（`aria-activedescendant`），行为 `treeitem`（`aria-level`、`aria-expanded`、`aria-selected`）；↑↓ 移动选择，→ 展开 / 进入首个子项，← 折叠 / 回到父项，Enter 展开或折叠，F2 重命名、Delete 移除（仅条目），F5 刷新（焦点在资源管理器视图内时）。树只处理自身获得焦点时的按键，行内控件上的按键交给控件。折叠时若选中项在其子孙中，选择移到被折叠的节点。M1-3b 起的打开方式与「树跟随标签」见 11.1 节「已实现」的资源树一条（目录单击不展开；双击 / 箭头 / → ← 展开折叠；键盘移动选中后 400ms 在当前标签打开；文件节点单击 / 停留为「文件信息」、双击 / Enter 为默认查看器）。
- **拖放**（`drag-drop.ts` 的纯函数 `resolveDrop` 决定动作，执行器只调用 `entry.move` / `entry.add`）：
  - dragstart **只设置自定义 MIME** `application/x-pch-node`（JSON），不设置 `text/uri-list`、`text/plain`、`DownloadURL`，`effectAllowed` 为 `move`（条目）/ `link`（真实子项）；拖出应用时没有任何目标能接受，不会生成文件。
  - 落点：行的上 25% 为 before、下 25% 为 after、中间且为分组时为 inside（非分组按 50% 分上下）；已展开且有可见子项的分组的 after 视为「放进该分组的第 0 位」（与画线位置一致）。真实节点、状态行、自身或自身的后代作为落点时 dragover 不 `preventDefault`（禁止光标，不触发 drop）。折叠的分组悬停时不自动展开。
  - 真实子项拖到根 / 分组 = 按 URI 添加（类型取自节点：目录与指向目录的链接为 folder）；新增条目按落点插入：before / after 插在目标条目之前 / 之后（与画线一致），展开分组的下缘插在第一个子项之前，inside 与空白处追加到末尾；系统拖入多个文件时按拖入顺序依次插在落点处（第一项用落点位置，之后每项插在上一项之后）。
  - **系统拖入只用 `copy` / `link`**：`dataTransfer.types` 含 `Files` 时视为系统来源，`dropEffect` 绝不设为 `move`（`move` 会让资源管理器把原文件移走）；`effectAllowed` 只允许 move 时不接受放置。路径经 preload 的 `getPathForFile` 取得，先按 folder 添加，`ENTRY_KIND_MISMATCH` 时改按 file。没有条目时的空状态也接受系统拖入（添加到根）。系统文件落在不接受的位置时不会导航到该文件：主防线是 Electron 的 `webPreferences.navigateOnDragDrop` 默认 `false`（`electron.d.ts`：「Whether dragging and dropping a file or link onto the page causes a navigation. Default is `false`.」，本项目未改动该选项），主进程的 `will-navigate` 拦截（`windows/security.ts`）是第二道防线。
  - 空状态的「添加文件夹」（系统对话框多选）与树空白处菜单一样经拖放的执行器逐项添加：某项失败只提示该项，其余项照常添加（最终审查 #29，e2e `empty state: adding several folders keeps going after one of them fails`）。
- **右键菜单**（Base UI ContextMenu；菜单项由纯函数 `menuItemsFor(node)` 决定）：

  | 节点 | 菜单项 |
  |---|---|
  | 分组 | 新建分组（子分组）、重命名 F2、移除 Del |
  | folder 条目 | 在资源管理器中显示、复制路径、复制 URI、缓存策略 ▸（跟随全局（当前值）/ 全部 / 积极 / 默认 / 消极，单选）、建立索引（勾选）、重命名、移除 |
  | file 条目 | 在资源管理器中显示、复制路径、复制 URI、重命名、移除 |
  | 真实子目录 | 在资源管理器中显示、复制路径、复制 URI、建立索引（勾选）、固定到工作区根部 |
  | 真实文件 / 指向目录或文件的链接 | 在资源管理器中显示、复制路径、复制 URI、固定到工作区根部 |
  | 失效链接 | 在资源管理器中显示、复制路径、复制 URI |
  | 树空白处 | 新建分组、添加文件夹…、添加文件…（系统对话框，添加到根） |

  缓存策略子菜单的「跟随全局（{{strategy}}）」显示该条目位置对应的全局默认值：UNC 为网络（`cache.strategy.network`），盘符为本地（`.local`）；**映射网络盘在渲染端无法识别（需要 `GetDriveTypeW`），显示按本地**，扫描进程仍按真实位置类型生效。单选项与勾选项都传 `closeOnClick`（Base UI 默认点击不关闭菜单）。条目的策略经 `entry.setCacheStrategy`（null = 跟随全局），「建立索引」经 `index.setTarget`，勾选状态来自 `index.list`（`data/entries.ts` 的 `useIndexTargets`，`workspace.changed` 后失效；节点 URI 与返回值按 `normalizeFileUri` 比较）。「建立索引」只用于 folder 条目与真实子目录（`directory`，不含指向目录的链接）。
  右键同时选中该节点；菜单与对话框关闭后焦点回到树。复制路径由渲染端把 file URI 转为 Windows 路径（`lib/file-uri.ts`，非 file URI 时不显示该项）后经 `system.copyText` 写入剪贴板。重命名 / 新建分组的对话框预填并全选名称；移除用 AlertDialog（默认焦点在「取消」），文案明确「只移除条目，不会删除磁盘上的文件或文件夹」（分组说明连同其下所有条目一起移除）。对话框打开期间条目已被删除：移除静默关闭（目标已达成），重命名提示错误后关闭。没有条目的工作区显示空状态，提供「添加文件夹」「新建分组」按钮。
- **已知限制 / 待需求方决定**：
  - **虚拟文件拖入**（已知限制）：从 zip 内的文件、Outlook 附件、浏览器中的图片等「虚拟文件」拖入时，副本由 Chromium 在浏览器进程中写入临时目录（我们接受放置之后、drop 时写出；dragover 阶段分不出是否为虚拟文件，应用自身不写任何文件），`getPathForFile` 返回该副本的路径。需求方的决定：只接受磁盘上持久存在的文件 / 目录。当前做法：系统拖入设置 `rejectTemporary`，主进程拒绝 `app.getPath('temp')` 之下的所有路径（`ENTRY_TEMPORARY_PATH`，提示「无法添加临时文件（例如压缩包内的文件），请先解压」）；副本仍由 Chromium 写入临时目录；同时意味着不能把 %TEMP% 下的目录经系统拖入固定为条目（对话框添加与「固定真实子项」不受限）。Chromium 副本目录的命名规律尚未实机确认，确认后可收窄为只拒绝该规律下的路径。
  - 按松手位置插入与拒绝临时文件（Task 9）已实现并有单元测试（`workspace.service.test.ts`、`drag-drop.test.ts`）与 e2e（真实子项按位置固定）；系统拖入的临时目录拒绝经 `rejectTemporary` 由单元测试覆盖，真实 zip 拖入需需求方实机确认。
  - 从系统资源管理器真实拖入未自动化（Playwright 无法产生带真实路径的系统拖放，合成的 File 经 `getPathForFile` 得到空字符串），只有 `resolveDrop` 的单元测试，需需求方手动确认。
  - 映射盘符转 UNC、用 Menu 键 / Shift+F10 打开所选节点的菜单尚未实现。

### 8.3 变更感知

不监听（2026-11-19 起不再使用 `fs.watch`，原因见 7.1 节）。目录列表缓存在扫描进程的 `index.db` 中，展开、选中、切回窗口时先显示缓存，扫描进程按「离关注点的远近」检查后，内容有差异才广播 `vfs.changed`，渲染端让对应 query 失效（读缓存，很快）。按资源类型：

| 资源 | 检查方式 |
|---|---|
| 本地磁盘 | 目录修改时间 + 枚举（koffi 原生枚举，只读句柄；目录的访问时间由系统按设置更新）；只有关注点每次完整枚举，其余先比较目录修改时间 |
| 网络路径：UNC、映射的网络盘（M1）（未挂载 SMB 已放弃） | 同本地；每台服务器同时 1 个后台检查 + 1 个用户动作；断开时显示缓存、按退避重试 |
| SFTP（M4 已实现，7.6 节；FTP 在「后续」） | 检查 = 每次完整重新列出（不比较目录修改时间）；**只在展开 / 选中 / 标签中新显示 / F5 与「建立索引」时读取**，没有关注点 / 近层 / 远层的定期确认、热点、聚焦 / 滚回视口的读取；每条 SSH 连接同时 1 个后台读取 + 1 个用户读取；断开时显示缓存、按退避重试 |

优先级与间隔（设计 8.2；设置键见 14.1 节）。缓存不设过期 / 失效时间，只在发现信息错误时更新或删除；三种来源并行：

- **P0 = 用户动作**（展开、选中、F5 / 刷新、窗口重新获得焦点时的关注点、滚回视口的已展开目录），立即，每次完整读取。
- **定期确认（关注点周边，按远近分三层）**：关注点 = 选中的目录（选中文件时为其目录）与标签中显示的目录（`vfs.interest` 的 `tabs`：激活标签显示的目录，M1-3），每次完整读取，`cache.interval.focus.*`（本地 5 秒 / 网络 10 秒）；标签中的目录只本身进入关注点层（任何策略下；不扩展近 / 远层与「积极」的范围；不在任何根之下的不参与），新出现时与切回窗口时同关注点一样立即确认（P0）；目录视图因此不显示「基于缓存（N 前）」（内容不变时不广播 `vfs.changed`，显示的时刻会越来越旧，9.4 节）；近 = 父、子、兄弟目录与视口内的已展开目录，`cache.interval.near.*`（30 秒 / 1 分钟）；远 = 祖父以上的祖先、叔伯（父目录的兄弟）、滚出视口的已展开目录、当前工作区各条目的根目录，`cache.interval.far.*`（2 分钟 / 5 分钟）。近 / 远先比较目录修改时间、变了才完整读取；同一目录取更近的层；目录的缓存策略取包含它的根中最高者，「消极」只有关注点一层，「默认」及以上三层。出错的目录（拒绝访问、超时）按远层的间隔重试。所有窗口失焦时暂停，重新获得焦点时立即确认关注点（P0）。**数量上限与最小间隔**：近层、远层各至多 100 个目录（`TIER_LIMIT`，每个窗口分别计算）——按离关注点的远近（目录树上的距离）取，同等距离时热点目录优先、再按 URI，近层中视口内可见的已展开目录最优先；超出上限的目录不做定期确认（在后台范围内时由后台队列 ④ 确认，「默认」策略下不在热点范围内的则要等它成为关注点、进入上限之内或被 P0 确认）。同一位置组（本地卷 / 网络主机）的近 / 远层确认之间至少间隔 `PERIODIC_GAP_MS`（网络 200ms，即不超过 5 次 / 秒；本地 50ms），关注点的确认不受此限；因此各层的间隔是**下限**：到期的目录多时依次推后。没有上限时，网络主机上的关注点有 2,000 / 5,000 个兄弟目录约为 33 / 84 次 stat / 秒，可饿死后台队列（最终审查的仿真）；加上限后 5,000 个兄弟目录的仿真（每次调用 100ms）稳态约 2.1 次 / 秒，后台队列照常推进（`scheduler.test.ts` 的 `many sibling directories`）。
- **后台队列（不分轮次）**：每个位置组（本地按卷、网络按主机）同时 1 个，每确认完一个先休息 `cache.backgroundGapMs.*`（本地 0.5 秒 / 网络 2 秒）；「用户正在操作」（最近 10 秒内任一窗口的关注点或可见范围有变化）时休息加倍；窗口失焦时照常。优先级：①「建立索引」子树内没有信息（`checked_at IS NULL`，从未尝试读取）的目录 → ② 策略范围内没有信息的目录 → ③ 热点目录（本身与子目录）中最久没确认的 → ④ 其余范围内最久没确认的。范围：消极 = 建立索引；默认 = + 热点；积极 = + 关注点上下 `cache.activeDepth` 层；全部 = + 根条目下所有目录。没有信息的完整读取，其余比较修改时间。读取失败的目录以失败时刻为确认时刻（`checked_at`），自然排到后面，不会被立即重选、饿死其他目录。**稳态**：已确认的目录在远层间隔之内不再由后台队列确认，所以范围内的目录数超过「远层间隔 ÷ 休息时间」（默认本地 120 秒 ÷ 0.5 秒 = 240 个、网络 300 秒 ÷ 2 秒 = 150 个）时后台队列永不空闲：每台网络主机约 0.5 次 / 秒、每个本地卷约 2 次 / 秒（再扣除读取时间；用户操作中减半），把范围确认一遍的周期 = 目录数 × 休息时间（例如 1 万个目录：本地约 83 分钟、网络约 5.6 小时）；目录数少于此值时确认完即休眠到最早一个目录重新符合条件。
- **发现过时就更新**（设计 8.3）：展开（`vfs.list`）、选中（关注点）、切回窗口、F5 / 重试、上面两种确认、从搜索结果定位失败（顺带确认出错的那一层目录，8.4 节）。一律只更新或删除出错的那一部分；目录不存在时连同子树的缓存一起删除，并从父目录的缓存列表中删除该项、通知父目录（父目录刚确认过、仍为 fresh 时，树与搜索也不再显示它；父目录列表中同名的是符号链接时保留，链接本身可能仍在）；这一删除只是推断（例如上级目录改名期间读取、随即改回，父目录的修改时间不变），所以同时让父目录的修改时间比较失效，并立即对父目录排一次完整读取（P0），以真实列表为准。父目录仍列出它、读取它却持续「不存在」时，只在第一次强制父目录，之后按远层间隔重试该目录本身（不循环）。
- **已知盲区（设计 8.5，需求方已接受）**：目录修改时间只反映直接子项的新建 / 删除 / 改名——子文件内容的变化、子目录中的变化不会改变它（本机 NTFS 实测）；工具把时间改回去（robocopy `/DCOPY:T`、rsync `-t`、解压、备份还原）、时间精度不足（FAT32 2 秒）时也会漏掉（未实测）。缓存不设过期，这类过时信息保留到该目录成为关注点、被 P0 确认（展开且查询失效或未缓存、滚回视口、切回窗口）或 F5 为止（`knowledge/windows-and-tooling.md`）。另一处发现时机的限制：「消极」根下的建立索引目标，若父目录从未被读过（缓存中没有它的行），读取得到「不存在」后按 URI 记住、不再尝试；之后它被建立，要等配置变化、P0 或扫描进程重启（记住的集合只在内存中）才会被发现。

实现取值（设计第 6 节留给实现者，常量在 `scanner/schedule/scheduler.ts`、`scanner/schedule/background-queue.ts` 与 `scanner/cache/cache.ts`）：同一目录的 P0 去重 2 秒（`P0_DEDUPE_MS`；显式刷新 `vfs.refresh` 不受此限，M1-3b），`vfs.list` 在 2 秒内确认过（任何优先级的检查）即为 `fresh` 且不再排 P0（`FRESH_MS`；定期确认发现变化 → `vfs.changed` → 渲染端重新列出时不会再多一次完整枚举）；「用户正在操作」的判定窗口 10 秒（`BUSY_MS`）；只比较修改时间的确认（后台队列）不推迟关注点的下一次完整读取。后台队列的候选（`BackgroundQueue`）：按位置组分别查询 `Cache.nextUnlisted` / `oldestChecked`，一次取一批（①②③ 各 `BATCH_SIZE` = 50 个，④ `OLDEST_BATCH_SIZE` = 200 个）在内存中逐个消费，用完或范围（关注点 / 策略 / 根 / 建立索引 / 热点）变化时重新取——不在内存中展开整棵树，每组至多约 250 个候选；①② 有候选时只取 ①②（没有信息的目录终会读完），③④ 同一批中先 ③ 后 ④（最初的理由是严格优先时热点永远是「最久没确认」、④ 会被饿死；加入「远层间隔内不重复确认」之后，严格优先也不再饿死 ④，现做法为一次查询取出两类候选、同一批中先 ③ 后 ④）；**已确认过的目录在该位置「远」层的间隔（`cache.interval.far.*`，本地 2 分钟 / 网络 5 分钟）之内不再由后台队列确认**（范围很小时不会反复读同一个目录）；消费时跳过正在进行、共享断开、未满这一间隔（含取出后被其他检查确认过）的目录；确认中发现列表变化（可能有新的没有信息的目录）时，正在消费「最久没确认」的组改取一批没有信息的；一批全部不可用时休眠到最早一个目录重新符合条件为止（期间不查询缓存；只因正在进行而跳过时 2 秒后再看；没有任何候选时等新的信息：列表变化、范围变化、共享恢复、配置变化）；范围的起点在缓存中还没有行时（父目录从未读过）由它开始，读取得到「不存在」的起点按 URI 记住、不再尝试，直到配置（根、建立索引目标、间隔）变化或该目录被 P0 / F5 确认存在。选择成本实测（30 万个目录行的合成数据、全部已确认、整卷范围；条件与数字见 `devDoc/2026-11-19-09-cache-strategy.md`）：平摊到每次选择（含写回确认时刻）内存库约 0.04ms（层数上限 3 或不限）/ 0.16ms（上限 1）；文件库约 0.2ms（上限 3 或不限），上限 1 时范围内只有 51 个目录、一批取不满，每次约 2ms，选完后休眠到远层间隔。单次查询最慢的是整卷且层数上限很小的 `oldestChecked`（文件库约 25–45ms），这正是要批量取候选的原因。热点目录取前 `HOT_K` = 20 个（后台范围为热点本身与子目录，`HOT_DEPTH` = 1），计分 = 每次访问 +1、按 3 天半衰期衰减（`HALF_LIFE_MS`）；本地合计同时最多 4 个检查（`LOCAL_LIMIT`）；近 / 远层各至多 `TIER_LIMIT` = 100 个目录（`scope.ts`），同一位置组的近 / 远层确认之间至少间隔 `PERIODIC_GAP_MS`（网络 200ms / 本地 50ms，`scheduler.ts`）；系统时钟回拨（确认时刻晚于现在）时按现在计算到期 / 可选时刻：定期确认的到期时刻不比一个间隔更远、位置组的休息与最小间隔不比其最长值更远、后台队列的休眠不比最长的等待更远（超过时重新取候选），确认时刻在「未来」的目录后台队列现在就可以确认（按现在计算的可选时刻每次都会往后推）；扫描进程的 libuv 线程池 16（`SCANNER_THREADPOOL_SIZE`）。

**已实现（2026-11-19，扫描引擎 Task 1–10；记录见 `devDoc/2026-11-19-06-refresh-cache.md`）**：扫描进程、缓存、范围、调度见 5.2 节；渲染端接口见 7.1 节。渲染端目录查询（`data/vfs.ts` 的 `directoryQuery`）为 `staleTime: Infinity`、`refetchOnWindowFocus: false`、没有轮询；`refetchOnMount` 保持默认（`staleTime` 为 Infinity 时只对已失效的查询生效：折叠期间收到 `vfs.changed` 的目录再次展开时重新列出）。`DirectoryState` 的 ready 状态带 `state`（fresh / cached / offline）与 `checkedAt`（断开图标、浅色显示与「最后更新」提示见 8.2 节）。手动刷新（工具栏按钮 / F5）与「重试」见 7.1 节的 `vfs.refresh`。条目级的缓存策略与「建立索引」的右键菜单、断开图标已实现（8.2 节，Task 8）。e2e：`cache: an expanded directory shows the cached listing first and the change after the next check`（`vfs.list` 先返回不含新文件的缓存、`state: 'cached'`，检查后树中出现新文件；展开中的目录按刷新间隔感知新建 / 删除）、`cache: a deleted entry directory shows not-found and recovers on retry after it is re-created`、`focus: refocusing the window does not show loading for a cached directory`、`collapse: …`、`workspace switch: …`、`menu: cache strategy and build index`、`offline: a root on an unreachable share shows the disconnected icon and its cached rows`（经主进程 `webContents.send('pch:event', …)` 注入 `vfs.reachability`，不新增产品 IPC）（e2e 启动后经 `settings.set` 把 `cache.interval.{focus,near,far}.local` 都设为下限 2 秒）；**原则回归** `principle: renaming an ancestor of an expanded directory succeeds`（展开 `案件\A\B\C` 并经过至少 2 个刷新间隔后，由测试进程把 `A` 改名为 `A2` 再改回，重复 10 次、间隔 300ms，全部成功；单次失败允许重试一次并记录。M1-2 的 `fs.watch` 下同样的操作会失败，见 19 节与 `knowledge/windows-and-tooling.md`）。性能记录（本机实测，本地 NTFS，1 万目录 / 10 万文件的合成树，「全部」策略，从空缓存开始、没有关注点）：第二版后台队列在默认休息 0.5 秒下稳定速率约 1.94 个目录 / 秒（每个约 514ms = 休息 + 约 14ms），**补满外推约 87 分钟**（运行 7 分钟后按速率外推），扫描进程约占单核 1.4%；休息设为下限 0.1 秒时**实测 18.9 分钟补满**（与同一外推方法的 1,132 秒一致），平均约占单核 5.8%，工作集从 86MB 到峰值 112MB（`devDoc/2026-11-19-09-cache-strategy.md`）。第一版（按轮次扫描、不休息）同一形状的树约 58 秒补满（`devDoc/2026-11-19-06-refresh-cache.md`）。`index.db` 的大小：编号化之后 `entries` 不再保存目录 URI，主键索引 `(dir_id, name)` 只存编号与名称。同一棵测量树（根在 scratchpad 的长路径下，目录名 `案件_0/設計書_0_0/資料_0_0_0`，1 万目录 / 11 万条目，平均 URI 204 字符；日文名称在 URI 中按 UTF-8 百分号编码，一个汉字 9 字节）：编号化前 75.19MB（`entries` 28.04MB + 主键索引 27.33MB），编号化后 23.45MB（`entries` 5.32MB + 主键索引 3.94MB，`dirs` 与其索引约 7.3MB，FTS 约 5.3MB），约为原来的 31%（`devDoc/2026-11-19-11-dir-id.md`）；真实应用中补满后的体积未验证。第一版（URI 为 77 字符的树）约 37MB（`devDoc/2026-11-19-09-cache-strategy.md`）。网络位置未测（没有可用的共享）。

### 8.4 文件名搜索

设计见 `devDoc/2026-11-19-02-search-design.md`（需求方尚未确认，按其第 6 节的控制者决定实现）。只在当前工作区的缓存（`index.db`）中按名称搜索，搜索时**不访问文件系统**、不触发扫描；能搜到的范围由各条目的缓存策略与「建立索引」决定（8.3 节）。

- 匹配：只匹配名称、不区分大小写（不做全角半角归一化）；空白分隔的多个词 = 全部包含（AND）；含 `*` / `?` 的词按通配匹配整个名称（`?` 匹配一个字符：正则以 `u` 标志编译，代理对字符如 `𠮷` 算一个，与 SQLite `GLOB` 一致）。解析与匹配规则只有一份：`packages/shared/src/search/query.ts`（`parseQuery` / `matchesName`，界面高亮用同一文件的 `matchRanges`）。
- 执行：扫描进程中查询（`scanner/search/search.ts`），主进程 `search.query` 组装范围并合并固定的单个文件条目（5.2、6.3 节）；结果上限 1000、`total` 计数到 10000；`indexedAt` 为范围内目录 `checked_at` 的最小值，`incomplete` 为范围内存在从未列出的目录。
- 界面（活动栏「搜索」视图，位于资源管理器之下；`Ctrl+Shift+F` 打开并聚焦搜索框，`Ctrl+F` 留给将来的预览窗口）：搜索框（防抖 150ms，Esc 清空）、类型筛选（全部 / 文件 / 文件夹）、摘要行「N 件 · 基于缓存（N 分钟前更新）」（`Intl.RelativeTimeFormat`，按界面语言，30 秒刷新一次）与「部分目录尚未扫描」、虚拟滚动的结果列表（两行：名称中匹配的片段 `<mark>` 高亮；「条目标签 › 父目录…」，行宽不够时省略中间部分、保留最后一级目录；悬停显示完整路径）。空输入时显示范围说明，无结果时显示「没有找到」与范围说明，截断时在底部显示「只显示前 1000 项」，扫描进程不可用（`INDEX_UNAVAILABLE`）时显示「搜索不可用」及原因。固定的单个文件条目的命中项没有缓存的大小 / 修改时间，界面不显示大小与时间。
- 键盘：搜索框 ↓ 进入结果列表；列表 ↑↓ / Home / End 移动，Enter 定位，Esc 回到搜索框。列表为 `listbox` + `aria-activedescendant`（一个 Tab 停靠点）；虚拟滚动只渲染视口附近的行，每行带 `aria-posinset` / `aria-setsize`（读屏读出「第 N 项，共 M 项」）。
- 结果操作（全部只读）：单击 / Enter = 在资源树中定位；右键菜单：在树中定位、在资源管理器中显示、复制路径、复制 URI。
- 在树中定位：搜索视图调用 `navigation-store` 的 `requestReveal(workspaceId, uri)` 并切到资源管理器视图（资源树在其他视图显示期间不挂载）；资源树挂载后取出请求（`consume()`；不是当前工作区的请求丢弃）：URI → 所属条目（固定的单个文件条目按 URI 完全一致优先，其余取 URI 前缀最长的 folder 条目，`isUnderUri`）→ 一次展开所有祖先（分组、条目、中间目录；树按层列出目录，已缓存的多层一次求出）→ 目标行出现后选中、`scrollToIndex`（居中）并聚焦树。某一层的列表已就绪却没有下一段（搜索结果显示之后缓存已被更正、目录被删除等）、或该层出错，停在已到达的最深一层并提示，同时让扫描进程顺带确认出错的那一层目录（设计 8.3；该层是目录时确认它自身，中间段已变成文件时确认它所在的目录，纯函数 `revealRecheckUri`；定位结束时的选中、确认与提示由纯函数 `settleReveal(nodes, progress, effects)` 执行，hook 注入副作用）；缓存过时、列表中仍有已不在的目标时，定位会先选中这一行，随后由展开时的 `vfs.list`（未在 2 秒内确认过则排 P0）与选中目录成为关注点（立即完整读取）更正，该行消失、之后的搜索不再出现它；某一层超过 10 秒（`REVEAL_LAYER_TIMEOUT_MS`）仍未就绪同样停下并提示；不在任何条目之下时提示「该项目不在当前工作区的条目中」。
- 状态保存：搜索框内容与类型筛选按工作区保存在 `features/search/search-store.ts`（只在内存中），切换侧栏视图后保留；切换工作区时搜索面板重建，不显示其他工作区的结果。

**已实现（2026-11-19，Task 11 后端 + Task 12 界面；记录见 `devDoc/2026-11-19-07-search.md`）**：以上全部。渲染端查询 key `['search', workspaceId, text, kind]`，`staleTime: 0`（切回搜索视图时重新查询），不随 `vfs.changed` 失效；每次查询用新的 requestId，TanStack Query 取消查询时以该 id 发送 `vfs.cancel`（12.1 节）。e2e：`search: typing shows matches from the cache and Enter reveals the row in the tree`、`search: kind filter`、`search: no results`、`search: Ctrl+Shift+F focuses the input`、`search: right-click a result to copy its path`、`search: virtualized result rows announce their position in the whole list`、`search: a stale search hit disappears after reveal`、`search: revealing a stale result warns and stops at its folder` 与整窗截图用例。未验证：`INDEX_UNAVAILABLE` 的界面（e2e 中无法让扫描进程不可用）、定位的 10 秒超时（只有单元测试覆盖进展判断）、系统级截图。

---

## 9. 预览插件体系

### 9.1 插件契约

```ts
// packages/plugin-sdk/src/index.ts
export interface PreviewPluginManifest {
  id: string;                          // 'pch.preview.image'
  name: string;                        // i18n key
  version: string;
  priority?: number;                   // 多个插件都能处理时的优先级
  match: {
    kinds?: Array<'file' | 'directory'>;
    extensions?: string[];             // ['png', 'jpg', 'webp']
    mimeTypes?: string[];              // ['image/*']
    schemes?: string[];                // 不填表示所有资源类型
    maxSize?: number;                  // 超过则不参与匹配（例如文本插件限制 50MB）
  };
  when?: (resource: ResourceInfo) => boolean;   // 声明式不够用时的补充判断
}

export interface PreviewPlugin<VS = unknown> {
  manifest: PreviewPluginManifest;
  i18n?: Record<string, Record<string, string>>;              // 插件自带的语言资源
  load: () => Promise<{ default: ComponentType<PreviewProps<VS>> }>;   // 懒加载，首屏不打包
}

export interface PreviewProps<VS> {
  resource: ResourceInfo;              // uri、name、kind、size、mtime、mime
  host: PreviewHost;
  viewState: VS | undefined;           // 会话恢复时传回
  onViewStateChange: (state: VS) => void;
}

export interface PreviewHost {
  fs: {
    stat(uri: string): Promise<FileStat>;
    list(uri: string): Promise<FileEntry[]>;
    readText(uri: string, opts?: { encoding?: 'auto' | string }): Promise<TextContent>;
    readBinary(uri: string, opts?: { maxBytes?: number }): Promise<ArrayBuffer>;
    toResourceUrl(uri: string): string;          // 转成 pcfs:// URL
  };
  tabs: { open(uri: string, opts?: { pluginId?: string; background?: boolean; newWindow?: boolean }): void };
  ui: { setTitle(title: string): void; setStatus(items: StatusItem[]): void; toast(msg: string, type?: ToastType): void };
  system: {
    revealInOs(uri: string): void;
    getLaunchCapabilities(uri: string): Promise<LaunchCapabilities>;   // 本机程序支持的打开方式
    launch(uri: string, mode: LaunchMode): Promise<void>;              // 只读 / 编辑 / 新建打开
  };
  i18n: { t(key: string, vars?: Record<string, unknown>): string; language: string };
  theme: { mode: 'light' | 'dark' };
  settings: { get<T>(key: string): T | undefined };   // 仅限插件自己的命名空间
}

export const definePreviewPlugin = <VS>(plugin: PreviewPlugin<VS>) => plugin;
```

**已实现（M1-3 MVP 契约，`packages/plugin-sdk/src/index.ts`）**：上面是目标形态，M1-3 实现其中的子集并有以下差异——
- `PreviewHost.fs`：`stat(uri)`、`list(uri): Promise<DirectoryListing>`（缓存优先的目录列表，与资源树共用查询缓存；目标形态中的 `FileEntry[]` 改为带 `state` / `checkedAt` 的 `DirectoryListing`，插件可显示「已断开」；所在共享在渲染端 `stores/reachability-store.ts` 中为断开时，宿主把 `state` 报告为 `offline`——断开之前取得、仍在查询缓存中的列表也按断开显示；目录不在了以 `FS_NOT_FOUND` 拒绝）、`subscribe(uri, onChange): () => void`（该目录的 `vfs.changed`）、`toDisplayPath(uri)`（file URI → Windows 路径，用于显示）；`readText` / `readBinary` / `toResourceUrl` 随 M2。
- `tabs`：`open(uri)`（在标签所属工作区新开，已打开则激活；M1-3b 起没有 `preview` 选项）、`navigate(uri, kind?)`（在当前标签打开：目录与文件都可以）；宿主经 `vfs.stat` 取得类型与标题，`navigate` 给出插件已知的类型（`'directory' | 'file'`，例如目录列表中的项）时不 stat，标题取 URI 的最后一段（最终审查修复）；`navigate` 进入标签的历史（11.1 节）。`up()`（M1-3b）：当前标签按**逻辑路径**到上一级，由宿主计算（`PreviewContainer` 用 `lib/logical-path.ts` 的 `parentLocation` 算出后注入，不 stat）——条目内逐级向上，条目根（含 file 条目）的上一级是工作区总览，不再越过条目根走到磁盘上的上级；已在总览时不做任何事。`onRefresh(listener): () => void`（M1-3b）：用户在应用的地址栏请求刷新本标签（刷新按钮 / 全局 `F5`）时回调，返回取消订阅函数；宿主经 `stores/tabs-store.ts` 的 `onTabRefresh(tabId)` 实现；它只是订阅。`pluginId` / `background` / `newWindow` 随 M3。
- `system`：`revealInOs(uri)`、`copyPath(uri)`（Windows 路径写剪贴板并提示）、`openWithSystem(uri)`（可执行类扩展名由宿主先弹确认框，9.4 节）；失败时宿主以 toast 提示错误码文案，Promise 不拒绝。`getLaunchCapabilities` / `launch` 随 Office（第 10 节）。
- `ui` 只有 `toast`（`setTitle` / `setStatus` 推迟）；`i18n.t` 查插件自带的语言资源（以插件 id 为 i18next 命名空间登记，键不含 `.`）；`settings.get` 只能读 SDK 中声明的 `HostSettings`（M1-3：`explorer.showHiddenFiles`），而不是「插件自己的命名空间」。
- `FileStat` / `FileEntry` / `DirectoryListing` 在 SDK 中重新声明（模块边界不允许 SDK 依赖 shared），与 `@pch/shared` 的同名类型结构相同，宿主实现把 shared 的值赋给 SDK 类型、不一致时编译失败。
- 新增 `AnyPreviewPlugin`（注册表的列表元素，各插件 viewState 类型不同）与常量 `FALLBACK_PLUGIN_ID`。
- **文本文档 `PreviewHost.doc`**（文本预览 Task 5，`packages/plugin-sdk/src/doc.ts`，7.5 节）：`open(uri, { encoding?, at? })`、`readLines(docId, start, count)`、`setEncoding(docId, encoding | null)`、`buildIndex(docId)`、`close(docId)`、`onProgress(docId, cb)`、`onChanged(docId, cb)`。类型 `DocumentInfo` / `DocLineBlock` / `DocProgress` / `DocEncoding` 在 SDK 中重新声明（与 shared 结构相同，渲染端 `doc-session.test.ts` 的类型测试保证；`DocLineBlock` 与 text-engine 的 `LineBlock` 同构，插件可直接交给 `decodeBlock`；SDK 不依赖 text-engine）。`DocChange` = `doc.changed` 的标志 + 变化之后的 `info?: DocumentInfo`（宿主刷新取得；没有变化时不回调）。**`reset` 到达时立即不带 info 通知一次**（插件马上丢弃已缓存的行、在 info 到达前不读取），刷新取得 info 后再带 info（仍含 `reset`）通知；刷新失败时 info 留到之后成功的刷新（最终审查修复：此前要等刷新应答，刷新失败期间新旧内容会混排）。**自动刷新由宿主负责**，插件不计时：标签是激活标签且窗口聚焦时，每个打开的文档每隔 `cache.interval.focus.local` / `.network` 秒（UNC 为网络，`isUncUri`；映射的网络驱动器按本地）`doc.refresh` 一次（上一次返回后才计时）；`missing`（文件不存在）后也按同样的间隔继续检查，日志轮转（改名后新建同名文件）时不按 F5 也会以 `reset` 回到新文件；地址栏刷新 / F5 立即刷新全部文档。**过期丢弃**：`reset` 到达、`setEncoding` / `buildIndex` 完成时文档代号递增，此前发出的 `readLines` 以 `DocStaleError`（SDK 导出，`code: 'DOC_STALE'`）拒绝，插件忽略即可。宿主实现 `features/preview/doc-session.ts`（`use-doc-session.ts` 让它在标签内容存续期间保持同一个对象：宿主随设置等重建时插件不必重新打开文档；卸载时关闭仍打开的文档，含之后才完成的 open），事件订阅 `data/doc.ts`，窗口焦点 `lib/window-focus.ts`。
- `tabs.viewWith(pluginId)` / `tabs.candidates()`（M2 Task 2 起取代 `tabs.viewAs` / `canViewAs` 与 `ViewAsMode`）：`candidates()` 返回可用于当前资源的查看器 `ViewerCandidate[] = { id, name（已按当前语言翻译）, current }`（顺序：按得分的匹配插件、文件另加文本插件 `TEXT_PLUGIN_ID = 'pch.preview.text'`、最后 fallback）；`viewWith(id)` 为当前标签的当前位置选择该查看器（写入 `TabState.viewer`，11.1），不在候选中时不做任何事。fallback 插件的「作为文本查看」在候选含文本插件时显示。`tabs.selectedViewer()`（M2 试用反馈）返回本标签当前位置用户选定的查看器 id（自动选择时为 null，调用时读最新状态）。
- `ResourceInfo.textLike?: boolean` 与 `match.textLike?: boolean`（Task 5）：见 9.3 节。
- `PreviewPluginManifest.handlesMissing?: boolean`（文本预览 Task 6）：插件自己处理「文件已不存在」。显示中的文件被删除、容器重新 stat 得到 `FS_NOT_FOUND`（且此前 stat 成功过）时，选中的插件声明了它就继续显示（资源描述为删除之前的，插件不重新挂载；同名文件重新出现时照常更新），否则显示「找不到」与「重试」（此前的行为）。文本插件声明它：日志被删除 / 轮转的间隙保留已显示的内容并提示。
- ~~插件调用宿主动作时预览标签转为常驻~~：M1-3b 取消「预览标签」（设计 `devDoc/2026-11-19-15-navigation-design.md` 2.8，需求方 2026-11-20 确认），宿主不再有「交互后转常驻」的逻辑；所有标签都是普通标签。
- `fs.refresh(uri): Promise<void>`（最终审查修复追加）：让宿主立即重新确认该目录（`vfs.refresh` 该目录，并让其目录查询失效），之后的 `list` 取得确认后的内容。M1-3b 起刷新的入口在应用的地址栏，插件经 `tabs.onRefresh` 收到请求后调用它。
- `fs.rootOf(uri): string | null`（M1-3 追加）：uri 所属的工作区 folder 条目的根（包含它的条目中 URI 最长者，`isUnderUri`），不在任何条目之下时为 null；`i18n.describeError(error)`（M1-3 追加）：宿主 API 拒绝时的错误（带 code）→ 应用的错误文案（`errors:<code>`），插件不必自带错误码文案。
- **浏览器视图 `PreviewHost.web`**（M2 Task 7，`packages/plugin-sdk/src/web.ts`；设计 `devDoc/2026-11-20-22-m2-design.md` 5.2）：`attach(element, uri, { view: 'page' | 'markdown' }): () => void`——让本标签的浏览器视图（主进程 `WebContentsView`，6.3 节）显示 uri 并贴在占位元素上，返回的解除函数只隐藏（标签关闭 / 当前位置不再用网页查看器时宿主销毁）；`onState(cb)`（`{ title, loading, failed }`，已有状态时立即回放一次；`failed` 为应用错误码，可交给 `describeError`）、`onNotice(cb)`（`'outOfScope' | 'download' | 'unsupported'`）、`reload()`（加载失败后的「再試行」；**简报之外追加**：SDK 原来没有让插件重新加载的入口）、`openExternal(uri)`（本地文件经 `system.openPath` 交给关联的应用；失败由宿主提示，不拒绝）。类型在 SDK 中重新声明（`WebViewKind`、`WebNotice`、`WebPageState`），与 shared 结构相同。插件只放占位元素，位置同步、导航、快捷键、刷新与截图替身都由宿主处理（12.1 节「已实现（M2 Task 7）」）。
- 依赖（控制者裁定）：内置插件除 `plugin-sdk` 与 `ui` 外，允许依赖 `lucide-react`（仅用于图标）与 `@tanstack/react-virtual`（虚拟滚动，版本与渲染端相同）。eslint 的模块边界规则只约束工作区内的包，不限制这两个外部包。

关键约束：插件**只能**通过 `PreviewHost` 与外界交互，拿不到 `window.pch`。这样主应用可以随时调整内部实现，而且将来把第三方插件放进沙箱 iframe 时，只需用 postMessage 实现同一个 `PreviewHost` 接口，插件代码不用改。

### 9.2 一个插件的样子

```ts
// plugins/preview-image/src/index.ts
export default definePreviewPlugin<{ zoom: number }>({
  manifest: {
    id: 'pch.preview.image',
    name: 'plugin.image.name',
    version: '1.0.0',
    match: { kinds: ['file'], mimeTypes: ['image/*'], extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
  },
  load: () => import('./image-preview'),
});
```

### 9.3 注册表与匹配规则

渲染端 `PreviewRegistry` 汇总所有插件，对一个资源计算得分：扩展名命中 3 分、MIME 精确命中 2 分、MIME 通配命中 1 分，再加上 `priority`；`when` 返回 false 或超出 `maxSize` 则排除。用户在「用其他方式打开」中选择后可勾选「始终对 .xxx 使用此方式」，写入设置 `preview.associations`，优先级最高。无任何插件匹配时落到 `pch.preview.fallback`。

`PreviewContainer` 为每个标签包一层 ErrorBoundary + Suspense：插件崩溃只影响自己的标签，并提供「用其他方式打开 / 用系统应用打开」的出口。

**已实现（M1-3）**（`features/preview/`）：
- 计分 `scoreResource(manifest, resource)`：kinds / schemes（不带冒号）不符、超过 `maxSize`、`when` 为 false → 不匹配；扩展名大小写不敏感、按「名称以 `.扩展名` 结尾」判断（支持 `tar.gz`）；声明了 `extensions` 或 `mimeTypes` 却一项都没命中 → 不匹配，都没声明 → 0 分（只按 kinds 等条件，例如 folder 插件）；命中的分数相加后加 `priority`。`pickPlugin`：得分最高者，同分取先注册的；fallback 插件不参与计分，没有任何匹配时返回它（列表中没有 fallback 时抛错）。`mime` 暂为 null；`preview.associations` 与「用其他方式打开」推迟。
- `PreviewContainer`（由 `app/` 经 `TabsArea.renderContent` 组合）：按 `tab.uri` 重建。**工作区总览**（`kind: 'workspace'`，M1-3b）不经插件，显示内置视图 `WorkspaceOverview`（11.1 节「已实现」）；**工作区一览**（`kind: 'workspaces'`，M2 反馈第 8 项）同样不经插件，显示 `app/` 传入的 `renderWorkspaces(tab)`。两者都会销毁该标签残留的浏览器视图。**目录标签不 stat**（最终审查修复）：直接用标签的类型与标题构造 `ResourceInfo`（大小 / 时间为 0，folder 插件不使用）交给插件，断开、无响应、被删除等状态都由插件的 `fs.list`（缓存优先）表现——此前先 stat，共享无响应时要等到 stat 超时（本地 5 秒 / 网络 10 秒）才显示错误页，缓存与「已断开」基本显示不出来，且每次切换标签都在主进程 stat 一次（占用 libuv 线程池，`knowledge/electron.md`）。**文件标签**先 `vfs.stat`（TanStack Query，新鲜期 5 秒——期间切换回标签不再 stat；错误优先于数据，失败时显示错误码文案与「重试」）得到 `ResourceInfo`（链接按 stat 跟随后的类型）；所在共享在 reachability-store 中为断开时不发 stat，只显示文件名与「已断开（重新连接后显示）」，恢复在线后自动 stat。「以文件信息显示」（fallback）对目录也先 stat。然后选插件；插件模块用缓存的 `plugin.load()` Promise + React `use()` 加载（每个插件只加载一次，失败的加载保持失败直到重新加载窗口），外层 `PluginErrorBoundary`（按插件 id 作 key）+ `Suspense`。插件渲染抛错或加载失败时只在该标签显示错误面板（插件名称、「以文件信息显示」切换为 fallback 插件；错误写入 main.log），其他标签与外壳不受影响。（M1-3b 起没有预览标签，宿主不再把标签「转常驻」。）可执行类文件的确认框（shadcn AlertDialog，初始焦点在「取消」）由容器渲染、宿主调用。
- **未匹配文件的 sniff**（文本预览 Task 5）：非空文件没有被任何非 fallback 插件匹配、且有插件声明了 `match.textLike` 时（`needsSniff`），容器先 `vfs.sniff`（显示加载中），结果在该标签的这个位置内缓存（`use-sniff.ts`）；`text` → 资源描述带 `textLike: true`，`scoreResource` 对声明了 `textLike` 的插件视为命中（0 分 + priority，kinds / schemes / maxSize / when 照常），`binary` / `empty` / 读取失败 → `textLike: false`（fallback）。空文件不 sniff（fallback）。
- **查看器选择**（M2 Task 2，取代 Task 5 的 `viewAs` 临时状态）：用户为某位置选的查看器是标签状态 `TabState.viewer`（插件 id，随位置进入历史，11.1）。`registry.ts`：`candidatesFor(plugins, resource)`（候选，同上）；`associationFor(name, associations)`（设置 `preview.associations`：扩展名 → 插件 id，取最长扩展名、大小写不敏感）；`resolvePlugin(plugins, resource, { viewer, associations })`：viewer 在候选中 → 它；否则关联在候选中 → 它；否则 `pickPlugin`。不在候选中的 viewer / 关联被忽略。`PreviewContainer` 选了 viewer 时不 sniff。错误面板的「以文件信息显示」设置 viewer 为 fallback；目录选了 viewer 时才 stat（没选时不 stat）。
- e2e 的崩溃插件：`features/preview/plugins.ts` 的 `previewPlugins(builtin)` 在 bootstrap 的 `e2eCrashPlugin` 为 true 时追加两个测试插件（`.crash` 渲染时抛错、`.crashload` 懒加载失败）；主进程只在**未打包**且环境变量 `PCH_E2E_CRASH_PLUGIN=1` 时设置该标志（与 `PCH_USER_DATA_DIR` 相同的限制），打包后的应用不会注册它们。

### 9.4 内置插件

| 插件 | 处理对象 | 说明 |
|---|---|---|
| folder | 所有目录 | 列表 / 网格 / 详细信息视图，排序、筛选；viewState 保存视图模式与滚动位置（M1-3：详细信息列表、排序，viewState 只保存排序；M1-3b 最终审查修复起 viewState 保存排序、选中项与滚动位置；路径与「上一级」M1-3b 起由应用的地址栏提供） |
| text | 文本、代码、日志、CSV、bat、ini 等 | 自绘分页视图（任意大小立即打开、只渲染可见行），只读，编码切换，日志跟随末尾（文本预览设计 `devDoc/2026-11-20-18-text-preview-design.md`；CodeMirror 6 改为将来「编辑 / 高亮」的候选） |
| markdown | .md / .markdown / .mdown / .mkd（5MB 以下） | 本标签的浏览器视图中由应用自带的查看脚本渲染（M2 Task 8 已实现，见下）；源码经地址栏的查看器下拉切换为文本 |
| html（浏览器显示） | .html / .htm / .xhtml，以及浏览器能直接显示的 .pdf 与常见图片 | 本标签的浏览器视图（M2 Task 7 已实现，见下） |
| image | 常见图片 | 缩放、适应窗口（M2 起先由 html 插件经 Chromium 的图片文档显示；专用插件推迟） |
| pdf | .pdf | pdf.js，页码与缩放进 viewState（M2 起先由 html 插件经 Chromium 内置 PDF 查看器显示；专用插件推迟） |
| media | 音视频 | 原生播放器，依赖 pcfs 的 Range 支持 |
| office | Excel / Word / PowerPoint 等（扩展名固定在 manifest） | 不渲染内容，显示启动面板：按检测结果（`options` 的顺序）显示 読み取り専用 / 編集 / 新規作成 / 保護ビュー 按钮；已实现（M2 Task 10），见 10.6 |
| fallback | 其他 | 文件信息 + 用系统默认程序打开 |

需求方决定（2026-11-19）：**资源树只用于展示，对文件的操作都放在将来的预览窗口中**。上表与 9.3 节中「用系统应用打开」「只读 / 编辑 / 新建打开」等打开动作只由预览窗口（标签中的插件）提供，资源树的右键菜单不提供（`system.openPath` 于 2026-11-19 删除，M1-3 恢复为只由预览插件的宿主调用）。

**已实现（M1-3）：folder**（`plugins/builtin/src/folder/`，`match.kinds = ['directory']`）：没有工具栏（M1-3b：面包屑、「上一级」与「刷新」按钮都由应用的地址栏取代，12.2 节）。列表（`role="grid"`）：列为名称（图标区分目录 / 文件 / 链接 / 失效链接）、修改时间（`dateStyle`/`timeStyle` short，按界面语言）、类型（文件夹 / 「扩展名大写 + 文件」/ 链接类型）、大小（1024 进位，目录与失效链接不显示）；点击列头排序（同一列再点反转，`aria-sort`），目录与指向目录的链接始终在前，名称按 `Intl.Collator('ja', { numeric: true })`，其他列相等时按名称升序；排序、选中项（`selectedUri`）与滚动位置（`scrollTop`，滚动停止 150ms 后保存）存于标签的 viewState（只在内存中；同一标签内导航到新位置时 `layoutReducer` 清除，回到按名称升序；**后退 / 前进回到该目录时恢复**——视图按 URI 重建，选中取 viewState 的初值，列表首次就绪时滚到保存的位置，M1-3b 最终审查修复）。`@tanstack/react-virtual` 虚拟滚动（行高 28、`measureElement`、overscan 10；1 万项的目录 DOM 中的行数 ≤ 100，e2e 断言）。「显示隐藏文件」从 `host.settings.get` 读取，打开时隐藏项名称变淡。交互：单击只选中；双击 / Enter 在当前标签打开（M1-3b 设计 2.8）——目录与指向目录的链接 `host.tabs.navigate(uri, 'directory')`，普通文件 `host.tabs.navigate(uri, 'file')`（不 stat），指向文件的链接与失效链接 `host.tabs.navigate(uri)`（宿主 stat；失效时提示错误、标签不变），都进入标签的历史，「后退」回到目录列表；中键 / Ctrl+单击 / Ctrl+Enter 在新标签打开（`host.tabs.open(uri)`，同 URI 已打开则只激活；目录视图的行没有右键菜单，「在新标签页中打开」只在资源树）；Backspace / Alt+↑ 经 `host.tabs.up()` 到逻辑路径的上一级（条目根之上是工作区总览）；↑↓ / PageUp / PageDown / Home / End 移动选中；在标签内导航后焦点回到列表。刷新：地址栏的刷新按钮与全局 `F5`（M1-3b；此前是视图工具栏的按钮与视图内的 `F5`，已删除以免重复触发）经 `host.tabs.onRefresh` 通知插件，插件经 `host.fs.refresh` 让扫描进程立即确认该目录并重新列出，期间保留当前内容（最终审查修复）；刷新（`vfs.refresh` → `scheduler.refresh`）**绕过 P0 的 2 秒去重**（M1-3b 审查修复：此前刚列出后 2 秒内刷新会被静默丢掉），也不与正在执行的 P0 合并，已在排队的仍合并（连按 F5 不重复排队）。**条目之外的目录**（M1-3b 起「上一级」不再越过条目根，界面上已无法到达；保留给旧数据与将来的定位）不进缓存、不在调度范围内，没有 `vfs.changed`，外部变化不会自动显示，要用「刷新」；降级模式（扫描进程不可用、主进程直接枚举）下同样只能刷新。数据：`host.fs.list`（缓存优先）+ `host.fs.subscribe`（该目录的 `vfs.changed` 时重新列出，期间保留当前内容）；出错时显示错误文案（`host.i18n.describeError`）与「重试」，错误优先于旧内容。导航（双击目录）经 `host.tabs.navigate(uri, 'directory')`，宿主不 stat；上一级经 `host.tabs.up()`。**标签中显示的目录被删除**（最终审查修复）：不再依赖 stat——扫描进程在删除某目录的缓存时（读取得到「不存在」、被替换为文件，或父目录的列表中它已消失），除父目录外还对按关注点处理的目录（各窗口的选中目录与标签中的目录）中等于它或在其之下者各发一次 `vfs.changed`（`scheduler.ts` 的 `notifyRemoved`；之后再读取失败不再通知，不会循环），目录视图据此重新列出，`fs.list` 以 `FS_NOT_FOUND` 拒绝，显示「找不到」与「重试」（e2e 断言）。状态行：项目数、「已断开（基于缓存）」（`fs.list` 的 `state` 为 offline：扫描进程判定断开，或渲染端的可达状态为断开；可达状态变化时宿主重建、视图重新列出，显示中的目录随之切换）、读取中；**不显示「基于缓存（N 前）」**（控制者裁定）：检查后内容没有变化时扫描进程不广播 `vfs.changed`，列表的 `checkedAt` 不会更新，「N 前」会越来越旧，而该目录作为关注点实际每 5 秒都确认过，显示出来会误导用户（资源树的悬停提示「上次检查」保持不变）。

**已实现（M1-3）：fallback**（`plugins/builtin/src/fallback/`）：名称、位置（Windows 路径）、类型、大小（1024 进位单位 + 精确字节数，目录不显示）、修改时间（含秒，按界面语言），动作「用系统应用打开」「在资源管理器中显示」「复制路径」。目录由 folder 插件显示（fallback 只在「以文件信息显示」时显示目录）。「用系统应用打开」对可执行类扩展名（`.exe .com .bat .cmd .ps1 .vbs .vbe .js .jse .wsf .wsh .msi .msc .scr .lnk .reg .hta .cpl`，审查时追加 `.pif .scf .msp .jar .appref-ms`，最终审查追加 `.url .website .application .inf .chm .settingcontent-ms .psm1 .psd1 .ps1xml .ws .wsc .sct .vb .appinstaller .msix .appx .xll .diagcab .library-ms .search-ms .gadget`——只增加确认、不阻止打开，需求方可裁剪；大小写不敏感；NTFS 备用数据流的名称（`run.bat::$DATA`、`run.bat:stream`）按第一个 `:` 之前的文件名判断；判断前去掉名称末尾的点与空格——Windows 打开路径时会去掉它们）先弹确认框，取消（按钮 / Esc）时不调用 `system.openPath`。文件且 `host.tabs.candidates()` 含文本插件时另有「作为文本查看」按钮（文本预览 Task 5；文本插件注册之前不显示）。文件的「この種類のファイルはプレビューできません。」只在自动选择到 fallback 时显示；用户选定「文件信息」（资源树单击、查看器菜单，`host.tabs.selectedViewer()` 为 fallback）时不显示（M2 试用反馈）。

**已实现（文本预览 Task 6）：text**（`plugins/builtin/src/text/`，id `pch.preview.text`）：`match = { kinds: ['file'], extensions: [txt log out md csv tsv json jsonc xml yaml yml ini conf cfg properties toml sql env gitignore editorconfig sh bat cmd ps1 psm1 js ts tsx jsx mjs cjs py java kt c h cc cpp hpp cs go rs rb php html htm css scss less vue svelte gradle], textLike: true }`（扩展名表之外、容器 sniff 为文本的文件也交给它），`handlesMissing: true`。经 `host.doc` 读取（7.5 节），不用浏览器原生滚动高度：
- **视图**（`text-view.tsx` 布局与键鼠）：固定行高 20px，视口只渲染从 `top` 起的可见行（`visible + 1` 行）；行号栏（`gutter.tsx`，宽度按总行数的位数；**部分模式不显示**）、文本（`lines.tsx`，等宽字体 `font-mono`，不换行，横向由该元素原生滚动，`←` / `→` 也可横向移动；截断行末尾显示「…（行が長すぎるため省略）」）、自绘纵向滚动条（`scrollbar.tsx`，`role="scrollbar"`；拇指按 `@pch/text-engine` 的 `pager-model` 缩放，最小 20px，拖动按位置换算行号，点击轨道翻页）。移动：滚轮（纵向按 px / 行高换算，`Shift` / 横向交给原生横向滚动）、拖动、`↑` / `↓`、`PageUp` / `PageDown`（可见行数 − 1）、`Ctrl+Home` / `Ctrl+End`。可见范围内用浏览器原生选择与复制；跨屏选择不支持。
- **读取**（`use-visible-lines.ts` + `block-cache.ts` + `decode-lines.ts`）：块缓存按 1000 行一块、块内稀疏，LRU，按解码后的字符数 + 每行固定开销 16 设上限（2000 万；只按字符数时大量空行几乎不占额度，最终审查修复）；可见范围中缺的行按块请求（每块同时只有一个请求，同时在途 ≤ 4，从块中第一个缺的行到块尾，`readLines` ≤ 2000 行），未到的行显示占位「…」；应答到达时块已离开视口附近（前后各一块以外）则丢弃；`DocStaleError` 忽略，其他失败的块在行数 / epoch 改变之前不再请求（状态栏显示错误；错误属于当时的缓存，epoch 改变后不再显示）。解码用 `decodeBlock`（只对从第 0 行开始的块跳过 BOM），每行显示上限 10,000 字符（超过时截断并标记）。索引变化（行数、complete 或 `indexedTo`）而此前索引已完成时，原来的最后一行可能被追加延长：从它起丢弃（丢弃时在途的应答也不写回；`index-change.ts`，纯函数。只看行数与 complete 不够：追加的内容没有换行且中间状态被 React 批处理掉时两者前后相同，末行会一直停在旧内容——最终审查修复）。
- **文档**（`use-document.ts`）：挂载时 `host.doc.open(uri, { at, encoding? })`、卸载时 `close`；`onProgress` 更新行数与索引进度，`onChanged` 带来新的 `info`——`reset` 时 epoch 递增（换新的缓存，按跟随状态定位：跟随则在末尾，否则保持 `top`；宿主先不带 info 立即转达 reset，此时 epoch 先递增、`awaitingInfo` 期间不读取行、显示占位，info 到达后再读取），`appended` 时若跟随则保持在末尾，`missing` 时工具栏下显示「ファイルが存在しません。以前の内容を表示しています」并保留已缓存内容（同名文件重新出现时为 `reset`，提示消失）。切换编码（`setEncoding`）与「读取全部」（`buildIndex`）的结果同样替换 `info` 并递增 epoch；失败时 toast。自动刷新与 F5 由宿主负责，插件不计时。
- **位置与跟随**（`view-position.ts`，纯函数）：`effectiveTop` = 跟随时 `maxTop`，否则限制在范围内的 `top`；向上移动关闭跟随；**日志类**（`log-like.ts`：`.log` / `.out`、`*.log.<数字>` / `*.log.<日期>`、sniff 判为文本的无扩展名文件）打开时 `at: 'end'` 并跟随，移动到末尾时自动开启跟随；其他文件打开在开头（`at: 'start'`），只有工具栏的切换按钮开启跟随。
- **工具栏**（`toolbar.tsx`）：先頭へ / 末尾へ / 末尾を追従（`aria-pressed`）。**状态栏**（`status-bar.tsx`）：编码下拉（`DropdownMenu` 的单选：自動判別 + UTF-8 / UTF-16 LE / UTF-16 BE / Shift_JIS / EUC-JP / ISO-2022-JP / GB18030 (GBK) / Big5 / Windows-1252；按钮显示「Shift_JIS（自動）」或手动选择的名称）、提示（`confidence: 'guess'` →「文字コードは推定です」、可见行含 U+FFFD →「文字化けしている可能性があります」、`binary` →「バイナリファイルをテキストとして表示しています」、可见行有截断 →「長すぎる行は途中までしか表示していません」、索引 / 读取错误——都经 `describeError` 显示错误码对应的三语文案，索引失败为「読み込みに失敗しました（<文案>）。更新で再試行します」，不直接显示错误码；`describeError` 也接受错误码本身（`DocProgress.error`），最终审查修复）、行数（索引中为「行を数えています N%（M 行）」）、大小（1024 进位）；部分模式为「先頭 / 末尾 4 MB のみ表示（全体 N）」+「すべて読み込む」（`buildIndex`，之后显示行号；位置按 `view-position.ts` 的 `afterReadAll` 换算：部分模式的 `top` 是窗口内行号，开头窗口起点在第 0 行、不变，末尾窗口起点在全量索引中的行号无法得知，未跟随时跳到末尾并跟随，最终审查修复——此前窗口内行号被当作绝对行号，末尾窗口读取全部后跳到文件开头附近）。
- **viewState**（`view-state.ts`）：`{ top, encoding?, follow }`（移动停止 150ms 后保存；**卸载时防抖中的状态立即保存**——宿主的 `onViewStateChange` 带上该视图的位置（`setViewState(tabId, state, uri)`），标签已导航离开时 `layoutReducer` 把它写入刚离开的历史项而不是新位置，最终审查修复；后退 / 前进恢复，手动编码以 `open` 的 `encoding` 恢复）。
- e2e（`e2e/text.spec.ts`）：10 万行日志打开在末尾（最后一行与行号）、`Ctrl+Home`、拖动滚动条到中间（行号与内容一致）；外部追加 3 行 → 跟随显示；轮转 → 重新加载、删除 →「ファイルが存在しません」并保留内容；约 200MB 文件（全量模式；50MB 在磁盘缓存下可能在显示进度前就索引完）索引进行中改名该文件成功（改名后状态栏出现「読み込みに失敗しました（ファイルまたはフォルダーが見つかりません）…」，证明改名确实发生在索引进行中，且显示的是文案而不是错误码）、上级目录 2 秒内可改名、索引完成后上级目录一次改名成功；删除后读取失败的错误在同名空文件出现（reset）后消失；移动后立即导航离开、后退时位置恢复；末尾窗口「すべて読み込む」后在整个文件的末尾；Shift_JIS / EUC-JP / GBK / Big5 / UTF-16 LE·BE / ISO-2022-JP / Windows-1252 样本显示正确（Chromium 的 `TextDecoder` 支持这些标签）与手动切换；无扩展名文本按文本打开；PNG → 文件信息 →「テキストとして表示」；20MB 单行 → 截断提示、界面可操作；降低 `preview.maxTextSizeMB` → 部分模式 →「すべて読み込む」后显示行号。

**已实现（M2 Task 7）：html**（`plugins/builtin/src/html/`，id `pch.preview.html`，名称「ブラウザー表示 / 浏览器显示 / Browser view」）：`match = { kinds: ['file'], extensions: [html htm xhtml pdf png jpg jpeg gif webp svg bmp] }`、`priority: 1`（与文本插件的 html / htm 同为扩展名 3 分时胜出，文本仍在候选中，可经地址栏的查看器下拉切换）；图片与 PDF 依据先行验证 S3（Chromium 的图片文档与内置 PDF 查看器，不需要 `plugins: true`；e2e 覆盖 png / svg / pdf，其余图片格式未逐一验证）。注册顺序 folder、html、markdown、（office）、text、fallback。界面：占位元素（`host.web.attach(el, uri, { view: 'page' })`）+ 一行状态（页面标题、読み込み中、加载失败时 `describeError(failed)` 与「再試行」、被阻止的动作的提示停留 5 秒、「システムのブラウザーで開く」）。加载失败时解除占位（视图隐藏），此时地址栏刷新 / F5 由插件经 `tabs.onRefresh` 调 `web.reload()`。viewState 无（页面状态由视图保活，跨历史项不恢复）。e2e：`e2e/web.spec.ts`（相对 CSS / 图片 / 脚本、链接到 HTML / Markdown / 外网 / 范围外 `file:` / 其他范围、切换标签后页面不重新加载、焦点在页面时 F5 与 Ctrl+W、下拉 / toast 时的截图替身、图片与 PDF）。

**已实现（M2 Task 8）：markdown**（`plugins/builtin/src/markdown/`，id `pch.preview.markdown`，名称「Markdown 表示 / Markdown 显示 / Markdown」）：`match = { kinds: ['file'], extensions: [md markdown mdown mkd], maxSize: 5MB }`、`priority: 1`（与文本插件的 md 同为扩展名 3 分时胜出；超过 5MB 不参与匹配，落到文本）。界面与 html 插件共用 `plugins/builtin/src/web-page/`（`WebPagePreview({ view, external? })` 与共用文案 `webPageMessages(name)`；eslint 元素 `plugin-web-page`，只依赖 plugin-sdk / ui，只允许 html / markdown 插件引用）：占位元素（`host.web.attach(el, uri, { view: 'markdown' })`）+ 一行状态，**没有**「システムのブラウザーで開く」（html 插件传 `external`）。渲染（设计 devDoc/2026-11-20-22-m2-design.md 5.4）：
- 主进程 attach 时视图地址为 `toWebUrl(uri) + '?pch-view=markdown'`，协议处理器返回外壳页（`<meta charset="utf-8">`、`<meta name="color-scheme" content="light dark">`、`<link rel="stylesheet" href="pch-asset://viewer/markdown.css">`、`<article id="content" class="markdown-body">`、`<script type="module" src="pch-asset://viewer/markdown.js">`），文档 URL 就是 .md 本身，相对路径的图片与链接按它解析。
- **查看脚本**（`apps/desktop/src/web-assets/markdown/`，eslint 元素 `web-asset`：只能依赖 `text-engine` 与外部包）：`main.ts` 同源 `fetch(location.pathname + '?pch-raw=1')` → `decodeMarkdown`（`render.ts`：`sampleRanges` 取样 + `detectEncoding` + `TextDecoder`，跳过 BOM；Shift_JIS 等与文本查看器同样的判断）→ `renderMarkdown`（unified：remark-parse → remark-gfm → remark-rehype `allowDangerousHtml` → rehype-slug → rehype-stringify `allowDangerousHtml`；脚注 id 带 remark-rehype 默认的 `user-content-` 前缀，标题 id 不带前缀，`[見出し](#見出し)` 可用）→ `innerHTML` 插入 → `document.title` = 第一个 h1（没有时为文件名；状态行显示）→ 地址带片段时滚动到该元素 → `renderMermaidBlocks`（`mermaid.ts`：有 `pre > code.language-mermaid` 时才 `import('mermaid')`，`securityLevel: 'strict'`、`suppressErrorRendering: true`，主题 `default` / `dark`；单个图失败时原位置显示错误信息与源码）。浅色 / 深色：`markdown.css` 与 mermaid 主题都按 `prefers-color-scheme`（视图跟随 `nativeTheme.themeSource`，台账 S2），主题切换时按新主题重新渲染 mermaid（保持滚动位置），不重新加载页面。
- **安全**：外壳的 CSP 为 `default-src 'self' https: data:; script-src pch-asset:; style-src 'self' 'unsafe-inline' http: https: pch-asset:; img-src 'self' http: https: data: blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`（设计 5.4 的原值 + img-src / style-src 的 `http:`：控制者裁定，内网系统常为 http，Markdown 引用的内网图片与样式应能显示，脚本仍只允许 `pch-asset:`；mermaid 12 实测不需要 `unsafe-eval`，SVG 内的 `<style>` 与 style 属性由 `'unsafe-inline'` 放行）。`frame-src 'none'`（审查第 1 轮）：不限制时 frame-src 落到 default-src，Markdown 中的 `<iframe src="./x.html">` 会加载同源的本地 HTML（无 CSP，脚本执行并可操作外壳页，e2e 实测）、data: 框架中的脚本也会运行；mermaid 的 `securityLevel: 'strict'` 不用 iframe。`base-uri` / `form-action` 同样禁止。Markdown 中的原始 HTML 原样输出：`innerHTML` 插入的 `<script>` 不执行，`onerror=` 等内联处理器被 CSP 阻止、iframe 不加载（e2e 断言标题未被改动；视图控制台中是 CSP 违规的报错，由 scratchpad 脚本核实）。
- **构建**：单独的 vite 构建 `apps/desktop/vite.markdown.config.ts`（台账 S9 方案 B；`root` = 查看脚本目录、`base: './'`、产物 `out/web-assets/markdown/{markdown.js, markdown.css, chunks/*.js}`），`build` 脚本为 `pnpm typecheck && electron-vite build && vite build -c vite.markdown.config.ts`；`electron-builder.yml` 排除该配置文件。开发模式不需要预先构建：renderer 的 `optimizeDeps.entries` 加入查看脚本的 `main.ts`（否则首次打开 Markdown 时 dev server 才发现 unified / mermaid、重新预构建并重新加载整个应用窗口，实测）。
- 链接与 HTML 相同（5.3.6）：`./other.md` 在本标签以 Markdown 打开（同一插件 → 同一个视图），`./spec.xlsx` 等交给应用按查看器规则显示，脚注与标题锚点是页内导航，页面自己处理。从 HTML 页面到 Markdown（查看器不同）按 Task 7 的规则销毁旧视图、新建视图。
- e2e：`e2e/web.spec.ts`「Markdown renders in the browser view…」（表格、相对图片、mermaid 生成 svg 与失败块显示源码、`<script>` / `onerror=` 不改动标题、脚注链接与回跳只改变片段、`other.md` 在本标签以 Markdown 打开且复用视图、查看器下拉切到 Text 显示源码且视图销毁）。

### 9.5 第三方插件（后续阶段）

插件目录为 `userData/plugins/<id>/`，内含 `manifest.json` 与 ESM 产物；主进程的 plugin 模块负责发现与校验，渲染端通过 `pcplugin://` 协议动态 import。React 等公共依赖由宿主以 import map 方式共享，避免重复打包。由于插件代码运行在渲染进程，需提供启用开关与来源提示；对安全要求高时切换为 iframe 沙箱模式（见 9.1 的设计伏笔）。

---

## 10. Office 文件：交给本机 Office 打开

### 10.1 原则

Excel、Word、PowerPoint 等 Office 文件不在应用内渲染，而是交给本机安装的 Office 打开，提供三种打开方式：**只读打开**、**编辑打开**、**新建打开**（以该文件为蓝本新建一个未保存的文档，保存时 Office 会要求另存为，原文件不受影响）。

能力不硬造：每种方式是否可用，取决于本机 Office（或用户设置的其他关联程序）是否提供。检测不到的方式在菜单中直接不显示，而不是由本应用模拟。

### 10.2 能力检测：读取 Windows 文件关联

Windows 资源管理器右键菜单里的「開く」「読み取り専用で開く」「新規」等，本质上是注册表中该文件类型 ProgID 下的 shell verb。本应用按以下顺序检测，结果按扩展名持久保存（内存 + 数据库表 `launch_capabilities`，每台机器每个扩展名只检测一次：首次需要时检测，不阻塞启动，应用重启后直接使用已保存的结果；检测失败不保存，下次重试；面板上的「再検出」清除内存与数据库中本机的结果后重新检测并保存）。数据库在 `userData`（`%APPDATA%`，Roaming）下，漫游配置文件 / 文件夹重定向时会跟着用户到别的机器，因此每行带机器标识（主机名），只读写 / 清除本机的行：

1. 读取 `HKCU\...\Explorer\FileExts\<ext>\UserChoice` 的 ProgId（用户自己选过的默认程序优先），没有则读 `HKCR\<ext>` 的默认值。
2. 列出 `HKCR\<ProgId>\shell` 下的所有 verb。直接读注册表（经 PowerShell 的注册表提供程序）而不用 .NET 的 `ProcessStartInfo.Verbs`，因为后者按设计不会列出 `New`。
3. 读取默认 verb（没有则 `open`）的命令行，识别目标程序（`EXCEL.EXE`、`WINWORD.EXE`、`POWERPNT.EXE` 或其他）。

注册表读取由固定的 PowerShell 脚本完成（`Registry::` 提供程序，不解析 `reg query` 的文本输出，因此不受系统语言影响），输出 JSON，主进程用 zod 校验。

### 10.3 打开方式与实现手段

每种方式优先使用 shell verb（与资源管理器右键菜单行为一致，DDE、DelegateExecute 等细节由 Windows 处理），其次使用 Office 官方文档记载的命令行开关；两者都没有就不提供。**verb 的名字不等于行为**，下表依据 2026-11-20 在本机（即点即用版 Office16）对 Excel / Word 的实测（台账 `devDoc/2026-11-20-24-m2-ledger.md` S4，判定标准为窗口标题与同目录是否出现所有者文件 `~$…`）：

| 方式 | 来源 | 说明 |
|---|---|---|
| 编辑打开 `edit` | 默认 verb（存在于 verbs 时），否则 `Open` | 共享盘上文件被他人占用时，由 Office 自己提示只读或通知。本机 `.xlsx` / `.docx` 没有 `UserChoice` 时，`Open` 会弹出系统「选择应用」对话框（与资源管理器双击相同，系统状态，非本应用问题） |
| 只读打开 `readOnly` | **仅当关联程序是 `EXCEL.EXE` 时**用官方文档记载的开关 `/r` | 实测：标题 `… - Read-Only - Excel`，无 `~$` 文件。**不从 `OpenAsReadOnly` 推导**：实测它（`/h`）以编辑模式打开，出现 `~$` 文件。Word / PowerPoint 没有只读开关，不提供 |
| 受保护的视图 `protectedView` | `ViewProtected` | 实测为只读（标题 `… - Protected View - …`，无 `~$` 文件），有此 verb 就显示，标注为「受保护的视图」 |
| 新建打开 `newFromFile` | `New` | 实测以该文件为蓝本新建未保存的文档，原文件不被占用 |

开关方式的 exe 路径：优先取 `HKLM`（再 `HKCU`）`SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\<exe 文件名>`，否则取默认 verb 的命令中的路径，且文件须存在。`UserChoiceLatest` 不读：本机系统实际采用的是 `UserChoice`（`.pdf` 的两者不一致，实测系统用 `UserChoice`），若以后发现不一致导致错误，再改用 `AssocQueryString`。

由于检测基于文件关联而不是写死 Office，若用户的默认程序是 WPS、LibreOffice 等，同样会显示该程序在注册表中提供的 verb（`readOnly` 例外：只对 `EXCEL.EXE` 提供）。

```ts
// packages/shared/src/launcher/types.ts
export type LaunchMode = 'edit' | 'readOnly' | 'protectedView' | 'newFromFile';

export interface LaunchOption {
  mode: LaunchMode;
  via: { type: 'verb'; verb: string } | { type: 'switch'; exe: string; args: string[] };
}

export interface LaunchCapabilities {
  ext: string;                       // 不含点的小写扩展名
  appName: string | null;            // 'Microsoft Excel' 等，取自程序的文件描述；空串规范为 null
  options: LaunchOption[];           // 只包含检测到的方式
}
```

启动经 `powershell.exe -NoProfile -NonInteractive -Command <固定脚本>`（`modules/launcher/powershell.ts`，`windowsHide`、超时 15 秒），路径、verb、exe、参数只经环境变量传入，脚本是固定字符串（`detect-script.ts`，纯 ASCII、不含双引号）。**不用 `Start-Process`**：Windows PowerShell 5.1 没有 `-LiteralPath`，`-FilePath` 把 `[` `]` 当通配符（同目录有 `見積[1] 案.xlsx` 与 `見積1 案.xlsx` 时会打开错的那个）。verb 方式用 `System.Diagnostics.ProcessStartInfo`（`FileName = $env:PCH_TARGET`、`Verb = $env:PCH_VERB`、`UseShellExecute = $true`）；开关方式同样用 `UseShellExecute = $true`（为 `$false` 时 .NET Framework 以继承句柄创建进程，Office 会继承 Node 的 stdout 管道，`execFile` 要等 Office 退出或超时才返回）、不设 `Verb`、`FileName = $env:PCH_EXE`、`Arguments` 由脚本从 JSON 数组（`$env:PCH_ARGS`）组成：形如 `/r` 的开关不加引号（Excel 把加了引号的开关当作文件名），其余加引号。

PowerShell 启动约需 0.5～1 秒，相对 Office 自身数秒的启动可以接受（台账 S7）。若终端策略禁止 PowerShell，可改为用 koffi 直接调用 `ShellExecuteExW`（届时作为新依赖告知），接口不变。

### 10.4 不同资源类型的处理

| 资源 | 只读打开 | 编辑打开 | 新建打开 |
|---|---|---|---|
| 本地 / 已挂载 SMB / UNC | 直接传路径 | 直接传路径，Office 原生处理锁定与保存 | 直接传路径 |
| 未挂载 SMB | 先建立 `net use` 会话，再传 UNC 路径（会话对 Office 同样有效） | 同左 | 同左 |
| FTP / SFTP | 下载到缓存，设置只读属性后打开 | 走「远程编辑会话」（10.5） | 下载到缓存后新建打开，保存时由用户另存到任意位置 |

缓存副本保持原文件名，使 Office 标题栏显示正确。

### 10.5 远程编辑会话（FTP / SFTP）

> 路线图「后续」（需求方 2026-11-22：M4 只做 SFTP 只读；远程文件只显示兜底的文件信息）。以下为原设想。

FTP/SFTP 上的文件无法被 Office 直接写回，因此由本应用代理：

1. 下载到 `userData/edit-sessions/<sessionId>/<原文件名>`，记录基线：远端 mtime、size，以及本地文件的 SHA-256。
2. 用 `Open` verb 打开，监听该目录（忽略 `~$*`、`*.tmp` 等 Office 临时文件，等待写入稳定），因为 Office 保存时通常是「写临时文件再替换」。
3. 检测到内容哈希变化后自动上传：先 stat 远端，若与基线不一致则判定冲突，弹窗让用户选择「覆盖服务器」「以副本名上传」「暂不上传」；无冲突则先上传到临时文件名再重命名覆盖，成功后更新基线。
4. 定期尝试以读写方式打开本地文件，Office 关闭该文件后锁会释放，此时完成最后一次同步并结束会话、清理副本。
5. 会话持久化到 SQLite。应用重启时若发现未同步的修改，在状态栏和通知中提示用户处理，不会静默丢失。

状态栏显示「远程编辑中 (n)」，点击可查看每个会话的状态（编辑中、上传中、已同步、冲突、错误）并手动「完成编辑」。为此 FTP/SFTP Provider 需要增加 `upload` 与 `rename` 能力（`capabilities.write = true`），本地类 Provider 仍保持只读，因为 Office 会直接写本地或共享盘文件。

### 10.6 在界面中的体现

1. 目录视图（预览窗口中的 `pch.preview.folder`）的右键菜单出现「用 {appName} 打开 ▸ 只读 / 编辑 / 新建」，子项按检测结果动态生成。资源树不提供（需求方 2026-11-19 决定：资源树只用于展示，打开动作只由将来的预览窗口提供）。
2. 设置 `launcher.officeDefaultAction` 与 `launcher.officeExtensions` 已删除（M2）：在应用内打开 Office 文件都先显示启动面板（`pch.preview.office`），由用户选择打开方式（M2 反馈第 3 项起，资源树中单击 Office 文件显示「文件信息」，双击 / Enter / 新标签才是启动面板）；Office 扩展名固定在插件 manifest。
3. 在应用内以标签方式打开 Office 文件时，由内置的 `pch.preview.office` 插件显示一个启动面板：文件信息、三个打开按钮（只显示可用的）、该文件的远程编辑会话状态。这样标签、会话恢复等机制对 Office 文件依然成立。

**已实现（M2 Task 10）**：`plugins/builtin/src/office/`（id `pch.preview.office`，`match = { kinds: ['file'], extensions: [xlsx xlsm xls xltx xltm xlsb docx docm doc dotx pptx pptm ppt potx] }`）。面板：图标、文件名、位置（`toDisplayPath`）、大小、修改时间；「{{app}} で開く」+ 按 `options` 的顺序显示的按钮（插件只看 `mode`，不关心 `via`）；`appName` 为空（null 或空串）时显示「関連付けられたアプリで開く」；检测不到任何方式（`options` 为空）时只有「既定のアプリで開く」（`openWithSystem`）；底部「エクスプローラーで表示」「パスをコピー」「再検出」（`redetectLaunchCapabilities()` 后重新取能力）。按钮按下后进入「起動中」状态（所有方式按钮禁用，`launch` 的 Promise 结束即恢复），防止连按。SDK `system.getLaunchCapabilities(uri)`（失败由宿主提示并返回 null）/ `launch(uri, mode)`（失败由宿主提示，不拒绝）/ `redetectLaunchCapabilities()`，`LaunchCapabilities` 等类型在 SDK 中重新声明，宿主赋值保证结构一致。远程编辑会话状态尚未实现（第 10.5 节）。**已实现（第 4 项反馈）**：`launch_capabilities` 表（迁移 0005，主键 `(machine, ext)`）+ `modules/launcher/launch-capabilities.repo.ts`（构造时传入本机标识，组合根用 `os.hostname()`；`get` / `put` / `clear` 只针对本机的行；读出时 zod 校验，结构不符 / `ext` 不一致的行当作没有保存并重新检测）；`LauncherService` 依赖注入该 repo，保留 generation 机制（检测期间 `redetect()` 则丢弃结果、不写库）；面板的「検出中」提示延迟 300ms 才显示，检测期间占住按钮区域的高度，命中保存结果时不闪。e2e（`e2e/office.spec.ts`）经「未打包且 `PCH_E2E_FAKE_LAUNCHER=1`」在组合根注入假 run（`modules/launcher/fake-run.ts`：检测返回固定 JSON，启动为空操作并记录）。

### 10.7 代码位置

```
apps/desktop/src/main/modules/launcher/
├── detect-script.ts          # 固定 PowerShell 脚本：能力检测、verb 启动、开关启动
├── association.ts            # 检测输出的 zod 校验（RawAssociation）与「原始关联 → LaunchCapabilities」
├── powershell.ts             # runPowerShell（execFile，可替换为 koffi）
├── launcher.service.ts       # 按扩展名检测，结果持久保存（内存 + launch-capabilities.repo）；stat（不是文件 → LAUNCH_FAILED）→ 本地路径 → 启动（已实现，M2）
├── launch-capabilities.repo.ts # launch_capabilities 表的存取（读出 zod 校验；已实现，第 4 项反馈）
├── launcher.ipc.ts           # launcher.capabilities / launcher.open / launcher.redetect（已实现，M2）
├── edit-session.service.ts   # （未实现）远程编辑会话：监听、上传、冲突、结束
└── edit-session.repo.ts      # （未实现）
plugins/preview-office/       # Office 文件的启动面板插件
```

---

## 11. 标签页、多窗口与会话恢复

### 11.1 状态模型（packages/shared）

```ts
export interface TabState {
  id: string;
  uri: string;                 // 资源 URI 或内置页面（pch-settings: 等，M5 起；原写 internal://settings）
  pluginId: string;
  title: string;
  pinned: boolean;
  viewState?: unknown;         // 由插件定义：滚动位置、页码、缩放、排序、编码……
  viewer?: string;             // 用户为当前位置选的查看器（插件 id，M2）
}

export interface WindowState {
  id: string;
  role: 'main' | 'detached';
  bounds: { x: number; y: number; width: number; height: number };
  maximized: boolean;
  tabIds: string[];
  activeTabId: string | null;
}

export interface LayoutState {
  windows: Record<string, WindowState>;
  tabs: Record<string, TabState>;
}

export type LayoutAction =
  | { type: 'tab/open'; windowId: string; uri: string; pluginId: string; title: string; background?: boolean }
  | { type: 'tab/close'; tabId: string }
  | { type: 'tab/activate'; tabId: string }
  | { type: 'tab/move'; tabId: string; toWindowId: string; index: number }
  | { type: 'tab/detach'; tabId: string; bounds?: WindowState['bounds'] }
  | { type: 'tab/pin'; tabId: string; pinned: boolean }
  | { type: 'tab/viewState'; tabId: string; viewState: unknown }
  | { type: 'window/closed'; windowId: string };

// 纯函数，可直接单元测试；副作用（创建/关闭窗口）由 LayoutService 根据 diff 执行
export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState { /* … */ }
```

### 11.2 关键流程

**打开**（M1-3b 起，浏览器式，设计 `devDoc/2026-11-19-15-navigation-design.md` 2.8，需求方 2026-11-20 确认）：单击（或 Enter）在当前标签打开，记入该标签的历史，没有标签时新建；中键 / Ctrl+单击 / 右键「在新标签页中打开」在新标签打开，同一 URI 已打开则直接激活。资源树中的文件：单击 / ↑↓ 停留以「文件信息」打开（当前标签已在显示该文件时不动），双击 / Enter 以默认查看器打开，新标签打开时为默认查看器（M2 反馈第 3 项，11.1 节「已实现」的资源树一条）。没有「预览标签」（此前的斜体预览标签、被下一次单击替换、双击标签头 / 宿主动作转常驻都已取消）。

**弹出**：标签右键「在新窗口打开」或把标签拖出窗口边缘 → 渲染端发送 `tab/detach` → reducer 新建一个 detached 窗口并移入该标签 → LayoutService 发现新窗口，用 window-factory 创建 BrowserWindow 加载 `/window/?id=…`。弹出窗口内同样有标签栏，可继续打开多个。

**合并**：弹出窗口的标签菜单提供「移回主窗口」；跨窗口直接拖拽合并作为第二阶段（需要主进程跟踪全局鼠标坐标）。关闭弹出窗口时，可在设置中选择「关闭其中的标签」或「移回主窗口」。

**同步**：主进程每次 reduce 后，只向受影响的窗口推送 `layout.changed`（该窗口自己的 WindowView），渲染端 zustand store 整体替换。`tab/viewState` 属于高频更新，渲染端防抖 500ms 后发送，主进程不广播此类变化。

**已实现（M1-3，单窗口子集）**：上面的 `LayoutState` / `LayoutAction` 是多窗口的目标结构（原 M3，已移到「后续」）。M1-3 只实现单窗口的子集，状态由**渲染端**持有（`stores/tabs-store.ts`，按工作区各保存一份、只在内存中；切换工作区时显示该工作区的标签），将来做多窗口时移到主进程 `LayoutService`（2.5 节届时落实）。类型与 reducer 在 `packages/shared/src/layout/`：

```ts
// M1-3b：标签显示「位置」；workspace 的 uri 为 'pch-workspace:<工作区 id>'（location.ts：workspaceUri / workspaceIdOfUri）
// M2 反馈第 8 项：workspaces（工作区一览）的 uri 固定为 'pch-workspaces:'（location.ts：WORKSPACES_URI / isWorkspacesUri / workspacesLocation）
export type LocationKind = 'workspace' | 'workspaces' | 'directory' | 'file'
export interface TabLocation { uri: string; kind: LocationKind; title: string }
export interface TabHistoryEntry extends TabLocation { viewState?: unknown; viewer?: string }   // 离开该位置时的 viewState / 用户选的查看器（没有时不含该键）
export interface TabHistory { back: TabHistoryEntry[]; forward: TabHistoryEntry[] }   // 各至多 TAB_HISTORY_LIMIT = 50
export interface TabState extends TabLocation { id: string; viewState?: unknown; viewer?: string; history: TabHistory }   // M1-3b 起没有 preview
export interface TabsState { tabs: TabState[]; activeId: string | null }
export type TabsAction =
  | ({ type: 'tab/open'; viewer?: string } & TabLocation)          // 新标签（viewer：M2 反馈第 3 项）
  | { type: 'tab/close'; id: string }
  | { type: 'tab/activate'; id: string }
  | ({ type: 'tab/navigate'; id: string; viewer?: string | null } & TabLocation)
  | { type: 'tab/back'; id: string }
  | { type: 'tab/forward'; id: string }
  | { type: 'tab/viewState'; id: string; viewState: unknown }
  | { type: 'tab/viewer'; id: string; viewer: string | null }   // M2：选择 / 清除当前位置的查看器
export function layoutReducer(state: TabsState, action: TabsAction, newId: () => string): TabsState
```

- `tab/open`（新标签）：同 URI 已打开 → 只激活；否则插在激活标签右侧。`tab/close`：关闭激活标签时激活右侧相邻标签，没有则左侧；关闭最后一个 → 欢迎页。`tab/navigate`（当前标签）：同标签内改位置并清除 viewState（允许与其他标签的 URI 重复），离开的位置连同其 viewState 压入后退栈、前进栈清空；导航到当前 URI 不入栈（只更新类型与标题，viewState 保留）。`tab/back` / `tab/forward`（M1-3b）：浏览器式，当前位置连同 viewState 压入另一侧的栈，**恢复目标位置离开时的 viewState**（像浏览器后退恢复滚动位置；目标没有保存时为 undefined。M1-3b 最终审查修复，此前同样清除）；没有可去的位置时不变。（M1-3b 取消预览标签：`preview` 字段、`tab/promote` 与「预览打开替换预览标签」都已删除。）`tab/viewState` 可带 `uri`（该状态所属的位置；文本预览最终审查修复）：与当前位置相同或省略时写入当前；标签已离开该位置（视图在导航之后才卸载、补存防抖中的状态）时写入后退栈顶或前进栈顶中 URI 相同的一项（两者都相同时取后退栈顶），都不是时不变——此前卸载后保存会落到新位置上，因此插件在卸载时不保存。`stores/tabs-store.ts` 的 `openHere(workspaceId, target, { newTab?, viewer? })` 是界面共用的浏览器式打开：有激活标签时 `tab/navigate`，没有或 `newTab` 时 `tab/open`（资源树、地址栏使用）。**打开时指定查看器**（M2 反馈第 3 项）：`tab/open` 的 `viewer` 给新标签（同 URI 已打开时只激活，不改其查看器）；`tab/navigate` 的 `viewer` 给新位置（`null` / 省略 = 自动选择），导航到当前 URI 时指定了 `viewer`（含 `null`）则同一位置换查看器（同 `tab/viewer`：清除 viewState、不入栈），省略时保留当前查看器（地址栏点当前段等原有行为不变）。历史属于标签（每个标签独立、只在内存中，关闭标签即消失；新开的标签历史为空），两个栈各至多 50 项，超出时丢弃最旧的。没有变化时返回同一个状态对象。 `tab/viewer`（M2）：设置当前位置的 `viewer` 并清除 `viewState`（viewState 属于上一个查看器），`null` 删除该键；viewer 随位置进入历史（`entryOf`），`tab/navigate` 到新位置时清除，后退 / 前进恢复历史项的 viewer；补存刚离开位置的 viewState 时保留该项的 viewer；`stores/tabs-store.ts` 的 `setViewer(tabId, viewer)`。`backFrom(tabId, uri)`（M2 反馈第 8 项）：标签仍在 `uri` 时后退一步（没有后退历史或已离开时不变），工作区一览切换工作区后用它。
- 逻辑路径（M1-3b，`renderer/src/lib/logical-path.ts`，地址栏与预览区共用）：`logicalPath(loc, { workspace: { id, name }, workspacesTitle, entries })` → `PathSegment[]`（`{ label, target: TabLocation, kind: 'workspaces' | 'workspace' | 'entry' | 'dir' | 'file' }`；`workspacesTitle` 为本地化的「工作区一览」）：`工作区名` ›（分组不出现）› `条目标签（别名）` › 相对路径各段 ›（文件时）文件名。所属条目为包含它的 folder 条目或 URI 相同的 file 条目，多个时取 URI 最长者；条目段的目标标题也是别名（标签在条目根时标题为别名）。条目之外的位置在工作区之后退化为绝对路径（驱动器 `C:` / 共享 `\\host\share` 开始）。`parentLocation(loc, ctx)` = 逻辑路径的上一段：条目根之上是工作区总览、**总览之上是工作区一览、一览为 null**（M2 反馈第 8 项）、条目之外为磁盘上的上级（驱动器 / 共享根之上为总览）。工作区一览本身的路径只有一览一段（名称取 `workspacesTitle`，不用标签标题的快照）；其他位置的路径**不**显示一览这一段（地址框前置的工作区按钮已代表这一级）。
- 工作区总览（M1-3b，`features/preview/workspace-overview.tsx`，应用内置视图、不是插件）：工作区 id 取自标签的 URI（标签按工作区区分，总览只会是所属工作区的），标题为工作区显示名；分组为分节（`overview-model.ts`：未分组的项在前、无标题，之后是分组；分组内先项后子分组，同层按 sortOrder），folder / file 条目为项（别名、真实路径；悬停提示为真实路径）。单击只获得焦点；双击 / Enter 在当前标签打开（folder 为目录、file 为文件，都进入历史）；中键 / Ctrl+单击 / Ctrl+Enter 在新标签打开（M1-3b 设计 2.8）。从条目根上来时焦点落在刚离开的条目上。`pch-workspace:` 不是文件 URI：不发给扫描进程、不进 `vfs.interest.tabs`（`selectActiveDirectory` 只取 `kind: 'directory'`），资源树不定位它（激活标签为总览时树的选中保持不变）。
- 工作区一览（M2 反馈第 8 项，需求方 2026-11-21 确认；`features/workspace/workspaces-page.tsx`，应用内置视图、不是插件）：工作区总览的上一级，**属于当前工作区的标签集**（标签按工作区区分不变；标签只在内存中，不持久化）。进入方式：总览处地址栏的 ↑ / `Alt+↑`；地址框前置工作区按钮菜单底部的「管理工作区…」（有激活标签时在其中导航，没有时新建标签）。内容：**卡片网格**（v1.21 需求方要求；`grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]`——`auto-rows-fr` 使各行等高，窗口变窄、新建卡片换到另一行时高度也一致），每个工作区一张卡片（不显示图标；显示名、最近使用时间 `lastOpenedAt`——没有时不显示；当前工作区带「使用中」标记、强调色边框与 `aria-current`；条目数不显示，不为此新增 IPC），最后一张是虚线边框的「新しいワークスペース…」卡片（单击 / Enter 打开新建对话框：是操作而不是选择对象，不需要双击）。单击工作区卡片只获得焦点；**双击 / Enter 切换到该工作区**（切换失败只提示），**当前工作区**双击 / Enter 在本标签进入其总览；←→↑↓ / Home / End 在卡片（含新建卡片）之间移动焦点（`grid-nav.ts` 的 `gridNeighbor`：←→ 按阅读顺序，↑↓ 取相邻行中水平中心最近的一张，列数随宽度变化所以按实际位置计算）；在标签内导航到一览后焦点落在刚离开的工作区（从总览上来时），否则当前工作区。新建卡片与每张卡片右下角直接显示的操作按钮（ghost / 删除为 destructive 的 `icon-xs`，悬停提示与 `aria-label` 为操作名；不折叠进菜单）/ 右键菜单（共用同一份操作：重命名…、恢复默认名称——仅默认工作区且已改名、删除…——默认工作区没有）复用标题栏切换器的对话框（`workspace-dialogs.tsx`）。**从一览切走后旧标签后退一步**：一览因切换工作区而卸载后（不论经一览双击 / 新建、地址框的工作区按钮菜单还是标题栏的切换器切换），本标签仍是旧工作区的激活标签、仍在一览且有后退历史时后退一步（`workspace-flows.ts` 的 `listTabToLeave` + `tabs-store.backFrom`；没有历史时不动），以后切回旧工作区时不停在一览页；一览不是激活标签、或激活标签不在一览时不动。后退放在一览的卸载清理中，用 `data/workspace` 的 `useReadActiveWorkspaceId` 读查询缓存判断显示中的工作区：那时 React 已提交新工作区的界面，旧标签的后退不显示出来，也不为之前的位置挂载插件 / 浏览器视图（M2 反馈审查 I2：此前在 `activate` 返回后立即后退，`useActiveWorkspace` 要再经 `workspace.changed` → 重新取得才更新，旧标签会在界面上短暂退回；e2e 用 MutationObserver 断言地址栏 / 标签栏不出现旧位置）。在一览中删除当前工作区时先切到默认工作区，一览（连同删除确认框）随切换卸载，删除在后台完成，失败时只有提示（e2e 覆盖结果）。刷新（地址栏 / F5）重新取得工作区列表。`pch-workspaces:` 不是文件 URI：不发给扫描进程、不进 `vfs.interest`，资源树的同步请求找不到所属条目（`revealPath` 为 null）时不动、不提示。
- 资源树（`features/explorer`，M1-3b 设计 2.4 / 2.8）：
  - **打开**：单击 = 选中 + 在当前标签打开（`openHere`，记入历史；没有标签时新建）；**目录单击不展开**（需求 7）。中键 / Ctrl+单击 / Ctrl+Enter / 右键「在新标签页中打开」= 在新标签打开（同 URI 已打开则只激活）。**双击**：分组 / 目录 = 展开 / 折叠（第二次单击 `detail` 为 2 不再处理）；文件见下一条。展开箭头（`data-tree-toggle`）单击只展开 / 折叠，不选中、不打开。→ / ← 照旧展开折叠 / 移动。Enter = 可展开的节点展开或折叠 + 立即在当前标签打开（错误行为重试）。
  - **文件节点（file / link-file）的查看器**（M2 反馈第 3 项，需求方 2026-11-21 确认；纯函数 `openRequest(node, gesture, activeUri)`，`open-target.ts`）：单击与 ↑↓ 停留（`select`）= 当前标签以「文件信息」（`FALLBACK_PLUGIN_ID`）打开，**当前标签已在显示该文件时（无论哪个查看器）什么都不做**（不切回文件信息、不进历史）；双击与 Enter（`activate`）= 当前标签以默认查看器打开（`viewer: null`，自动选择）——第一次单击已以文件信息打开时由 `tab/navigate` 到当前 URI 换查看器，不多记一条历史；Ctrl+单击 / 中键 / Ctrl+Enter / 菜单（`newTab`）= 新标签、默认查看器。「文件信息」打开后地址栏的查看器菜单照常可切换；查看器随位置进入历史，后退 / 前进恢复。目录、条目根等非文件节点不指定查看器（行为不变）。只限资源树：工作区总览、目录视图、地址栏中的文件打开仍为默认查看器。
  - **键盘移动选中**（↑↓，以及 → ← 移到子项 / 父项）后 **400ms 防抖**在当前标签打开（`KEY_OPEN_DELAY_MS`；文件以「文件信息」打开，同单击）：快速连按只在最后停留处打开一次、记一条历史；单击 / Enter / 菜单打开，以及激活标签的位置被其他操作改变（同步请求到达）时取消尚未触发的打开。
  - 设置 `explorer.singleClickPreview`（键名沿用，避免迁移）的含义改为「单击 / 键盘移动选中即在当前标签打开」：关闭时单击与 ↑↓ 只选中，Enter 与文件双击以默认查看器打开，目录双击只展开。
  - **树跟随标签**（预览区 → 树）：`stores/navigation-store.ts` 订阅 tabs-store，激活标签（id 或位置）一变——打开、切换标签、标签内导航、后退 / 前进、地址栏点段、上一级——就发出 `mode: 'sync'` 的定位请求；资源树经 `use-reveal.ts`（与搜索的 `locate` 共用：所属条目 → 展开祖先 → 逐层等待列表）选中并滚动到该节点（`align: 'auto'`），**不聚焦、不提示、不确认目录**；**位置是目录时该目录本身也展开**（显示其子项，与目录视图一致；文件只展开祖先、选中文件行。M2 反馈第 5 项）——这样展开的目录，以及同步时本来折叠、为显示目标而展开的祖先，记为「跟随展开」（`explorer-store` 的 `followed`，`followTo` / `openFollowed`），下一次同步时不是新位置、也不在其祖先链上的跟随展开节点收起，后退 / 上一级 / 去别处时树不越展越多；原本已展开的祖先、用户自己展开的目录不收起，用户折叠过（`toggle`）或全部折叠后的节点不再算跟随展开；`locate` 不展开目标本身；树中单击 / ↑↓ 停留打开时选中节点的 URI 已是该位置（见下文），同步跳过，因此目录单击仍不展开（需求 7）——跳过时什么都不做：不收起（免得行在指针下移动、双击的第二下落到别的行），跟随记录保留，到下一次由标签驱动的同步（目录视图、地址栏、后退 / 前进、切换标签）时收起；位置不在树中（工作区总览、条目之外，以及展开祖先后列表中没有该项、某一层超时）时选中不变——只在找到目标时选中（`settleReveal` / `settleRevealTimeout` 按模式区分；搜索结果等的 `locate` 仍选中已到达的最深一层并提示。M1-3b 最终审查修复：此前 sync 也会选中最深的祖先）；选中节点的 URI 已是该位置时不动（同一 URI 在树中出现多次时，选中留在用户点的那一行）。请求在 store 层发出，资源树不挂载期间（侧栏显示搜索）的变化留到挂载时处理（只保留最新一个）。**不形成循环**：打开只由用户的单击 / 键盘 / 菜单发起，同步引起的选中不触发打开（e2e 以选中次数与历史条数断言）。
  - 条目根 / 真实目录 / 指向目录的链接打开为 `directory`，文件 / 指向文件的链接为 `file`；分组、状态行、失效链接不打开。标题为节点显示名（条目为条目标签）。
- 标签栏（`features/tabs`）：`role="tablist"` / `tab`；单击激活、× / 中键关闭（M1-3b 起没有斜体的预览标签与「双击转常驻」）、`Ctrl+W` 关闭激活标签；悬停提示为完整路径（`lib/file-uri.ts`；工作区总览 / 一览为标题），图标按位置种类（总览 / 一览〔GalleryVertical〕/ 目录 / 文件）；工作区一览的标题按当前语言显示（其他标签的标题是打开时的快照）；只有一个 Tab 停靠点，←→ / Home / End 切换；溢出时横向滚动（纵向滚轮换成横向）。内容区只渲染激活标签（按标签 id 重建），内容由 `PreviewContainer` 提供（9.3 节「已实现」）。
- ~~预览转常驻~~：M1-3b 取消预览标签（设计 2.8，需求方 2026-11-20 确认），所有标签都是普通标签。

### 11.3 会话快照（被取代：已移到路线图「后续」）

> **2026-11-21 起被取代**（需求方：不需要恢复本应用中的标签，也不需要弹出标签）。M3 的「中断恢复」改为 11.4 节的「桌面记录」（恢复本应用之外的程序与资源管理器）；本节的应用内会话快照与 11.1 / 11.2 节的多窗口一起移到路线图「后续」，是否还做以后再定。以下为原设想，**未实现**；对应的设置键 `session.restoreOnStartup` / `window.onDetachedClose` 仍在 schema 中但没有用途（14.1 节，是否删除待需求方确认）。

```ts
export interface SessionSnapshot {
  version: 1;
  workspaceId: string;
  layout: LayoutState;
  explorer: { expanded: string[]; selected?: string; sidebarWidth: number; sidebarCollapsed: boolean };
}
```

保存时机：布局或资源树状态变化后防抖 1 秒；切换工作区前；退出前。恢复时机：启动时恢复上次的工作区（设置项 `session.restoreOnStartup` 可关闭）；切换工作区时，先保存当前工作区的快照、关闭弹出窗口，再按目标工作区的快照重建。

恢复时的容错：窗口坐标若落在已不存在的显示器上，移回主显示器；远程资源不在启动时连接，标签先以占位状态显示，激活时再加载；文件已不存在则标签显示「找不到资源」并提供关闭或重新定位。快照带 `version` 字段，将来结构变更时做迁移。

### 11.4 桌面记录（M3）

设计 `devDoc/2026-11-21-31-m3-desktop-snapshot-design.md`（需求方 2026-11-21 定稿，第 9 节为 2026-11-22 试用反馈），先行验证与实机结果 `devDoc/2026-11-21-33-m3-ledger.md`，实现记录（控制者决定、未验证项、已知问题）`devDoc/2026-11-22-34-m3.md`。

**目标结构**（需求方定稿的意图）：

- 记录对象：资源管理器（含 Windows 11 的标签）、Word / Excel / PowerPoint 打开的文件（含只读）、VS Code 打开的文件夹 / `.code-workspace`、Eclipse 的 workspace；**以监控取得**，不要求程序经本应用启动。整台桌面一份记录，不按工作区区分；入口在活动栏。
- 保存：定时自动 + 手动 + 退出本应用时选择保存哪些；恢复：重启后打开本应用时提示，可全部或挑选恢复。
- **关机时程序被逐个关掉不能把记录冲掉**：消失的项目持续消失 1 分钟才从当前现场移除；`query-session-end` 时冻结现场并立即写一份；每份记录带「登录时刻」，据此找出「上一次登录」的最后一份记录。
- 安全边界：恢复只启动主进程采集、存在数据库中的项目，渲染端只传 id（15 节第 10 项）；读取其他程序的状态只读、读完即关（文件系统原则）；不保存整串命令行。
- 非目标（本次不做）：恢复窗口位置与大小（位置只记录）、开机自启 / 托盘、其他程序（樱花编辑器、Tera Term、WinSCP 等）、云端（`https://`）与临时目录中的 Office 文件、未保存过的新文档、本应用自己的标签（11.3 节）。

**已实现**（主进程 `modules/desktop/`，渲染端 `features/desktop/`，共享类型 `packages/shared/src/desktop/`）：

- **数据**：`DesktopItem` = `explorer { tabs, bounds }`（路径或 `::{CLSID}`，按标签顺序）/ `office { app: word|excel|powerpoint, path, readOnly, exe }` / `vscode { target, exe, bounds }`（本地路径、`.code-workspace` 或 `vscode-remote://` URI）/ `eclipse { workspace, exe, bounds }`。`desktopItemKey`（路径小写；Explorer 含标签顺序）用于「已开着」比较与现场项目的标识；保存 / 退出 / 恢复时的选择为 `DesktopPick { key, tabs? }` / `DesktopRestorePick { id, tabs? }`，`tabs` 为 Explorer 选中标签的下标（`pickTabs`：按原顺序保留，一个都不剩的窗口不要）；项目数 `desktopEntryCount`（Explorer 每个标签算一项，快照摘要的 `itemCount` 用同一算法在 SQL 中计算）；`openTargetsOf` 把 Explorer 的每个标签拆成 `explorer-tab:<路径>`，恢复时「第一个标签已开着」即视为整个窗口已开着。
- **窗口枚举**（`window-list.ts`，koffi，`user32` 的 `EnumWindows` 等 + `QueryFullProcessImageNameW`，pid → exe 缓存）：只取可见顶层窗口中按「exe 文件名 + 窗口类」判定的六类（`explorer.exe` / `CabinetWClass`、`WINWORD.EXE` / `OpusApp`、`EXCEL.EXE` / `XLMAIN`、`POWERPNT.EXE` / `PPTFrameClass`、`Code.exe` / `Chrome_WidgetWin_1`（且标题非空）、`eclipse.exe` / `SWT_Window0`）；每类一个签名（按 hwnd 排序的「hwnd + 标题」）。原生声明在进程内只做一次（koffi 同名重复定义会抛错）。登录时刻（`logon.ts`）= `WTSQuerySessionInformationW(WTSSessionInfo).LogonTime`，失败时退回 shell 进程的创建时刻，再失败用应用启动时刻并记 warn。
- **采集器**（`collectors/`，每类一个；Explorer / Office / Eclipse 命令行为 `scripts.ts` 中的**固定 PowerShell 脚本**，输入只经环境变量 `PCH_HWNDS` / `PCH_PIDS` / `PCH_PID`，经 `infra/powershell.ts`，超时 10 秒）：
  - 资源管理器：`Shell.Application.Windows()` 按 HWND 分组（每个标签一项），标签顺序按 UI Automation 的 `TabItem` 顺序；bounds 取窗口矩形。
  - Office：对可见顶层窗口的**子窗口**（`EXCEL7` / `_WwG` / `mdiClass`）`AccessibleObjectFromWindow(OBJID_NATIVEOM)` → `.Application`（多个 Excel 进程逐个取），枚举文档的 `FullName` / `ReadOnly`；找到子窗口但取不到对象或 `FullName` 为空（弹着模态对话框）→ 本轮失败（`busy`）；没有子窗口（程序开着但没有文档）→ 空；`https://` 与临时目录中的文档丢弃；Excel 中没有可见窗口的工作簿（`PERSONAL.XLSB`、加载项等）不记录。
  - VS Code：可见 `Code.exe` 窗口标题中的根名与 `%APPDATA%\Code\User\globalStorage\storage.json` 的 `windowsState`（`lastActiveWindow` + `openedWindows` 的 `folder` / `workspaceIdentifier.configURIPath` / `remoteAuthority`）匹配，只输出匹配上的项（`storage.json` 只在打开窗口后写、关闭时不写，不能单独表示「现在开着什么」）；文件只读读取、读完即关；最小化窗口的矩形在屏幕外（≤ -20000）时 bounds 退回 `uiState`。
  - Eclipse：进程命令行中的 `-data <路径>`（只取这一个参数），没有时取 `org.eclipse.ui.ide.prefs` 的 `RECENT_WORKSPACES` 第一项；绝对路径按 `path.win32.normalize` 规范化（`C:/ws` → `C:\ws`，恢复只接受反斜杠形式）。
- **监控**（`monitor.ts`，数值集中在 `constants.ts` 的 `DESKTOP_TIMINGS`）：每 `2000` ms 枚举（只调用 Win32 API）；某类签名变化后从**第一次变化起**防抖 `1000` ms（VS Code `10_000` ms，等 `storage.json` 写入，新窗口打开后约 4 ~ 9 秒才写）再采集该类；每 `60_000` ms 全部类别完整读取兜底（标题不变的变化，如 Explorer 新增后台标签，只能靠它发现；没有窗口的类别不启动 PowerShell）；同类别单飞（进行中再变化则结束后补一次），超时 `10_000` ms 后迟到的结果丢弃。采集失败 / 超时 → **保留该类上一次结果、不开始计时移除**，连续失败只记一次 warn，并在 `desktop.current.unreadable` 中报告（侧栏显示「无法读取：<类别>」）；枚举抛错时本轮跳过，不把全部项当作消失。
- **当前现场**（`live-state.ts`）：新项目立即加入；消失的项目持续 `60_000` ms 才移除；`freeze(untilMs, now)` 期间不移除（冻结前已过期的项先清掉）。
- **快照与保留**（迁移 0006，`snapshot.repo.ts`，13 节）：种类 `auto` / `manual` / `exit` / `exit-none`（退出时选「不保存」的内部标记，0 项）。**每次登录只有一份 `auto`，原地更新**，尽量与现场实时同步（v1.25）：现场每次变化（监控 `onChange` → `liveChanged`）后合并 `1000` ms 检查一次，消失项目到期移除的时刻（`LiveState.nextExpiry`）再检查一次，另每 `60_000` ms 兜底；现场内容（与顺序无关的签名）与上次不同才更新它的内容与时间（用户删除或被清理后下次新建）；会话结束冻结期间、退出流程中不写；实测（真实模式）新开的资源管理器窗口出现后约 3.5 秒进入自动快照，关闭后约 63 秒（60 秒保护 + 检测）从自动快照去掉；第一次完整读取之前不写（避免缩水的记录）。**每次登录只占 1 个可见名额**（Ruling 15）：同一登录内重启本应用时，启动时接回本次登录最新的 `auto`（没有时接回最新的 `exit`，第一次写入时改回 `auto`）继续原地更新；「保存して終了」把它原地改为 `exit`（`convertToExit`：种类、时间、项目换成勾选的项目，只改本机、种类为 `auto` 的行；没有时新写一份 `exit`），「保存しないで終了」删除它（`deleteAuto`）并写 `exit-none`。**可见快照（auto / manual / exit）最多 `3` 个**，每次写入后删除最旧的；启动时选出的恢复候选在本次运行期间受保护（计入 3 个）；`exit-none` 不计入、只留最新一个。所有读写限定本机 `machine`（`os.hostname()`）。写入经同一条 promise 链串行。
- **启动时的恢复提示**（`restore-candidate.ts`，`desktop.restorePrompt`，每次启动只返回一次）：当前登录已有任何快照 → 不提示；否则取上一次登录（`logon_at` 小于当前的最大者）中最后一份非 `manual` 快照：`exit` / `auto` → 提示它（只列当前没开着的项目，没有则不提示），`exit-none` → 不提示。候选在写本次第一份快照之前计算。
- **恢复**（`restore.ts`，`desktop.restore`）：主进程按快照 id 取出项目、只取属于该快照的项目 id、按快照中的顺序逐个启动（Explorer 只启动选中的标签），项目之间 `500` ms；已开着 → `open`；exe 不在白名单（文件名不区分大小写：`explorer.exe`、`WINWORD.EXE`、`EXCEL.EXE`、`POWERPNT.EXE`、`Code.exe`、`eclipse.exe`，且须以 `X:\` 或 `\\`（UNC）开头）或路径不以 `X:\` / `\\` 开头（Explorer 另允许 `::{CLSID}`，VS Code 另允许 `vscode-remote://`；`path.win32.isAbsolute` 接受的 `\foo`、`C:/foo` 不放行）→ `failed`；存在性检查经 `VfsService.stat`，每项最多 `3000` ms（`no` → `missing`，超时 / 不可达 → `unreachable`），同一 Explorer 窗口的各标签并行检查。启动不经 shell（`spawn` detached）：Office `<exe> <path>`（只读的 Excel 加 `/r`），VS Code `<exe> <目录>` / `--folder-uri <vscode-remote URI>`（以 `-` 开头的目标拒绝），Eclipse `<exe> -data <workspace>`；Explorer 用 `%SystemRoot%\explorer.exe`：单标签直接打开，多标签交给固定脚本 `EXPLORER_RESTORE_SCRIPT`（路径列表经 `PCH_TABS`：记下现有窗口 → 打开第一个路径（CLSID 加 `shell:` 前缀）→ 找到新窗口 → 逐个点 UIA `AddButton` 并 `Navigate2`（`::{CLSID}` 同样加 `shell:` 前缀，裸 CLSID 会抛错），每完成一步输出一行 `OK`），脚本失败或超时时只对未恢复的标签逐个开独立窗口。结果 `{ launched, skipped }` 由渲染端汇总为一条应用消息。**恢复不删除快照**（v1.25，需求方：删除要确认，不默认删除）：恢复后渲染端显示「删除已保存的快照吗？」确认（默认焦点「保留」，Esc / 点外部 = 保留；有 `unreachable` / `failed` 的跳过项时提示保留以便再试），选「删除」→ `desktop.clear`：删除本机全部快照（含 `exit-none`）后立即写一份本次登录的 `auto`，失败时报错（页面提示）；`10_000` ms 后照常完整读取一次并原地更新本次登录的 `auto`（设计第 9 节）。（v1.24 的「没有 unreachable / failed 时自动清空」（Ruling 14）已取消。）
- **退出与关机**（`exit-guard.ts` 状态机，`window.service.ts` 的主窗口钩子）：用户关闭主窗口且设置 `desktop.askOnExit` 为真 → 阻止关闭、还原最小化的窗口并发 `desktop.exitRequested`；渲染端显示退出对话框后调 `desktop.exitShown`，`10_000` ms 内没有确认按「全部保存并退出」处理，确认后无限等待；回答 `desktop.exit`（「保存して終了」把本次登录的 `auto` 原地改为 `exit`，内容为勾选的项目；第一次完整读取之前（`ready` 为假）不写 `exit`，本次登录已有的 `auto` 留作下次的候选；「保存しないで終了」删除本次登录的 `auto` 并写 `exit-none`；「次回から確認しない」写 `desktop.askOnExit = false`，之后退出时直接全部保存）或 `desktop.cancelExit`。`saveExit` 一开始即进入退出状态：之后不再自动保存、不写 `saveAutoNow`、不重新扫描，进行中的恢复完成后也不清空（退出快照不被冲掉）。保存失败也关闭窗口（记 error）。渲染端已崩溃 / 重新加载、`before-quit` 已开始、会话结束中 → 不拦截。`query-session-end`：记 info（含 `reasons`），冻结现场与自动保存 `300_000` ms 并立即写 auto，取消挂起的询问（`desktop.exitCancelled`），不阻止关机；到期仍在运行视为关机被取消、恢复正常。`session-end`：停止监控、之后不再拦截。
- **界面**：活动栏「搜索」之后的「桌面记录」（`MonitorIcon`）；侧栏顶部「今すぐ保存」与「…」菜单（「終了時に確認する」开关 = 设置 `desktop.askOnExit`，「次回から確認しない」之后在这里重新打开，Ruling 16），固定一行「現在」，下面是快照列表（新到旧，种类、项目数、`logonAt` 不是本次登录的标「重启前」；行内按钮与右键菜单改名 / 删除，删除打开中的快照有提示）。快照页在标签中打开（`pch-desktop:<id>` / `pch-desktop:current`，`LocationKind` 的 `desktop`，地址栏只显示一段）。清单为**卡片式**（设计第 9 节）：按软件分组，分组标题带图标与「已选 x / y」、不可勾选；每个项目一张**固定高度**的卡片（`<button role="checkbox">`，单击 / Space / Enter 切换，选中时强调色边框与勾；主标题与完整路径各一行省略、悬停显示全文，只读标记；所有分组的卡片一样高）；**Explorer 每个标签一张卡片、分别勾选**（主标题为最后一段、`::{CLSID}` 为「特殊位置」），同一窗口的多个标签用虚线框围起，框头「同一窗口 · N 个标签」（`role="group"`），单标签窗口排在普通网格中（勾选模型 `checklist-model.ts`：勾选单位 id = 项目 id + 制表符 + 标签下标，`picksOf` 转为选择结果）；分组的「已选 x / y」、页脚件数、侧栏与快照列表的项目数都按「Explorer 每个标签算一项」；快照页、恢复对话框（「復元」「後で」）、退出对话框（「保存して終了」「保存しないで終了」「キャンセル」「次回から確認しない」）共用。两个对话框不同时出现（退出请求到达时撤下恢复对话框）。退出对话框在现场读取完成前（`ready` 为假）显示「读取中」并禁用「保存して終了」。恢复后（快照页与启动时的恢复对话框）确认是否删除快照；从快照页恢复并确认删除后，该标签导航到「現在」页，选保留时留在原页并重新获取（Ruling 17）。文案 ja / zh-CN / en 三语（`desktop` 命名空间）。
- **非 Windows / koffi 不可用**：`DesktopService` 不监控，IPC 返回空结果；退出不拦截。
- **e2e**（`e2e/desktop.spec.ts`，假模式 `PCH_E2E_FAKE_DESKTOP=1`：采集结果取 `PCH_E2E_DESKTOP_ITEMS`，恢复只记日志不启动程序，只在未打包时生效）：现场与「今すぐ保存」、退出时只保存一项 → 下次启动提示并只恢复它、不保存 → 不提示、「次回から確認しない」与侧栏菜单重新打开询问、取消、对话框开着时等待、恢复后确认（「保留」为默认焦点 / 「删除」后只剩一份新的自动快照）、从快照页恢复并删除后改为「現在」页、有 `failed` 时提示保留、Explorer 标签分卡片与窗口分组（退出只存部分标签 → 下次只提示这些 → 恢复时再减）、卡片跨分组等高等。其他 e2e 套件经 `e2e/support.ts` 默认也用假模式（现场为空），不读取真实桌面。真实环境的采集与恢复只做了实机验证（实现记录「已验证 / 未验证」）。

---

## 12. 渲染进程设计

### 12.1 状态管理分工

| 状态类别 | 工具 | 例子 |
|---|---|---|
| 来自主进程的数据 | TanStack Query | 工作区列表、条目、目录列表、连接、设置 |
| 主进程持有、渲染端镜像 | zustand（只读镜像 + dispatch） | 当前窗口的标签与激活状态（M1-3 先由渲染端直接持有，见 11 节「已实现」） |
| 纯 UI 状态 | zustand | 树展开/选中、侧栏宽度、命令面板开关 |
| 表单状态 | react-hook-form + zod | 连接编辑、设置页 |

主进程事件到缓存失效的桥接集中在 `lib/query-client.ts`：例如收到 `vfs.changed` 就让 `['vfs','list',uri]` 失效，收到 `settings.changed` 就更新 `['settings']` 的缓存。业务组件不直接订阅 IPC 事件。

已实现（M1-2）：query key 集中在 `lib/query-keys.ts`（`['workspace','list']`、`['workspace','active']`、`['entry','list',workspaceId]`、`['vfs','list',uri]`、`['search',workspaceId,text,kind]` 等）；`workspace.changed` → 工作区相关缓存与对应工作区的条目失效，`vfs.changed` → 对应目录列表失效。全局默认 `staleTime: Infinity`、`retry: false`、`refetchOnWindowFocus: false`（数据来自本机主进程，变化由事件推送），目录列表同样不按时间或聚焦重新获取（新鲜度由扫描进程负责，8.3 节）。同一目录的列表请求以 `dir:<uri>` 为 requestId；TanStack Query 取消查询（signal 中止）时渲染端发送 `vfs.cancel`（7.1 节）。文件名搜索（`data/search.ts`）`staleTime: 0`、不随 `vfs.changed` 失效（扫描中变化频繁，结果行会不停跳动；界面标注「基于缓存」与更新时刻），每次查询用新的 requestId（`search:<页面随机前缀>:<序号>`），取消时以该 id 发送 `vfs.cancel`——各次查询若共用一个 id，旧查询的取消可能落到紧随其后的新查询上；输入变化时保留同一工作区的上一次结果直到新结果到达（8.4 节）。例外：`vfs.reachability` 由外壳（`features/shell`）订阅并写入 `stores/reachability-store.ts`（分层规则：store 只能由 feature 写入；启动时先以 `vfs.offlineShares` 初始化）；同一事件的 `online` 另由 `lib/query-client.ts` 让该共享 / 卷下的目录查询失效。

已实现（M2）：应用消息——全应用的 toast 只经 `stores/messages-store.ts` 导出的 `notify(level, text)`（sonner 只在此文件与 `Toaster` 处出现；放在 stores 而非 lib，是因为分层规则不允许 lib 依赖 stores）。`Toaster` 开启四向拖拽丢弃（sonner 内置阈值 45px）。结束方式：用户拖拽 / 关闭（`onDismiss`）= 确认，不收纳；自动消失（`onAutoClose`）时 `error` / `warning` 收纳进 `tray`（新的在前，上限 50，超出丢最旧）、`info` / `success` 丢弃；`stashVisible()` 把显示中的 toast 全部收纳并 dismiss（不视为确认），`restoreTray()` 重新显示。`visible`（显示中的 toast id）供浏览器视图换截图判断。状态栏的 `MessageTrayButton` 在 `tray` 非空时显示「通知 N 件」，点击 `restoreTray()`。

已实现（M2 Task 7）：浏览器视图的渲染端（设计 `devDoc/2026-11-20-22-m2-design.md` 5.2 / 5.3.1 / 5.3.6 / 5.3.7）——
- `data/web.ts`：`web.state / navigate / notice / shortcut` 事件的订阅（`webEvents`）。
- `features/preview/web-host.ts`：`createWebViews`（每个渲染端一个，`preview-container.tsx` 首次需要时创建）按标签**串行**执行 `web.*` 调用（`web.freeze` 等 `capturePage` 期间到达的 `web.unfreeze` 若先执行，主进程会在截图后把视图隐藏而不再显示）、缓存各标签最近的 `web.state`（attach 复用视图且 URL 相同时主进程不再发状态，插件重新挂载时回放）、订阅 `tabs-store`：主进程中有视图的标签已不存在（关闭，含未激活的标签）→ `web.release`（分层规则不允许 stores 调用 IPC，release 在 features/preview 发出；`tabs-store` 只新增 `findTab(state, id)`）。`createWebHost`（每个标签内容 `PluginView` 一个，按标签 id 记忆；宿主重建时经 `setLinks` 在布局阶段换成最新的条目根 / `tabs` / 错误提示，视图不因主题、条目变化而隐藏再显示）：attach 的范围根见 7.3 节「范围根的确定」（`WebViews` 按标签记住，跳转沿用），并取走 `WebViews` 中该 URI 待用的片段（`web.navigate` 的 `fragment`）一并发给 `web.attach`；位置 = 占位元素的 `getBoundingClientRect()`（DIP，不乘 `devicePixelRatio`；`x = round(left)`、`width = round(right) - x`），`ResizeObserver` + 窗口 `resize` 在同一帧内合并为一次 `web.setBounds`（位置不变不发）；`web.navigate` → `tabs.navigate` / `tabs.open`（newTab）；`web.shortcut` → `window` 上派发 `keydown`（复用现有快捷键处理）；刷新请求 → `web.reload`。插件卸载（解除占位）一律只 `web.hide`；**销毁**只在：标签关闭（`createWebViews` 的 tabs-store 订阅）、本标签内容改用其他查看器（`PluginView` 在布局阶段 `setLocation({ pluginId, uri })`，`pluginId` 为实际解析出的插件，与视图「所有者」——最近一次 attach 的插件——不同即 `web.release`；插件仍在懒加载时同样生效）、工作区总览（`PreviewContainer`）。同一查看器导航到另一位置（网页之间跳转、后退 / 前进）时复用同一视图，主进程加载新 URL（同一个 webContents：sessionStorage 延续，M2 Task 7 审查修复——此前每次跳转都销毁重建）。状态缓存连同当时 attach 的 URI 一起保存，只回放同一 URI 的状态（导航到另一页面不会回放上一页的失败）。加载失败码映射为应用错误码（`HTTP_404` → `FS_NOT_FOUND` 等，其余 `UNKNOWN`）。
- **截图替身**：`lib/overlay-tracker.ts` 的 `useOverlayOpen()`——`MutationObserver` 观察 body 子树，`[data-open]` / `[data-ending-style]`（Base UI Popup 打开中 / 关闭动画中）且 role 为 `menu` / `dialog` / `alertdialog` / `listbox`、无 `hidden` 的节点存在时为 true（Tooltip 没有 role，不计入）。`PluginView` 把 `useOverlayOpen() || messages-store.visible.length > 0` 交给 `webHost.setCovered`：变为遮挡 → `web.freeze` → 占位元素背景 = 返回的 PNG（`background-size: 100% 100%`，截图为物理像素），解除 → 清除背景、`web.unfreeze`；截图期间解除遮挡时不显示迟到的图。只因 toast 处于截图时，占位元素上的 `pointerdown` → `stashVisible()`（不转发给页面）。**焦点**：隐藏的视图拿不住焦点（实测 `setVisible(false)` 后视图与应用的 `isFocused()` 都为假），主进程在 `web.freeze` 时把页面持有的焦点交回应用界面并报告 `yielded`。只因 toast 时渲染端让应用中残留的焦点元素失去焦点（页面中正在进行的输入不会落到资源树等处），结束时若用户没有在应用中操作（`document.hasFocus()` 且 `activeElement` 为 body）则 `web.unfreeze({ refocus: true })` 把焦点还给页面；期间打开过弹出层或焦点移到了应用中的元素则不还（系统级按键实测两种情形）。系统截图确认：下拉 / toast 显示在截图之上，视图与占位元素逐像素对齐（150% 缩放）。

### 12.2 界面布局

```
┌ 标题栏：Logo「環」│ 工作区按钮（● 名称）│ 命令面板（Ctrl+K）│ 主题 / 语言菜单 │ 窗口按钮 ┐
├ 地址栏：[←][→][↑][⟳] ( [≋] 工作区 › 条目别名 › 段 … › 文件名 )  [表示] ─────────┤
├──┬────────────────┬─────────────────────────────────────────────────────┤
│活│ 资源树          │ 标签栏（拖拽排序、固定、预览模式、溢出菜单）              │
│动│ （工作区条目 +  ├─────────────────────────────────────────────────────┤
│栏│  真实目录）     │ PreviewContainer（插件内容区）                          │
│  │                │                                                     │
├──┴────────────────┴─────────────────────────────────────────────────────┤
│ 状态栏：连接状态 │ 当前资源路径 │ 编码 │ 插件状态项 │ 通知                    │
└──────────────────────────────────────────────────────────────────────────┘
```

隐藏系统标题栏（`titleBarStyle: 'hidden'`，不使用 Window Controls Overlay），由渲染端自绘整条标题栏：Windows / Linux 在右端绘制最小化、最大化/还原、关闭按钮（尺寸与交互参照 Windows 11，经 `window.*` IPC 控制发起调用的窗口；最大化状态由 `window.stateChanged` 事件同步），外观随主题变化，也不会像系统按钮那样遮挡标题栏的边框；macOS 保留系统惯例的红绿灯。双击标题栏空白处最大化 / 还原由系统处理（已用系统级鼠标事件验证）；拖动窗口贴靠屏幕边缘、Win+方向键属于系统对隐藏标题栏窗口的标准行为，应同样可用（未逐一验证）。取舍是 Windows 11 悬停最大化按钮时出现的贴靠布局面板（Snap Layouts）不再出现。分栏用 shadcn Resizable，右键菜单用 ContextMenu，命令面板用 Command，通知用 Sonner。活动栏切换侧栏内容：资源树、搜索、桌面记录、远程连接，底部为设置（齿轮，M5 打开设置页）；最近使用在命令面板中（M5），不另设侧栏视图。已实现（M1-2）：标题栏左侧的工作区切换器（8.1 节）、侧栏的资源树（8.2 节）；（2026-11-19）活动栏的「搜索」视图与 `Ctrl+Shift+F`（8.4 节；标题栏中间的「搜索文件或命令」是 M5 的命令面板入口，与之不同）；欢迎页标题显示当前工作区名称；（M1-3）标签栏已实现（11 节「已实现」：没有标签时显示欢迎页；拖拽排序、固定、溢出菜单推迟），PreviewContainer 与 fallback 插件已实现（9.3、9.4 节「已实现」），folder 与 fallback 插件均已实现（9.4 节「已实现」）。

**地址栏（M1-3b 已实现，`features/address-bar`，设计 `devDoc/2026-11-19-15-navigation-design.md` 2.2 / 2.8 节）**：标题栏正下方、横跨活动栏 / 侧栏 / 内容区的一行（`Shell` 的 `addressBar` 插槽，`<nav>`，与标题栏同级、不属于任何标签的内容），显示当前工作区**激活标签**的位置；没有标签时只有工作区一段。**地址框**（M2 反馈第 6 项，需求方 2026-11-21 确认）：前置的工作区按钮与路径各段放在一个圆角、浅底的框中（`data-slot="address-box"`：`rounded-md border bg-muted/50`，高 28px，地址栏行高 36px），导航按钮（← → ↑ ⟳）与右端的查看器按钮留在框外，像 Edge / Windows 资源管理器的地址框；亮色 / 暗色下框与 ghost 按钮的悬停底色都可分辨（截图确认）。**工作区部分**（v1.21）：工作区按钮与第一段（工作区；一览页时为一览段）合成地址框左端的一个区域（`data-slot="address-workspace"`：撑满框高 `self-stretch`、右侧分隔线 `border-r`、不透明的底色 `color-mix(in oklch, var(--background), var(--foreground) 7%)`，暗色为 20%），底色与框不同，与后面的路径区分。不是框中的框：没有自己的边框 / 圆角 / 阴影，左侧圆角由地址框的 `overflow-hidden` 裁出，与框一致（需求方 2026-11-21 第二轮反馈；暗色下原来的 `bg-background` 比框更暗、对比不足，改为叠加前景色变亮）。底色必须不透明：它是段列表的第一项，`sticky left-0`，路径很长横向滚动时固定在左端（路径从它下面经过），工作区这一级始终可见。**复制路径**（v1.21）：单击当前位置（最后一段，不带修饰键）或其后的空白处（框本身或段列表的空白）把当前位置的路径写入剪贴板（`system.copyText`；文件 / 目录为 Windows 路径，其他如网页为 URI）并提示「パスをコピーしました」；工作区 / 一览没有路径，不动作；`Ctrl+单击` / 中键当前段仍在新标签打开。当前段与空白处的悬停提示为「路径 + 换行 + クリックでパスをコピー」（`addressBar:copyHint`）。 **查看器下拉（M2 Task 3）**：地址栏右端的「表示」按钮（`viewer-menu.tsx`）列出当前标签资源的候选查看器（单选，选中即 `tabs-store.setViewer`，进入历史；候选少于 2 个或无标签时禁用）；分隔线下的勾选项「.ext は常にこれで開く」写入 / 删除设置 `preview.associations[ext]`（ext = 文件名最后一段扩展名小写）。候选由预览容器写入 `stores/viewer-store.ts`（`byTab[tabId] = { candidates, ext }`，名称已按插件语言资源翻译，卸载时清除；内容相同的重复写入不触发订阅），地址栏经 store 读取（feature 之间不互相 import）。
- 按钮：后退 / 前进（按该标签自己的历史，11.1 节）、上一级（`lib/logical-path.ts` 的 `parentLocation`，与目录视图的 Backspace / `Alt+↑` 相同；总览之上是工作区一览）、刷新（`stores/tabs-store.ts` 的 `requestRefresh(tabId)`：目录视图重新确认并列出、文件标签重新 stat、工作区总览重新取得条目）；不可用时禁用（没有标签时全部禁用）。悬停提示带快捷键。
- 路径段：每次由 `logicalPath` 用最新的工作区名与条目计算（条目改名后立即更新；标签栏的标题仍是打开时的快照）。单击其他段 = 在当前标签内导航（进入历史）；单击当前位置 = 复制路径（见上）；中键 / `Ctrl+单击` = 在新标签打开（同 URI 已打开时按 `tab/open` 只激活）；没有激活标签时单击也新建标签。段的悬停提示为真实路径（Windows 路径；工作区段没有，`title=""` 以免继承地址框的复制提示）；最后一段 `aria-current="location"`。段过长时截断（最大宽度），段多时横向滚动（滚动条隐藏，纵向滚轮换成横向），路径或宽度变化后滚到末尾，使当前位置可见。
- **前置的工作区按钮**（M5 起与标题栏的工作区按钮、`Alt+W` 打开同一个工作区选择器，按 `workspace.pickerStyle` 为圆环或菜单式，见下文「M5 已实现」；以下为 M2 时的形态）（M2 反馈第 7 项：放在工作区名**前面**，lucide `GalleryVerticalIcon`（v1.21 起；最初为 `LayersIcon`，与资源树 / 总览的分组图标重复），去掉原来工作区名后面的 ▾；ghost、`icon-xs`，`aria-label` / 悬停提示为 `workspace:switcherLabel`）：快速切换菜单，列出工作区（当前项选中），选中即切换（与标题栏的切换器相同，经 `data/workspace` 的 `activate`）；底部分隔线下「管理工作区…」进入工作区一览（11.1 节）。新建 / 重命名 / 删除在标题栏的切换器与工作区一览中。
- 快捷键（M5 起 `use-navigation-shortcuts.ts` 只把 `nav.back / forward / up / refresh` 登记到命令注册表，由唯一的 window keydown 分发 `features/shell/use-command-shortcuts.ts` 执行，下述行为不变；按键 → 命令为纯函数 `commands.ts`）：`Alt+←` / `Alt+→` 后退 / 前进（焦点在输入框时也有效，与浏览器相同）；`Alt+↑` 上一级（M2 反馈第 8 项；焦点在应用的输入框时除外——输入框 / 下拉选择中 Alt+↑ 有自己的含义；目录视图自己处理 Alt+↑ 并 `preventDefault`，全局按 `defaultPrevented` 跳过，不会执行两次。**焦点在网页视图中时 Alt+↑ 总是上一级**，页面里的 `<select>` / `<textarea>` 也一样，与 Alt+← / Alt+→ 相同：主进程在 `before-input-event` 中必须同步决定是否拦截，而 `Electron.Input` 与 `WebContents`（含 `focusedFrame`）都拿不到页面中获得焦点的元素，只有向页面执行脚本才能知道——视图没有 preload，不为此注入脚本（15 节））；`F5` 刷新激活标签（焦点在 input / textarea / select / contenteditable 时除外；视图内已处理的按键——`defaultPrevented`，例如资源树内的 `F5` 刷新资源树——不再处理）；鼠标侧键为 `mouseup` 的 `button` 3 / 4（后退 / 前进），侧键的 `mousedown` / `mouseup` / `auxclick` 都阻止默认动作（不用主进程的 `app-command`）。**有模态对话框打开时**（DOM 中有未隐藏的 `[role="dialog"]` / `[role="alertdialog"]`，即 Base UI Dialog / AlertDialog 的弹出层；`OPEN_MODAL_SELECTOR`）这些快捷键与侧键都不处理（否则作用于对话框背后的标签；侧键的默认动作仍阻止。M1-3b 最终审查修复）。系统级侧键（`mouse_event` 的 XBUTTON1 / XBUTTON2）已实测：每按一次后退 / 前进一步，页面不发生历史导航。

**M5 已实现（2026-11-23，设计 `devDoc/2026-11-23-42-m5-design.md` 5.C–5.F，实现记录 `devDoc/2026-11-23-45-m5.md`）**：

- **命令注册表**（`stores/command-store.ts`）：命令 = `{ id, titleKey, group, shortcut?, allowInEditable?, allowWithModal?, hidden?, when?, run }`，feature 经 `useRegisterCommands` 登记自己的命令（shell：侧栏视图、`palette.open` / `palette.openAlt`（hidden 的第二个键）、新建工作区；`use-appearance-commands.ts`：明暗 / 主题 / 语言；address-bar：`nav.*`；tabs：`tab.close`；settings：`settings.open` / `about.open`；explorer：全部折叠 / 定位到当前项；workspace：`workspace.pick`）。唯一的 window keydown 分发 `features/shell/use-command-shortcuts.ts`：跳过 `defaultPrevented` 与 IME 组字（`lib/key-context.ts`），有模态对话框时只执行 `allowWithModal` 的命令，焦点在输入框时只执行 `allowInEditable` 的命令——因此 `Ctrl+W` 在对话框 / 输入框中不再关闭标签，关闭后焦点移到新的激活标签（M1-K14）；`Ctrl+Shift+F` / `Ctrl+B` 在有模态对话框时也不再触发（有意的变化）。网页视图中 `Ctrl+K` / `Ctrl+Shift+P` / `Ctrl+,` / `Alt+W` 也转发给应用（`APP_SHORTCUTS`，15 节第 9 项）。
- **命令面板**（`features/command-palette`，shadcn `command`（`cmdk` 1.1.1）的 `CommandDialog`，`shouldFilter={false}`、`vimBindings={false}`、`loop`）：入口 `Ctrl+K` / `Ctrl+Shift+P`、标题栏中间的按钮、`Ctrl+K` 再按关闭。分组：最近使用（当前工作区 8 条）、工作区（按最近打开）、命令（不列 hidden 与 `when` 不满足的，显示快捷键）、文件（输入 ≥ 2 字符，150 ms 防抖调用 `search.query`，当前工作区 `limit: 20`；只显示与当前输入一致的那次查询的结果，选中后经资源树定位并打开）。筛选与排序统一用 `lib/text-match.ts`（NFKC + 小写 + 平假名→片假名；名称前缀 > 名称包含 > 说明包含，D5）；IME 组字中的按键由 `palette-keys.ts` 阻止。关闭（未执行动作）时经 `lib/focus-return.ts` 把焦点还给原来的元素或网页视图（`web.unfreeze { refocus: true }`）。
- **最近使用**（D1 / D2）：`tabs-store` 的 `open` / `openHere` / `navigate` 带 `opts.source`，`shouldRecordRecent(kind, source)`（`packages/shared/src/recent/policy.ts`）只记明确的打开动作——资源树的双击 / Enter / 新标签打开（`tree-open`）、命令面板、工作区总览记文件与目录，插件宿主（目录视图等）只记文件；资源树单击 / ↑↓ 停留（`tree-select`）、地址栏、后退 / 前进不记。命中时 store 写 `recentSignal`，`<RecentRecorder />`（`app.tsx`）调用 `recent.record`（标题截 500 字符）。设置页「隐私」可清除全部。
- **工作区选择器**（`features/workspace/picker`，设计稿 `devDoc/assets/2026-11-23-m5-design/workspace-picker.html`）：标题栏的工作区按钮（颜色圆点 + 名称）、地址框左端的工作区按钮与 `Alt+W` 打开同一个选择器（`ui-store.pickerOpen`）；形式按 `workspace.pickerStyle`：**圆环**（默认；Base UI `Dialog`，网页视图随之冻结；3D 圆环只显示正面 ±2 共 5 张、首尾相接，头部「リング / リスト」切换记在 `workspace.pickerView`，简要 / 详细记在 `workspace.pickerDetail`，详细卡片显示说明、`workspace.summaries` 的条目数与根级前 4 个条目、绝对时间）或**菜单式**（`workspace-menu.tsx`，合并原标题栏与地址框的两份菜单：颜色圆点、相对时间、编号；超过 8 个时有筛选框；新建 / 重命名 / 恢复默认名称 / 删除作用于当前工作区）。误操作防护：只有正面卡片能切换（点击或 Enter），点侧面卡片只转到正面，正面换过 250 ms 内圆环上的点击一律无效（`FRONT_GUARD_MS`），滚轮只转动，IME 组字中不处理按键、筛选在 `compositionend` 后执行（`use-filter-input.ts`），按压反馈期间 Esc 取消切换；`Alt+1–9` 直选（编号按 sortOrder）；Esc 分级（删除确认 → 筛选词 → 关闭）。**编辑模式**（琥珀色开关，不记忆）：正面卡片变为表单（名称、说明、颜色 9 色，失焦 / Enter 即时保存，Esc 撤销该字段），圆环末尾「+」卡片新建，`Alt+←/→` 调整顺序（`workspace.reorder`），删除时卡片翻到背面确认（默认焦点「キャンセル」）。工作区 `color` 存颜色键（`packages/shared/src/workspace/colors.ts` 的 `WORKSPACE_COLORS`），色值由 `--ws-*` 令牌给出。动效经 `@pch/ui/lib/motion`（弹簧令牌 `ring` 等），`appearance.reduceMotion` 生效时取消位移、只保留透明度变化（shadcn Dialog 自身的 `tw-animate-css` 进出场不受该设置影响，待需求方确认）。性能实测（20 个工作区，生产构建）：`Alt+W` 到筛选框获得焦点且正面卡片已渲染 18–35 ms，连续转动期间平均 60 fps。工作区一览页的卡片也显示颜色带与说明，「編集…」对话框可改名称 / 说明 / 颜色；一览中删除当前工作区时确认框常驻到删除完成（`ui-store.deleteWorkspaceTarget`，M2-F2）。
- **设置页**（`pch-settings:`，`kind: 'settings'`，入口：活动栏齿轮、`Ctrl+,`、命令面板）：左侧分区导航（一般 / 外观 / 工作区 / 资源管理器 / 预览 / 缓存与扫描 / 远程连接 / 桌面记录 / 隐私，末尾「このアプリについて」）+ 右侧设置项，顶部搜索按名称 / 说明筛选；控件类型与 min / max 从 zod schema 读出（`validate.ts`，数值项 `Input type="number"` + 单位，无效时显示错误不提交，D6），与默认值不同时显示「既定に戻す」。外观分区的主题为带色板的卡片；资源管理器分区末尾是文件关联（`preview.associations`，可删除单条）；缓存与扫描分区显示缓存占用与「清空缓存」（`vfs.cacheInfo` / `vfs.clearCache`）。写入为乐观更新，失败时按键回滚并重新拉取（`data/settings.ts`）。
- **关于页**（`pch-about:`，`kind: 'about'`，入口：设置页导航末项、命令面板；标题栏的 Logo 不加菜单）：内联 Logo、产品名、版本、Electron / Chromium / Node 版本、平台，数据目录与日志目录（只显示），「ログフォルダーを開く」「データフォルダーを開く」（`system.openAppFolder`）、「診断情報をコピー」。
- 两个内置页面与工作区一览一样是 `LayoutLocationKind` 的一种（`'settings'` / `'about'`，`packages/shared/src/layout/types.ts`；位置构造在 `location.ts`），标签、地址栏（一段，标题按当前语言取）、后退 / 前进自然可用。

### 12.3 渲染端入口

```tsx
// apps/desktop/src/renderer/src/main.tsx
installGlobalErrorHandlers(); // window.onerror / unhandledrejection → log.write → main.log

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>        {/* 渲染异常时显示可恢复的提示并写入 main.log，而不是白屏 */}
      <AppProviders>           {/* Query → Theme → I18n → Tooltip；主题与语言都来自设置缓存 */}
        <App />
      </AppProviders>
    </RootErrorBoundary>
  </StrictMode>
);
```

`index.html` 在 `<head>` 中同步加载 `theme-init.js`，在 React 挂载前从 `window.pch.bootstrap` 应用主题、强调色、密度与语言；各 Provider 首帧也从 bootstrap 读取初始值，因此不会出现主题闪烁或语言跳变。

---

## 13. 数据库设计

位置：`userData/data/pch.db`；启动时设置 `PRAGMA journal_mode = WAL` 与 `PRAGMA foreign_keys = ON`，并执行 Kysely 迁移（`infra/db/migrations/`）。下面以 SQL 描述表设计，各表在对应里程碑以迁移的形式落地（已实现：`settings`（迁移 0001）、`workspaces` 与 `workspace_entries`（迁移 0002，同时写入默认工作区 `default`）、`workspace_entries.refresh_level` 与 `index_targets`（迁移 0003，同时把已有条目 URI 的结尾 `/` 去掉，驱动器根 `file:///C:/` 除外）、`refresh_level` 改名为 `cache_strategy`（迁移 0004，旧值与 CHECK 约束保留）、`launch_capabilities`（迁移 0005）、`desktop_snapshots` 与 `desktop_items`（迁移 0006，M3 桌面记录）、`connections`（迁移 0007，M4）、`recent_items`（迁移 0008，M5 最近使用））。

```sql
-- 时间戳一律为 UNIX 毫秒（INTEGER）；JSON 列以 TEXT 存储
CREATE TABLE workspaces (                             -- M1-1 已实现
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT,
  color          TEXT,                                -- M5：颜色键（WORKSPACE_COLORS 9 个之一，如 'blue'）或 NULL；色值由 --ws-* 令牌给出，非法值读出时视为 NULL
  sort_order     INTEGER NOT NULL DEFAULT 0,
  archived       INTEGER NOT NULL DEFAULT 0,          -- boolean
  last_opened_at INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE workspace_entries (                      -- M1-1 已实现
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id    TEXT,                                  -- NULL 为根；只能指向 group
  kind         TEXT NOT NULL CHECK (kind IN ('group', 'folder', 'file')),
  label        TEXT NOT NULL,
  uri          TEXT,                                  -- group 为 NULL
  sort_order   INTEGER NOT NULL DEFAULT 0,
  meta         TEXT,                                  -- JSON：备注、图标、颜色
  cache_strategy TEXT CHECK (cache_strategy IN ('passive','default','active','all')),  -- 迁移 0003（原名 refresh_level，0004 改名）；NULL 沿用全局默认，仅 folder 使用
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_entries_ws_parent ON workspace_entries (workspace_id, parent_id);

CREATE TABLE index_targets (                          -- 迁移 0003 已实现：「建立索引」的目录
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uri          TEXT NOT NULL,                         -- 已规范化，位于该工作区某 folder 条目之下
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, uri)
);

CREATE TABLE launch_capabilities (                    -- 迁移 0005 已实现：文件关联的打开方式检测结果（每台机器每个扩展名一份）
  machine     TEXT NOT NULL,                          -- 检测所在机器的主机名（os.hostname()）；数据库随漫游配置文件到别的机器时不沿用
  ext         TEXT NOT NULL,                          -- 不含点的小写扩展名
  data        TEXT NOT NULL,                          -- LaunchCapabilities 的 JSON（含「检测成功但没有任何方式」）
  detected_at INTEGER NOT NULL,                       -- UNIX 毫秒
  PRIMARY KEY (machine, ext)
);

CREATE TABLE desktop_snapshots (                      -- 迁移 0006 已实现（M3 桌面记录，11.4 节）
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  machine    TEXT NOT NULL,                           -- 主机名（os.hostname()）；只读写本机的行（数据库可能随漫游配置到别的机器）
  kind       TEXT NOT NULL,                           -- auto / manual / exit / exit-none（不加 CHECK，读出时未知种类按 manual 处理）
  created_at INTEGER NOT NULL,                        -- auto 原地更新时同时更新
  logon_at   INTEGER NOT NULL,                        -- 所在 Windows 登录会话的开始时刻（「上一次登录」的判断依据）
  name       TEXT                                     -- 用户改的名称；NULL 显示种类与时间
);
CREATE INDEX idx_desktop_snapshots_machine_created ON desktop_snapshots (machine, created_at);

CREATE TABLE desktop_items (                          -- 迁移 0006 已实现
  id          INTEGER PRIMARY KEY AUTOINCREMENT,      -- 恢复时渲染端只传这个 id
  snapshot_id INTEGER NOT NULL REFERENCES desktop_snapshots(id) ON DELETE CASCADE,
  sort        INTEGER NOT NULL,                       -- 快照内的顺序（恢复按此顺序启动）
  data        TEXT NOT NULL                           -- DesktopItem 的 JSON（含 exe、路径、只读、bounds；不含整串命令行）；读出时 zod 校验，非法项丢弃
);
CREATE INDEX idx_desktop_items_snapshot ON desktop_items (snapshot_id);

CREATE TABLE connections (                            -- 迁移 0007 已实现（M4，取代原草案：删去 kind / domain，只有 SFTP）
  id          TEXT PRIMARY KEY,                       -- crypto.randomUUID()
  name        TEXT NOT NULL,                          -- 显示名
  host        TEXT NOT NULL,
  port        INTEGER NOT NULL,                       -- 默认 22
  username    TEXT NOT NULL,                          -- 登录用户
  auth        TEXT NOT NULL,                          -- 'password' | 'key'
  key_path    TEXT,                                   -- 私钥文件的本地路径（连接时读取，不复制）
  secret      TEXT,                                   -- safeStorage 加密（base64）：密码，或私钥口令；NULL = 无
  sudo_secret TEXT,                                   -- safeStorage 加密：另设的 sudo 密码；NULL = 同登录密码（私钥登录时为无）
  identities  TEXT NOT NULL,                          -- JSON 字符串数组：可切换的目标用户（app1、root…）
  host_key    TEXT,                                   -- JSON {algorithm, fingerprint(SHA256:…)}：已信任的主机密钥；NULL = 未信任
  options     TEXT NOT NULL,                          -- JSON：sftpServerPath（NULL = 自动探测）
  auth_state  TEXT NOT NULL DEFAULT 'ok',             -- 'ok' | 'auth-failed' | 'sudo-auth-failed'：认证锁定，跨重启保留（7.6 节）
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE sessions (                               -- 原 M3 的应用内会话，已移到「后续」（11.3 节）
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  snapshot     TEXT NOT NULL,                         -- JSON：SessionSnapshot
  updated_at   INTEGER NOT NULL
);

CREATE TABLE settings (                               -- M0 已实现：只保存与默认值不同的键
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                           -- JSON
  updated_at INTEGER NOT NULL
);

CREATE TABLE edit_sessions (
  id                TEXT PRIMARY KEY,
  uri               TEXT NOT NULL,                    -- 远端资源 URI（ftp/sftp）
  local_path        TEXT NOT NULL,
  base_remote_mtime INTEGER NOT NULL,
  base_remote_size  INTEGER NOT NULL,
  synced_hash       TEXT NOT NULL,                    -- 最后一次同步时本地文件的 SHA-256
  status            TEXT NOT NULL CHECK (status IN ('editing', 'uploading', 'synced', 'conflict', 'error', 'finished')),
  last_error        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE recent_items (                           -- 迁移 0008 已实现（M5 最近使用，12.2 节）
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uri          TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('file', 'directory')),
  title        TEXT NOT NULL,                         -- 记录时的标题（≤ 500 字符）
  opened_at    INTEGER NOT NULL,
  CONSTRAINT recent_items_workspace_uri UNIQUE (workspace_id, uri)   -- 同一 URI 只更新 opened_at / title
);
CREATE INDEX recent_items_workspace_opened ON recent_items (workspace_id, opened_at DESC);
-- 每个工作区只保留最近 100 条（RECENT_KEEP）：recent.record 在同一事务内 upsert 后删除超出部分；排序 opened_at DESC, id DESC
```

密码等机密永远不发送到渲染进程：返回给前端的 `ConnectionDto` 只包含 `hasSecret` / `hasSudoSecret: boolean`（M4 已实现；渲染端保存时传一次明文，主进程立即加密；`safeStorage` 不可用时拒绝保存机密 `CONN_SECRET_UNAVAILABLE`，不以明文保存）。`auth_state` 的写入与解除见 7.6 节。ID 使用 `crypto.randomUUID()`，不额外引入 ID 库。

**目录缓存库 `index.db`（已实现，2026-11-19）**：与 `pch.db` 分开，位于 `userData/cache/index.db`，只由扫描进程打开（`scanner/cache/cache.ts`，node:sqlite 直接使用，不经 Kysely；`journal_mode = WAL`、`synchronous = NORMAL`、`foreign_keys = ON`）。它是可随时删除重建的缓存：**不做迁移**，表结构在 `scanner/cache/cache-schema.ts`，变化时递增 `CACHE_VERSION`，打开时 `user_version` 不符即删表重建；打不开（例如损坏）时删除 `index.db` / `-wal` / `-shm` 重建一次（5.2 节）。表：`dirs`（整数编号 `id INTEGER PRIMARY KEY AUTOINCREMENT`（编号不复用：目录删除后以同一 URI 重建得到新编号）、目录 URI `uri`（`UNIQUE`）、父目录编号 `parent_id`（NULL 表示根、父行尚不存在的孤儿，或父行已被清理的根；新建目录行与 `prune` 之后由 `adoptOrphans` 认领孤儿，`applyListing` 不以 NULL 覆盖已有值）、上次枚举时目录自身的修改时间 `dir_mtime`、`listed_at` / `checked_at`、`state`（ok / not-found / denied / unreachable）与 `error_code`、热点计分 `visited_at` / `visit_score`、生成列 `depth`（URI 中 `/` 的个数，驱动器根末尾的 `/` 不计）；索引 `dirs_parent (parent_id)`，后台队列用的两个互不重叠的部分索引 `dirs_unlisted (depth, uri) WHERE checked_at IS NULL` 与 `dirs_checked (checked_at, uri, depth) WHERE checked_at IS NOT NULL`，热点查询用的覆盖部分索引 `dirs_hot (visit_score, visited_at, uri) WHERE visit_score > 0`）、`entries`（`dir_id` 引用 `dirs.id`、`(dir_id, name)` 为主键，随目录级联删除：`entries` 不再保存目录 URI，长路径下体积约为原来的 1/3，见 devDoc 11；删除子树只需按 `dirs.uri` 的区间删 `dirs`，条目与 `entries_fts` 的触发器随外键级联生效；搜索由命中的 `entries.dir_id` 关联 `dirs.uri` 做范围筛选与结果 URI 拼接）、FTS5 external content 表 `entries_fts`（`tokenize='trigram'`，由触发器与 `entries` 同步，供文件名搜索使用，8.4 节）。`CACHE_VERSION` = 6（M4：`entries` 加列 `owner TEXT`，远程目录的属主名；从 5 升级时按「`user_version` 不符即删表重建」重建整个库，本地目录的缓存也随之重建）。写入只在内容有差异时发生；配置下发后删除不在任何工作区任何 folder 条目之下的目录缓存。占用与清空经 `vfs.cacheInfo` / `vfs.clearCache`（M5：设置页「缓存与扫描」分区）。

---

## 14. 设置、国际化与主题

### 14.1 设置

设置项以 zod schema 定义在 `packages/shared`，同时提供默认值与校验；数据库只保存与默认值不同的键。

```ts
export const settingsSchema = z.object({
  'general.language':            z.enum(['system', 'ja', 'zh-CN', 'en']).default('system'),
  'appearance.themeMode':        z.enum(['system', 'light', 'dark']).default('system'),
  'appearance.theme':            z.enum(['default', 'aitetsu', 'washi', 'matsuba']).default('default'),   // M5：配色主题（与明暗正交，14.3 节）
  'appearance.accent':           z.enum(['neutral', 'blue', 'green', 'violet', 'orange']).default('neutral'),   // M5 起覆盖主题的 primary；neutral = 「テーマの既定」
  'appearance.density':          z.enum(['comfortable', 'compact']).default('comfortable'),
  'appearance.reduceMotion':     z.enum(['system', 'on', 'off']).default('system'),   // M5：system 跟随系统；on 总是减少；off 不减少
  'workspace.pickerStyle':       z.enum(['carousel', 'menu']).default('carousel'),     // M5：工作区选择器的形式（12.2 节）
  'workspace.pickerDetail':      z.boolean().default(false),                           // M5：选择器卡片 false = 简要 / true = 详细
  'workspace.pickerView':        z.enum(['ring', 'list']).default('ring'),             // M5：选择器头部「リング / リスト」的界面记忆（不在设置页显示，R2）
  'explorer.showHiddenFiles':    z.boolean().default(false),
  'explorer.singleClickPreview': z.boolean().default(true),   // M1-3b：「单击 / 键盘移动选中即在当前标签打开」（键名沿用）
  'preview.associations':        z.record(z.string(), z.string()).default({}),
  'preview.maxTextSizeMB':       z.number().int().min(1).max(500).default(50),   // 自动建立完整行索引的上限（超过时只显示开头 / 末尾 4MB 的部分模式，7.5 节）
  'session.restoreOnStartup':    z.boolean().default(true),   // 原 M3 的应用内会话（11.3 节，已移到「后续」）：暂无用途，是否删除待确认
  'window.onDetachedClose':      z.enum(['close-tabs', 'return-to-main']).default('return-to-main'),   // 同上（多窗口）
  'remote.cacheSizeMB':          z.number().int().min(100).default(1024),   // 下载缓存（7.4 节，「后续」）：暂无用途，保留
  'remote.keepaliveSec':         z.number().int().min(5).max(120).default(15),   // M4：SSH 保活间隔（秒），keepaliveCountMax = 3
  'remote.idleDisconnectMin':    z.number().int().min(1).max(60).default(5),     // M4：无请求多少分钟后断开（含 sudo 通道）
  'vfs.timeoutSec.remote':       z.number().int().min(5).max(120).default(20),   // M4：远程目录读取 / 连接的超时
  'cache.backgroundGapMs.remote': z.number().int().min(100).default(500),        // M4：远程「建立索引」每个目录之后的休息
  'cache.remoteIndexIntervalMin': z.number().int().min(5).max(1440).default(30), // M4：建立索引的远程目录距上次读取超过此值才再读
  'cache.strategy.local':        z.enum(['passive', 'default', 'active', 'all']).default('active'),
  'cache.strategy.network':      z.enum(['passive', 'default', 'active', 'all']).default('default'),
  'cache.activeDepth':           z.number().int().min(1).max(10).default(3),
  'cache.interval.focus.local':  z.number().int().min(2).default(5),     // 关注点的定期确认间隔（秒）
  'cache.interval.focus.network': z.number().int().min(10).default(10),
  'cache.interval.near.local':   z.number().int().min(2).default(30),    // 近
  'cache.interval.near.network': z.number().int().min(10).default(60),
  'cache.interval.far.local':    z.number().int().min(2).default(120),   // 远
  'cache.interval.far.network':  z.number().int().min(10).default(300),
  'cache.backgroundGapMs.local': z.number().int().min(100).default(500), // 后台每个目录之后的休息（毫秒）
  'cache.backgroundGapMs.network': z.number().int().min(500).default(2000),
  'vfs.timeoutSec.local':        z.number().int().min(1).max(60).default(5),
  'vfs.timeoutSec.network':      z.number().int().min(10).max(120).default(10),
  'launcher.autoUploadRemoteEdits': z.boolean().default(true),         // 远程编辑会话保存后自动上传
  'desktop.askOnExit':           z.boolean().default(true),   // M3：退出本应用时是否询问保存哪些桌面项目；false = 不询问、全部保存（「次回から確認しない」写入）
});
export type Settings = z.infer<typeof settingsSchema>;
```

已实现：上面的全部键（`launcher.officeExtensions` / `launcher.officeDefaultAction` 已于 M2 删除，库中残留的旧键被 `resolveSettings` 忽略、不报错）均在 `packages/shared/src/settings/schema.ts` 中定义（`refresh.*` / `vfs.timeoutSec.*` 于 2026-11-19 加入，`remote.pollIntervalSec` 同时删除；`refresh.*` 随后改为 `cache.*`，库中残留的 `refresh.*` 键被忽略）；`cache.*` / `vfs.*` 变化时主进程重新下发扫描配置（7.1 节）。条目级的缓存策略在资源树右键菜单中设置（8.2 节）。`desktop.askOnExit` 由退出对话框的「次回から確認しない」写为 `false`，可在设置页「桌面记录」分区或桌面记录侧栏标题行的「…」菜单「終了時に確認する」中重新打开。**设置页（M5 已实现）显示除以下键之外的全部键**：`session.restoreOnStartup` / `window.onDetachedClose`（原 M3 多窗口与应用内会话设想的键，M3 改为桌面记录后没有代码读取）、`launcher.autoUploadRemoteEdits`（远程编辑会话，「后续」）、`remote.cacheSizeMB`（下载缓存，「后续」）——这 4 个键没有代码读取，保留在 schema 中，是否删除待需求方在 beta 前决定（实现记录 `devDoc/2026-11-23-45-m5.md`）；`workspace.pickerView` 是界面记忆（R2）；`preview.associations` 不是单个控件，在「资源管理器」分区末尾以列表显示、可删除单条。连接池的 `remote.keepaliveSec` / `remote.idleDisconnectMin` / `vfs.timeoutSec.remote` 每次使用时读取，无需重启；保活间隔在建立连接时交给 `ssh2`，已建立的连接保持原值（设置页注明「新しい接続から有効」）。

**设置页的承载方式（M5，取代原写的 `internal://settings` 内部插件）**：设置页与关于页是应用内置页面标签（与工作区一览、桌面快照页同一方式）：位置 `pch-settings:` / `pch-about:`，`LayoutLocationKind` 为 `'settings'` / `'about'`，`features/preview/preview-container.tsx` 渲染 `app/` 经 `renderSettings` / `renderAbout` 传入的 `features/settings` / `features/about` 视图（不是插件），地址栏、标签、后退 / 前进自然可用（设计 4.5）。修改后主进程广播 `settings.changed`，所有窗口即时生效；渲染端写入为乐观更新，失败时按键回滚并重新拉取（`data/settings.ts`）。

### 14.2 国际化

`packages/i18n` 存放 `ja`、`zh-CN`、`en` 三套资源，按命名空间拆分（M0：common、explorer、connections、welcome、errors；M1-2 增加 workspace；2026-11-19 增加 search；M5 增加 about、settings、commands（命令标题）、palette；随功能增加）。主进程与渲染进程用同一个工厂函数创建 i18next 实例，资源随代码打包、同步初始化；语言切换时主进程更新窗口标题（M5 起还要重建托盘菜单），渲染端调用 `changeLanguage`。插件通过 manifest 的 `i18n` 字段注入自己的命名空间。日期、文件大小统一用 `Intl` 格式化。三种语言的键一致性由类型（以日语资源为基准，缺键或多键编译失败）与单元测试（不允许空文案）共同保证。

### 14.3 主题

shadcn/ui 的 CSS 变量体系（Tailwind v4、oklch 颜色）。明暗模式通过 `<html class="dark">` 切换，强调色通过 `data-accent` 属性切换一组变量，紧凑密度通过 `data-density` 调整间距。主题以 SQLite 中的设置为唯一来源，并同步 `nativeTheme.themeSource`，使滚动条、表单控件等原生绘制部分与窗口底色一致（窗口按钮由渲染端自绘，直接使用主题变量）。这里自行实现约 50 行的 ThemeProvider，而不使用 next-themes，因为后者以 localStorage 为存储，与「设置存 SQLite」的要求冲突（shadcn 生成的 `sonner.tsx` 默认引用 next-themes，已改为由调用方传入主题）。

**配色主题（M5 已实现，设计 5.A，配色以设计稿 `devDoc/assets/2026-11-23-m5-design/themes.html` 为准）**：

- 四套：`default`（shadcn neutral）、`aitetsu`（藍鉄：深蓝铁底 + 冷青强调）、`washi`（和紙：纸色底 + 藍墨字）、`matsuba`（松葉：带绿意的灰 + 松叶绿），各有明暗两组。设置 `appearance.theme`，与明暗 `appearance.themeMode` 正交。
- CSS（`packages/ui/src/styles/globals.css`）：`<html data-theme="x">`（default 不设属性），每套主题完整的 shadcn 变量按 `[data-theme='x']` 与 `[data-theme='x'].dark` 组织；**强调色覆盖主题**——`:root[data-accent='y']` 放在主题规则之后（`[data-theme=x].dark` 的优先级 0,2,0 高于单类选择器），`neutral` 表示使用主题自己的 primary（界面文案「テーマの既定」）。默认主题亮色的 `muted-foreground`（在 `muted` 上）与 `ring` 微调到 4.5 / 3.0 以上。扩展令牌：日志级别 `--log-*`（每主题一组，文本预览状态栏与网页预览的提示色改用它）、工作区颜色 `--ws-*`（9 色）、文件图标颜色 `--fi-*`（只分明暗，不随主题：文件类型颜色是外部约定）、Logo 颜色 `--logo-*`（每主题明暗各一组），均映射为 Tailwind 颜色。
- 首帧：`BootstrapData.themeName`，`theme-init.js` 在 React 挂载前写 `data-theme`；`windows/window-factory.ts` 的窗口底色表按主题 × 明暗取值（与各主题 `--background` 一致，新增主题时同步），切换时 `syncWindowChrome` 更新。`ThemeProvider` 写 `data-theme` / `class="dark"` / `data-accent` / `data-density`。标题栏主题菜单增加「テーマ」单选组（D8）。
- 网页视图：Markdown 外壳页按主题取一组颜色（`web-assets/markdown/markdown.css` 按 `[data-theme]` 组织，**颜色从 globals.css 手工抄写，改配色时两处同步**），主题名经 `markdown-shell.ts` 传入、切换时由主进程注入固定脚本（15 节第 9 项）；mermaid 用 `base` 主题 + `themeVariables`。HTML / PDF 是文件本身，不改。插件 SDK 的 `theme` 仍为 `{ mode }`（插件用 CSS 变量，自然跟随）。
- **动效**：`motion` 14.14.0 只是 `packages/ui` 的依赖（R1），`packages/ui/src/lib/motion.ts` 集中令牌（时长 `fast` 0.12 s / `base` 0.2 s / `slow` 0.28 s；缓动 standard / enter / exit；弹簧 `ring` / `snappy` / `emphasized`）并 re-export `motion`、`AnimatePresence`、`MotionConfig`、`useReducedMotion`、`useReducedMotionConfig` 与类型 `Transition`；渲染端只从 `@pch/ui/lib/motion` 引入。`ThemeProvider` 根部 `<MotionConfig reducedMotion>`：`system` → `user`、`on` → `always`、`off` → `never`（`reducedMotionMode`）。简单的进出场（菜单、对话框）仍用 `tw-animate-css`，不受该设置影响（已知，待需求方确认是否处理）。
- **文件图标**（设计 5.B，`packages/ui/src/lib/file-icon-map.ts` / `file-icon.tsx`）：27 类；A 级（大众认知，饱和）Word 蓝、Excel 绿、PowerPoint 橙、PDF 红（另换 `file-type` 字形）、邮件天蓝、文件夹黄（同色半透明填充）、压缩包茶色；B 级（只区分，降饱和）日志、脚本、代码、配置、数据库、证书、Markdown、图片、音视频、可执行等；纯文本 / 未知 / 文件链接为 `muted-foreground`，失效链接 `destructive`。轮转日志（`*.log.1`、`*.log.gz` 等）归 log，`Dockerfile` / `Makefile` / `.env` 等按全名映射。`FileIcon` 默认带 `text-fi-*`，选中行等需要单色时传 `monochrome`。资源树、目录视图、工作区总览、标签头、搜索结果、fallback 预览、命令面板、选择器详细卡片统一使用。不提供「图标单色」设置。
- **Logo「環」**（设计 5.G）：`packages/ui/src/logo-mark.tsx`（`LogoMark`，内联 SVG，颜色 `var(--logo-*, 静态色)` 随主题），用于标题栏左端与关于页；窗口 / 任务栏 / exe 图标用静态版（16.4 节）。

---

## 15. 安全设计

1. 所有窗口统一由 window-factory 创建：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webSecurity: true`。
2. `index.html` 以 meta 声明 CSP（`script-src 'self'`，不允许内联脚本；`style-src` 因组件浮层定位需要 `'unsafe-inline'`）；禁止页面内导航到外部地址，`setWindowOpenHandler` 一律拒绝，外部链接经白名单校验后用 `shell.openExternal` 打开。这些全局限制（`windows/security.ts`）施加于除浏览器视图会话 `persist:pch-web` 之外的所有 webContents（应用窗口在默认会话）；浏览器视图由 `modules/web` 施加自己的处理（第 9 项）。`will-attach-webview` 对所有 webContents 一律拒绝。
3. IPC 校验发送方来源（只接受 `app://renderer` 或开发地址），所有输入经 zod 校验。
4. `pcfs://` 只接受已知 scheme，远程 URI 必须对应已存在的连接；本地路径做规范化，防止路径穿越。
5. 机密使用 `safeStorage`（Windows 下为 DPAPI）加密存储，不进入渲染进程、不写日志。
6. SFTP 主机密钥 TOFU 校验；FTP 明文连接在界面上标注风险并推荐 FTPS。
7. 插件仅能访问 PreviewHost；第三方插件默认关闭，需用户显式启用。
8. 打包时启用 Electron Fuses（`electron-builder.yml` 的 `electronFuses`：关闭 RunAsNode、NODE_OPTIONS 与 inspect 参数，启用 asar 完整性校验与仅从 asar 加载）；渲染端产物位于 asar 内，同受完整性校验保护；发布时进行代码签名（目标结构；M5 的 beta 按需求方决定以未签名 zip 分发，签名的接入点是 electron-builder 的 `win.signtoolOptions` 与证书环境变量 `CSC_LINK` / `CSC_KEY_PASSWORD`（已在 app-builder-lib 26.18.0 中确认存在，未实际签名；届时再确认）。
9. **浏览器视图（M2，主进程 `modules/web`）**：本地 HTML / Markdown 显示在主进程为每个标签创建的 `WebContentsView` 中（独立渲染进程），插件只放占位元素。
   - **已实现**（`web-session.ts`、`web-view-manager.ts`、`navigation.ts`、`shortcuts.ts`、`web.ipc.ts`）：
     - 视图 `webPreferences`：`sandbox`、`contextIsolation`、`nodeIntegration: false`、无 preload、`webSecurity`、`devTools: false`、`spellcheck: false`；会话 `persist:pch-web`（持久化，localStorage 按范围编号隔离）。
     - **脚本注入**：视图无 preload，也不向页面注入脚本；唯一的例外是对应用自己生成的 Markdown 外壳页（`?pch-view=markdown`）由主进程 `setMarkdownTheme` 执行固定的主题切换脚本（`document.documentElement.dataset.theme` 的设置 / 删除，主题名来自 `ThemeName` 枚举，不拼接页面或用户内容）；其他网页视图一律不注入。
     - 会话：注册 `pch-web`（范围内只读，7.3 节）与 `pch-asset`（Markdown 查看脚本，7.3 节）两个处理器，各自外包**发起方检查**：`pch-web`（`guardInitiator`）按 `request.initiatorOrigin` 只放行「无发起方」（应用的 `loadURL` / `reload`）与「同一 `pch-web://<范围编号>` 源」，其余（外站 iframe、其他范围的页面、沙箱 iframe 等不透明源 `"null"`）403（e2e 以其他范围的图片 / fetch 失败确认检查生效）；`pch-asset`（`guardAssetInitiator`）只放行无发起方与来自 `pch-web://` 页面的请求，应用窗口、外站、不透明源 403。范围的含义：页面脚本可同源读出范围内全部文件的内容，且外网放行（可外发）；条目根为驱动器根 / 共享根时范围即整个盘 / 共享；范围判定为字符串比较，经范围内的符号链接 / 联接点可读到范围外。需求方 2026-11-21 了解上述风险后决定维持现状：不收窄范围、外网照常放行、不做 realpath 校验（实现记录 Q2 / Q13）。权限请求与检查除剪贴板写入（`clipboard-sanitized-write`，原型的「复制」按钮）外一律拒绝；`will-download` 一律取消并向该视图发 `web.notice download`。
     - 导航：主框架的 `will-navigate` / `will-redirect` 与 `setWindowOpenHandler` 一律阻止视图自己导航，经 `decideNavigation` 判定——同范围 `pch-web`、范围内 `file:` → `web.navigate`（由应用在标签中打开，新窗口请求为 `newTab`；链接的 `?查询#锚点` 作为 `fragment` 不进入标签的位置，在该标签打开时交给下一次 `web.attach` 拼到加载地址后，Markdown 视图只取 `#锚点`；新标签打开时不带）；`http:` / `https:` / `mailto:` → `shell.openExternal`，**要求用户手势**（M5，M2-Q24 / D13：Electron 45 的 `will-navigate` / `setWindowOpenHandler` 没有手势字段，以「最近一次用户输入」近似——`before-mouse-event` 的 mouseDown 与 `before-input-event` 的 keyDown 更新 `entry.lastInput`，要求 `now - lastInput <= USER_ACTIVATION_MS`（5 秒），否则丢弃并记 warn；已知余量：用户输入后 5 秒内页面脚本发起的导航仍会放行）；同一视图 2 秒内最多一次，超出丢弃并记日志；`web.attach` 对相对范围根的部分逐段解码，含 `.` / `..` / NUL 段或无法解码 → `FS_INVALID_URI`（M5，M2-K6）；其他范围 / 范围外 → `web.notice outOfScope`；其他协议 → `web.notice unsupported`。子框架不拦截。每次主框架提交后清空视图的导航历史（标签历史由应用管理，页面的历史导航无处可去）。页面中点击 `file:` 链接（主框架与 `target=_blank`）在渲染进程即被 Chromium 拦截（`Not allowed to load local resource`），不触发上述事件：结果是静默无反应（不读取文件，但不提示，范围内的 `file:` 绝对链接也打不开）。
     - 按键：`before-input-event` 中应用快捷键（F5、Alt+← / Alt+→ / Alt+↑、Ctrl+W、Ctrl+Shift+F、Ctrl+B、Ctrl+K、Ctrl+Shift+P、Ctrl+,、Alt+W，以渲染端命令注册表〔`stores/command-store.ts`，由 `features/shell/use-command-shortcuts.ts` 统一分发〕为准；`modules/web/shortcuts.ts` 的 `APP_SHORTCUTS`）不交给页面，作为 `web.shortcut` 发给所属窗口——不区分页面中的焦点是否在输入框（主进程拿不到页面的焦点元素，见 12.2 节 `Alt+↑`），页面内下拉选择的 Alt+↑ 也作为「上一级」；鼠标侧键（`before-mouse-event` 的 `back` / `forward`）整组阻止，抬起时转为 Alt+← / Alt+→。
     - 生命周期：每窗口最多 8 个视图（LRU，显示中的除外）；窗口关闭、渲染端提交新文档（重新加载）或崩溃时销毁该窗口的全部视图；退出时全部销毁。
     - 焦点（M2 Task 7 审查修复）：`hide` / `release` / `freeze` 时视图若持有键盘焦点，交回所属窗口的渲染端（`OwnerWindow.focus()`）；`freeze` 交回焦点时报告 `yielded`；`unfreeze({ refocus })` 只在渲染端判断「只因 toast 截图、截图时交回了焦点、期间用户没有在应用中操作（`document.hasFocus()` 且 `activeElement` 为 body）」时把焦点还给视图（审查第 2 轮：无条件还回会抢走用户在资源树等处的焦点）。否则隐藏 / 销毁的视图留着焦点，应用快捷键（Alt+→、F5…）在用户点击之前都不生效（系统级按键实测）。**加载时不抢焦点**（最终修复 I3，Q18）：视图新建 / `loadURL` 时会拿走键盘焦点（实测），资源树 ↑↓ 经过 html / pdf / 图片 / md 时方向键随之进入页面；`attach` 时视图没有焦点（用户在应用界面中操作）则此后视图自己拿到的焦点（webContents `focus` 事件，`setImmediate` 之后处理——在事件中同步交回不生效）交回应用界面，直到用户在视图内按下鼠标（`before-mouse-event` 的 mouseDown；焦点已被交回时按下鼠标把焦点给视图）或 `unfreeze` 还焦点；`attach` 时视图已持有焦点则不干预。**焦点在页面中导航时留在新页面**（试用反馈第 1 项）：在页面中点同范围链接 / 按 Alt+←→（`shortcuts.ts` 转发）时，渲染端先 `web.hide`（同一查看器，复用视图）或 `web.release`（查看器不同，例如 html → md）再 `web.attach`，hide / release 已把焦点交回应用，按上一条规则新页面拿到的焦点会被交回。为此 `hide` / `release` 交回了焦点时按窗口记下「焦点交接」（`WebViewManager.handoffs`：窗口 → 标签）；紧接着的 `attach` 若是同一标签则取走它：不设 guard 并主动 `webContents.focus()` 视图（复用的或新建的）。交接只给紧接着的一次 `attach`（任一标签的 attach 都作废它），用户在应用界面中按下键盘 / 鼠标（应用渲染端 webContents 的 `before-input-event` 非 keyUp / `before-mouse-event` 的 mouseDown，`bindWebViewOwner` 接到 `WebViewManager.appInput`）或窗口的视图全部销毁时也作废——例如页面中 Alt+← 回到文本文件后，在应用中按 Alt+→ 回到网页：焦点留在应用。只看按下：交回焦点后键的抬起落到应用界面，不算用户操作。
   - 渲染端（宿主 `PreviewHost.web` 与截图替身）：M2 Task 7 已实现，见 12.1 节。
10. **桌面记录（M3，主进程 `modules/desktop`，11.4 节）**：恢复功能会启动外部程序，安全边界如下（均已实现）：
   - **渲染端不能指定要启动什么**：`desktop.restore` 只接受快照 id 与项目 id（zod：正整数、至多 500 个），主进程从数据库取出采集时记录的 exe 与参数；不属于该快照的项目 id 忽略。`desktop.save` / `desktop.exit` 只传现场中项目的 key，主进程以 key 在自己的现场里取项目，对不上的 key 被忽略（渲染端不能借此写入任意项目）。快照中的项目全部由主进程的采集器产生。
   - **exe 白名单**（`restore.ts` 的 `RESTORABLE_EXE`）：只启动文件名（不区分大小写）为 `explorer.exe`、`WINWORD.EXE`、`EXCEL.EXE`、`POWERPNT.EXE`、`Code.exe`、`eclipse.exe` 且以 `X:\` 或 `\\`（UNC）开头的 exe；资源管理器不用记录中的 exe，固定为 `%SystemRoot%\explorer.exe`。文件 / 目录参数必须以 `X:\` 或 `\\` 开头（`\foo`、`C:/foo` 等不放行；Explorer 另允许 `::{CLSID}`，严格匹配 GUID 格式；VS Code 另允许 `vscode-remote://`）；VS Code 的目标以 `-` 开头（像选项）时拒绝。启动用 `child_process.spawn`（不经 shell，参数数组），不拼接命令行。已知限制：只比较 exe 文件名，不核对与采集时的进程是否为同一文件（数据库被改写时可借白名单内的文件名启动同名程序；数据库在用户自己的 `%APPDATA%` 中，与改写本应用设置同一信任级别）。
   - **PowerShell 脚本固定**：采集与多标签恢复的脚本是 `collectors/scripts.ts` 中的常量字符串，数据（hwnd、pid、路径列表的 JSON）只经环境变量传入，脚本内不 `Invoke-Expression`；pid / hwnd 在脚本中按纯数字过滤。
   - **只读与不持有句柄**：读取 VS Code 的 `storage.json`、Eclipse 的 prefs 只读打开、读完即关；不写入、不修改其他程序的状态文件（文件系统原则）。
   - **不保存整串命令行**（设计 5.6）：Eclipse 只取 `-data` 的值；其余类别只保存路径、只读标记、exe 路径与窗口矩形。日志中只写各类的个数，不写路径。
   - **按机器隔离**：快照只读写本机（`machine` = 主机名）的行，数据库随漫游配置到别的机器时不列出、不提示、不恢复那台机器的快照。
   - **e2e 假模式**（`PCH_E2E_FAKE_DESKTOP`）只在未打包时读取，打包后的应用不受环境变量影响（同 `PCH_E2E_FAKE_LAUNCHER`）。
11. **UNC 访问范围（M1-K17，M5 部分修正，设计 5.H，控制者决定；`vfs/remote-access.ts`）**：
   - **目的**：渲染端（含被入侵的渲染进程）不能对任意 UNC 主机（`file://<host>/…`）发起 stat / 读取，借 SMB 连接把 Windows 的 NTLM 凭据交给攻击者的主机。本地盘（host 为空）没有这个泄露面，不限制。
   - **已实现**：`RemoteAccess` 同时判定 sftp 与 UNC：UNC URI 必须在某个工作区的 **folder 条目之下**，或 **file 条目所在目录之下**（网页视图的范围根，7.3 节；只有一段路径的 `file://host/x` 只放行该 URI 本身，不放行整个主机）。判断以 `new URL()` 解析后的 host（已小写）与解码并小写的路径（SMB 大小写不敏感）按「等于根或以根 + `/` 开头」比较（`proj` 不匹配 `project2`）；解码后含 `\`、NUL、`.` / `..` 段的一律拒绝。检查点与 sftp 相同：`vfs.*`、`doc.*`、`web.*`、`launcher.*`、`system.revealInOs` / `system.openPath` 的 IPC handler 入口与 `remoteOp`；范围外 → `IPC_FORBIDDEN`（界面上为通用的「禁止」文案）。`file:////host/…`、`file:///%5C%5Chost…` 在 `fileURLToPath` 处即抛错（`FS_INVALID_URI`），不构成绕过（未单独加测试）。
   - **`entry.add` 例外**：添加条目是用户明确的动作，主进程要对尚不是条目的 URI 做 `vfs.stat` 校验，因此不经范围检查。
   - **残余风险（R6，待需求方决定）**：被入侵的渲染端可以先调用 `entry.add` 添加 `file://evil/share` 为条目（触发一次 stat，即一次 SMB 连接），再在范围内访问——K17 只是部分缓解（正常界面之外无法悄悄访问任意主机，但 `entry.add` 这一条路仍在）。可选的加固：对 `entry.add` 中**新出现的 UNC 主机**由主进程弹出确认框；它改变添加条目的交互，是否在 beta 前追加由需求方决定（实现记录 `devDoc/2026-11-23-45-m5.md`）。
   - **验证**：只有单元测试（本机没有真实 UNC 共享，未实机验证）。
12. **启动本机程序的限制（M5，M2-K5 / D14）**：`launcher.capabilities` / `launcher.open` 只接受 Office 扩展名白名单（`packages/shared/src/launcher/types.ts` 的 `OFFICE_EXTENSIONS`；插件侧 `plugins/builtin/src/office/index.ts` 保留同一份清单，以 `app/office-extensions.test.ts` 断言一致，R5），其他扩展名返回空能力 / `LAUNCH_FAILED`，不执行 PowerShell；网页预览的「既定のアプリで開く」（`web-host.ts` 的 `openExternal`）对可执行类扩展名先弹出与 fallback 相同的确认框。

---

## 16. 构建、开发与打包

### 16.1 electron-vite 配置

```ts
// apps/desktop/electron.vite.config.ts
export default defineConfig({
  // 主进程：dependencies 默认外置（由 electron-builder 打入安装包），workspace 包被打包进产物
  main: {},
  // preload 运行在 sandbox 中，只能 require('electron')：必须把依赖全部打包进来
  preload: { build: { externalizeDeps: false } },
  renderer: {
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()],
  },
});
```

产物不压缩（electron-vite 默认：本地加载、便于排查）。

### 16.2 `app://` 协议

`app` scheme 需在 ready 之前通过 `registerSchemesAsPrivileged` 注册为 `standard`、`secure`、`supportFetchAPI`；处理函数把请求路径映射到 `out/renderer`（位于 asar 内）并做路径穿越检查。后续 `pcfs` scheme 另加 `stream`、`corsEnabled`。

### 16.3 开发流程

根目录 `pnpm dev` 即 `electron-vite dev`：Vite dev server 提供渲染端（只监听 localhost），主进程 / preload 重新构建后自动重启 Electron，开发窗口中 F12 打开 DevTools。开发环境使用独立的 userData（`PremiumCowHorse-dev`）。Markdown 查看脚本在开发模式下由 `pch-asset://` 代理到 renderer dev server（`/@fs/…`），renderer 的 `optimizeDeps.entries` 包含该入口（否则首次打开 Markdown 时 vite 重新预构建并重载整个窗口）。

### 16.4 打包与分发

`pnpm build` 执行类型检查、`electron-vite build`（产出 `apps/desktop/out`）与 Markdown 查看脚本的单独 vite 构建（`vite.markdown.config.ts`，产出 `out/web-assets/markdown`，约 5.4MB，其中 89 个分块只在含 mermaid 代码块时按需加载；`pnpm start`（`electron-vite preview`）不会构建它，未执行过 `pnpm build` 时 Markdown 查看器 404）；`pnpm dist` 再调用 electron-builder 生成 **zip 免安装文件夹版**（`PremiumCowHorse-<版本>-win-x64.zip`），解压到任意目录后运行其中的 `PremiumCowHorse.exe`，不需要安装与管理员权限。asar 中只包含 `out/` 与主进程的运行时依赖（`dependencies`）。由于使用 `node:sqlite`，无需原生模块重编译步骤。用户数据位于 `%APPDATA%\PremiumCowHorse`，与程序所在目录无关，替换新版本时直接覆盖程序目录即可。

分发形式的选择（实测）：

| 形式 | 结论 | 依据 |
|---|---|---|
| NSIS 安装程序 | 不提供 | 需求方要求免安装 |
| portable 单文件 exe | 不采用 | 每次启动都把约 300MB 解压到 `%TEMP%` 并被杀毒软件扫描，启动 24–31 秒；强制结束后残留解压目录 |
| zip 文件夹版 | 采用 | 首次启动约 15 秒（杀毒软件首次扫描），之后约 1.4 秒 |

**应用图标（M5 已实现，设计 5.G / D9 / D10）**：唯一来源 `apps/desktop/build/logo.svg`（Logo「環」静态版：蓝 `#3778d7` / `#2a5fb7` / `#6d9adc` + 中心琥珀 `#f9b73f`；SVG 注释中不得出现连续两个连字符）。`pnpm icons`（`scripts/build-icons.mjs` → 用 electron 运行 `scripts/icons/render.cjs`：每个尺寸一个离屏 `BrowserWindow` + `capturePage`，裁剪左上 size×size，并断言每张 PNG 的 IHDR 宽高等于 size）生成 `build/icon.ico`（16 / 20 / 24 / 32 / 40 / 48 / 64 / 128 / 256，PNG 内嵌格式，`scripts/icons/ico.mjs` 的 `encodeIco` 有单元测试）、`resources/icon.png`（256）与渲染端 `public/favicon.svg`；产物提交进仓库，平时构建不运行脚本，只在 logo 变化时运行。接入：`electron-builder.yml` 的 `win.icon: build/icon.ico`（exe 资源：资源管理器、任务栏、任务管理器显示的图标；任务管理器的名称来自 exe 的 FileDescription = `productName` PremiumCowHorse）；`BrowserWindow` 的 `icon` = `paths.appIcon`（开发 `apps/desktop/resources/icon.png`，打包后 `resources/app.asar.unpacked/resources/icon.png`——原生代码读取，不能经 asar 虚拟路径，`asarUnpack: resources/**`）；`app.setAppUserModelId` 沿用已有的 `APP_USER_MODEL_ID`。窗口 / 任务栏 / exe 用静态版（任务栏底色由 Windows 决定，与本应用主题无关）；标题栏与关于页用随主题的内联 `LogoMark`（14.3 节）。

**ssh2 的 Pageant 辅助程序（M5，M4-K1）**：`files` 中排除 `!**/node_modules/ssh2/util/**`（`util/pagent.exe` 只在使用 Pageant 时被 `ssh2/lib/agent.js` 引用，本应用不用）；包内不再有可执行文件，`ssh2` 不再被整体解包到 `app.asar.unpacked`（`app.asar.unpacked` 只有 `@koromix/koffi-win32-x64` 与 `resources/icon.png`；M5 Task 5 与 Task 17 打包实测，Task 17 另以打包版连接 WSL 的 sshd 展开远程目录，并经系统级截图确认任务栏、资源管理器中的 exe、任务管理器显示「環」图标）。

打包工具链注意事项：electron-builder 自带的 7-Zip 24.09 被公司漏洞管理（TVM）封锁，需安装 7-Zip 25.01 以上版本并以 electron-builder 官方环境变量 `ELECTRON_BUILDER_7ZIP_PATH` 指定（见 README）。若将来恢复安装程序或 portable 目标（二者内部使用 NSIS），需在 `electron-builder.yml` 中设置 `toolsets.nsis: '1.2.1'`（NSIS 3.12），默认的 NSIS 3.0.4.1 含 CVE-2023-37378。

---

## 17. 质量保障

| 层次 | 内容 | 工具 |
|---|---|---|
| 单元测试 | layoutReducer、URI 工具、插件匹配算法、设置 schema | vitest |
| 服务测试 | 各 service + 内存数据库（`node:sqlite` 的 `:memory:`），含事务并发安全测试 | vitest |
| Provider 集成测试 | 用容器启动 FTP / SFTP 服务器做真实读写与断线重连 | vitest + Docker |
| 端到端测试 | 启动与沙箱/白名单、CSP、错误落盘、设置持久化、自绘窗口按钮；经 IPC 的工作区流程与重启后保留（M1-1）；资源树的懒加载、键盘、错误行与重试、先显示缓存再按检查更新（新建 / 删除）、切回窗口不显示「加载中」、折叠后再展开 / 切回工作区时重新列出、拖放前后的磁盘递归快照、右键菜单、工作区切换器（M1-2）；原则回归（展开 `A\B\C` 时改名上级 `A`）、条目级缓存策略 / 建立索引菜单、断开图标（刷新与缓存引擎，`e2e/app.spec.ts`、`e2e/explorer.spec.ts`，共用 `e2e/support.ts`）；标签的打开 / 关闭（`e2e/tabs.spec.ts`；M1-3b 起为浏览器式：单击当前标签、中键 / Ctrl+单击 / 菜单新标签、目录单击不展开、双击 / 箭头展开；M2 反馈第 3 项：文件单击 / ↑↓ 停留为文件信息、已在显示时不动，双击 / Enter 为默认查看器，Ctrl+单击 / 中键 / Ctrl+Enter 为新标签默认查看器）、树跟随标签与 ↑↓ 防抖打开、同步不循环（`e2e/tree-sync.spec.ts`，M1-3b）、全部折叠 / 定位到当前项、分组抽屉的互斥与恢复、未分组条目在上（`e2e/drawer.spec.ts`，M1-3b）、fallback 的文件信息与三个动作、可执行文件的确认、没有预览标签（点击 / 按键 / 插件动作都不改变标签）、插件崩溃只影响自己的标签（`e2e/preview.spec.ts`：在主进程替换 `shell.openPath` / `shell.showItemInFolder` 计数，不真的打开应用；崩溃插件见 9.3 节）（M1-3）；后续：打开与弹出标签、重启后恢复 | Playwright（Electron 模式） |
| 视觉确认 | 系统原生绘制的部分（窗口边框、系统按钮等）不在页面截图中，需用系统级截屏确认（方法见 `knowledge/`） | Playwright + PowerShell |
| 静态检查 | 类型检查（M5 起含 `e2e/`：根 `typecheck` 追加 `tsc -p e2e/tsconfig.json`，M1-K19）、lint、模块边界规则（5.5 节）、i18n 键一致性（类型 + 单元测试） | tsc、eslint、eslint-plugin-boundaries、vitest |
| 依赖审计 | 已知漏洞（M5：`pnpm audit --prod` 无已知漏洞；完整结果见实现记录 `devDoc/2026-11-23-45-m5.md`） | pnpm audit |

---

## 18. 实施路线图

| 阶段 | 目标 | 主要交付 |
|---|---|---|
| M0 骨架（✅ 2026-11-18 完成） | 跑通全链路 | monorepo、electron-vite、app 协议、类型化 IPC、SQLite 与迁移、设置服务、i18n、主题、自绘标题栏与窗口按钮、lint 与模块边界、错误落盘、zip 分发 |
| M1 工作区与本地文件（✅ 2026-11-20 完成，合并到 `main`，标签 `m1`；总结与待确认清单见 `devDoc/2026-11-20-21-m1-summary.md`） | 能日常使用 | 分子计划：M1-1 数据层（工作区与条目的存储与规则、本地 Provider、VFS 与 IPC）；M1-2 资源树（工作区切换、虚拟化条目树、懒加载、拖入添加、右键菜单、变更感知；✅ 2026-11-18 完成，从系统资源管理器真实拖入待需求方确认）；**目录刷新与缓存引擎**（插入在 M1-2 之后：去掉 `fs.watch`，扫描进程 + `index.db`、koffi 枚举、4 级刷新级别与建立索引、断开显示、按松手位置插入、拒绝临时文件拖入；✅ 2026-11-19 完成，设计第 7 节的决定待需求方确认，见 `devDoc/2026-11-19-06-refresh-cache.md`）；**文件名搜索**（复用 `index.db` 的 FTS5 trigram 索引：活动栏的搜索视图、`Ctrl+Shift+F`、在资源树中定位；✅ 2026-11-19 完成，设计 `devDoc/2026-11-19-02-search-design.md` 第 6 节的决定待需求方确认，见 `devDoc/2026-11-19-07-search.md`）；**M1-3 标签与目录视图（✅ 2026-11-19 完成，为「最低可用原型」：单窗口 layoutReducer、标签栏与预览模式、最小插件体系与 folder / fallback 插件、激活目录按关注点处理；设计 `devDoc/2026-11-19-12-m1-3-design.md` 第 6 节的决定待需求方确认，见 `devDoc/2026-11-19-14-m1-3.md`；标签拖拽 / 固定 / 溢出菜单、网格视图、会话恢复均推迟）**；**M1-3b 导航、同步与资源树改进（✅ 2026-11-20 完成：标签历史与逻辑路径、浏览器式打开（取消预览标签）、应用地址栏、树与预览区双向同步、类型图标、定位 / 全部折叠与分组抽屉；设计 `devDoc/2026-11-19-15-navigation-design.md`，部分决定待需求方确认，见 `devDoc/2026-11-19-17-navigation.md`）**；**文本 / 日志预览（✅ 2026-11-20 完成：`@pch/text-engine`、provider `read`、主进程文档服务与 `vfs.sniff`、自写编码判断、文本插件（自绘分页、日志跟随、部分模式）、`PreviewHost.doc`；设计 `devDoc/2026-11-20-18-text-preview-design.md` 第 7 节的决定待需求方确认，见 `devDoc/2026-11-20-20-text-preview.md`）** |
| M2 预览插件体系（✅ 2026-11-21 完成，合并到 `main`，标签 `m2`；总结与待确认清单见 `devDoc/2026-11-21-29-m2-summary.md`；设计 `devDoc/2026-11-20-22-m2-design.md`，实现记录 `devDoc/2026-11-20-25-m2.md`，待需求方确认的决定见其第 4 节；试用反馈的修改 `devDoc/2026-11-21-26-m2-feedback.md`、`devDoc/2026-11-21-28-address-bar-copy-workspace-cards.md`） | 插件化落地 | 查看器切换与「常にこれで開く」、应用消息收纳、浏览器视图（`WebContentsView` + `pch-web://` 范围协议，取代原计划的 `pcfs://`）与 `PreviewHost.web`、html（含 PDF / 图片）/ markdown（GFM、脚注、mermaid）/ office 启动面板插件、Office 打开方式检测与启动（本地 / SMB 文件：编辑 / 保护视图 / 新建，Excel 另有只读）；text 在 M1 内已提前完成；专用 image / pdf / media 插件与 `pcfs://` 推迟 |
| M3 桌面记录（✅ 2026-11-22 完成，合并到 `main`，标签 `m3`；总结与待确认清单见 `devDoc/2026-11-22-36-m3-summary.md`；设计 `devDoc/2026-11-21-31-m3-desktop-snapshot-design.md`，实现记录 `devDoc/2026-11-22-34-m3.md`，试用反馈第 2 轮 `devDoc/2026-11-22-35-m3-feedback-2.md`；Eclipse 实机与真实重启 / 关机场景未验证） | 重启后恢复现场 | 需求方 2026-11-21 改定（取代原「多窗口与会话」）：监控资源管理器（含标签）/ Office 三件套 / VS Code / Eclipse，自动（每次登录一份、原地更新）/ 手动 / 退出时快照（可见快照最多 3 个），关机时不冲掉记录（消失 1 分钟后才移除、会话结束冻结、登录标识），重启后的恢复提示与挑选恢复（exe 白名单、恢复后清空并重新扫描），活动栏视图、快照页与卡片式清单（11.4 节） |
| M4 远程目录（SFTP 只读）（✅ 2026-11-23 完成，合并到 `main`，标签 `m4`；设计 `devDoc/2026-11-22-37-m4-sftp-design.md`，计划 `devDoc/2026-11-22-38-m4-sftp-plan.md`，台账 `devDoc/2026-11-22-39-m4-ledger.md`，总结（控制者裁定、推迟项、未验证项）`devDoc/2026-11-22-40-m4.md`） | 登录客户服务器看目录 | 需求方 2026-11-22 改定：**只做 SFTP 只读**——「远程连接」视图（新建 / 编辑 / 删除 / 测试）、safeStorage 保存凭据、连接池（保活、空闲断开、认证锁定跨重启）、主机密钥确认、以 `sudo su - <身份>` 切换身份浏览、远程目录作为资源管理器条目（只在展开 / 选中时读取，「建立索引」的目录定期读取）、断开显示、远程文件只显示文件信息（7.6 节）。**SMB 放弃**（需求方：意义不是很大）；FTP / FTPS、Office 远程编辑会话（10.5 节）、远程文件下载缓存（7.4 节）移到「后续」 |
| M5 完善与发布（✅ 2026-11-23 完成，**待合并**，分支 `feat/m5-polish`；设计 `devDoc/2026-11-23-42-m5-design.md`，计划 `devDoc/2026-11-23-43-m5-plan.md`，台账 `devDoc/2026-11-23-44-m5-ledger.md`，实现记录（控制者决定、推迟项、未验证项、待需求方确认 / 决定）`devDoc/2026-11-23-45-m5.md`） | 可分发给同事试用的 beta | 主题（三套完整配色 + 动效基础 `motion`）、文件图标按类别着色、Logo「環」与应用图标、内置设置页 / 关于页、命令注册表与快捷键统一、命令面板与最近使用、工作区选择器（圆环 / 列表 / 菜单式、编辑模式）、beta 前修正（M4 K1–K6、M2 F2 / Q19 / Q20 / Q24 / Q25 / K2 / K3 / K5 / K6、M1 K14 / K17（部分）/ K19 / K23）。**非目标**（需求方 2026-11-23）：代码签名（beta 用未签名 zip）、自动更新（维持解压覆盖） |
| 后续 | 扩展 | 第三方插件加载、跨窗口拖拽合并、工作区导出/导入（团队共享案件目录结构）；**远程的扩展**（原 M4：FTP / FTPS、Office 文件的远程编辑会话与冲突处理（10.5 节）、远程文件下载缓存与预览（7.4 节）；堡垒机 / ProxyJump、ssh-agent / Pageant、「不保存密码、连接时询问」按需追加）；**多窗口与应用内会话**（原 M3：LayoutService 与 reducer、标签弹出与移回、会话快照保存与恢复、工作区切换时的会话切换，11.1–11.3 节；需求方 2026-11-21 决定移出 M3，是否还做以后再定）；桌面记录的扩展（恢复窗口位置、更多程序、从本应用启动 VS Code / Eclipse 并与监控结合） |

原计划把「多窗口与会话」放在 M4 之前，理由是它决定标签和插件 viewState 的数据结构，越早定型返工越少；该项移到「后续」后，标签状态仍按 M1-3 的单窗口子集由渲染端持有（11.2 节「已实现」），将来再做多窗口时需重新评估这部分返工。

---

## 19. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| `node:sqlite` 仍在演进，API 可能变化 | 数据层 | 访问收敛在 `client.ts` 与 Repository；保留切换 better-sqlite3 的路径 |
| Kysely 0.x 版本的 API 调整（如 0.29 将迁移 API 移到 `kysely/migration`） | 数据层 | 升级时跑全部数据库测试；使用面收敛在 `infra/db` |
| 公司漏洞管理（TVM）封锁构建工具链中的旧版程序 | 无法打包 | 7-Zip 使用 25.01 以上版本并以环境变量指定；若恢复 NSIS 目标则用 3.12 工具包；新增构建工具时先确认版本 |
| 自绘窗口按钮失去 Windows 11 的贴靠布局面板（Snap Layouts） | 少一种窗口布局入口 | 双击标题栏最大化已验证可用；拖动贴靠、Win+方向键预期可用（未逐一验证）；如用户需要再评估恢复系统按钮 |
| ~~SMB 认证依赖 `net use`，且仅限 Windows~~（SMB 已放弃，需求方 2026-11-22） | — | — |
| FTP 单连接串行、日文服务器编码各异（FTP 在「后续」） | 远程性能与乱码 | 连接池 + 队列；连接级编码选项 |
| M4：在命令通道上走 SFTP 借用 `ssh2` 的内部类 `ssh2/lib/protocol/SFTP.js` | 升级 `ssh2` 后身份切换可能失效 | 固定精确版本（1.17.0）；借用只在 `modules/connection/sftp-bridge.ts` 一个文件；假服务器的集成测试与 WSL 实机测试兜底；退路是自写只读 SFTP v3 客户端（设计 4.3 节） |
| M4：sudo / sudo-rs 的输出措辞与行为因发行版、版本、locale 而异 | 身份切换误判（误报失败 / 误锁） | 命令以 `exec env LC_ALL=C sudo …` 执行；成功以进程表判定而不是输出；4 个发行版（Ubuntu sudo-rs / Debian / Alma / openSUSE）实机测试；残余风险见 7.6 节 |
| 终端策略禁止 PowerShell | Office 打开动作（只在将来的预览窗口中提供） | 改用 koffi 调用 `ShellExecuteExW`（koffi 已引入）；默认「编辑打开」也可退回 `shell.openPath` |
| 文件关联被第三方软件改写或 Office 修复后变化 | 打开方式显示不准 | 检测结果按机器持久保存，可在面板上手动「再検出」刷新（不再每次启动重新检测） |
| Excel 不能同时打开两个同名工作簿 | 远程缓存副本与本地同名文件冲突 | 属 Office 自身限制，检测到同名已打开时给出提示 |
| 远程编辑期间他人修改了服务器上的文件 | 覆盖他人修改 | 上传前比对远端基线，冲突必须由用户选择处理方式 |
| 超大文件、超大目录 | 卡顿 | 文本大小上限与截断、虚拟滚动、目录枚举在扫描进程中进行（koffi 异步调用在线程池执行，一次系统调用取回 64KB，不阻塞主进程与窗口）、展开时先显示缓存；降级模式的直接枚举仍为最多 16 并发的分批 stat、可取消（已发出的单个系统调用无法中止） |
| 多窗口状态不一致 | 标签丢失或重复 | 主进程单一事实来源 + 纯函数 reducer + 单元测试覆盖 |
| 从 zip / Outlook / 浏览器拖入「虚拟文件」时 Chromium 在浏览器进程中把副本写入临时目录（在我们接受放置之后、drop 时写出；未经真机验证） | 副本留在临时目录（应用不写、不删） | 拒绝 `app.getPath('temp')` 之下的系统拖入路径（`ENTRY_TEMPORARY_PATH`）；待实机确认 Chromium 副本目录的规律后可收窄，见 8.2 节 |
| 扫描期间持有目录句柄（M1-2 的 `fs.watch` 长期持有句柄、阻止上级改名，已于 2026-11-19 删除） | 枚举恰好与改名 / 移动上级目录重叠时，资源管理器中的操作失败 | 句柄只在一次枚举期间持有（本地毫秒级），结束（含出错、取消）立即关闭；以允许读、写、删除的共享方式打开；原则回归 e2e（展开 `A\B\C` 时改名 `A` 10 次）全部成功（8.3 节）。网络上的大目录一次枚举可能更长（未实测） |
| 后台扫描给共享文件服务器带来负载 | 影响同事与服务器 | 网络位置默认策略为「默认」（不做全树扫描）；缓存不设过期，不做按轮次的定期扫描；每台主机后台同时 1 个确认、每个完成后休息 2 秒（用户操作中加倍）；目录修改时间不变时不枚举；断开的共享只按退避（30 秒起、最长 5 分钟）探测一个目录。「全部」与「建立索引」用于网络上的大树时填满缓存可能需要数小时（预期的「慢而不打扰」；本地 1 万目录的树在默认 0.5 秒休息下外推约 87 分钟、扫描进程约占单核 1.4%，见 8.3 节） |
| 缓存不设过期，目录修改时间有盲区（子文件内容变化、子目录中的变化不改变上级的修改时间；工具把时间改回、FAT32 2 秒精度） | 资源树与搜索显示过时的信息，可能长期保留 | 需求方已接受（设计 8.5）；关注点每次完整读取；展开、F5 / 重试、从搜索结果定位时发现后只更新或删除出错的部分；搜索结果标注「基于缓存」与更新时刻（8.3、8.4 节） |
| 枚举会让系统更新目录自身的最后访问时间（本机实测：系统管理的访问时间更新为启用） | 属于新原则允许的「读取时由系统自动更新的元数据」；曾经的写属性审核记录风险（I5）也不存在 | koffi 枚举器以只读句柄（`FILE_LIST_DIRECTORY \| FILE_READ_ATTRIBUTES`）打开目录，不请求任何写权限，因此不会产生 WriteAttributes 类审核记录；变化检测用目录修改时间，不依赖访问时间（需求方 2026-11-19 决定，设计第 7 节第 6 条） |
| koffi 加载失败（二进制缺失、平台不支持、打包遗漏） | 失去原生枚举：隐藏文件退回按 `.` 判断；主进程无法识别映射的网络盘 | 扫描进程回退 `node:fs` 枚举并记警告（`[enumerator] native enumeration unavailable …`），主进程启动时记录 `[vfs] drive type detection` 的结果；打包后实测两个进程都能加载（devDoc 06） |
| 扫描进程卡住或反复崩溃 | 树一直「加载中」或不再更新 | 请求 60 秒兜底超时（`FS_TIMEOUT`，不回退直接枚举）；重启 / 降级时断开状态复位（主进程发出 `online`）；意外退出立即重启并重发配置与关注点，5 分钟内 3 次意外退出后进入降级模式（直接枚举、不缓存，7.1 节）；`index.db` 损坏时删除重建 |
| `index.db` 随树的规模增大 | 占用用户磁盘 | 只缓存工作区 folder 条目之下的目录，配置变化后清理；可随时删除重建（`vfs.clearCache`，设置页「缓存与扫描」分区，M5）；1 万目录 / 11 万条目、平均 URI 204 字符的合成树编号化后约 23MB（编号化前 75MB；`entries` 以整数 `dir_id` 引用目录，不再保存目录 URI，见 13 节与 `devDoc/2026-11-19-11-dir-id.md`），真实应用中补满后的体积未验证 |

---

## 20. 文档与知识管理

| 位置 | 内容 | 维护规则 |
|---|---|---|
| `doc/` | 设计文档（本文档） | 项目的**最新事实依据**。实现与设计发生变化时，在同一次改动中同步更新，并在文首记录版本与变更摘要；描述以「目标结构」与「已实现」区分，不写尚未核实的内容 |
| `devDoc/` | 开发过程记录 | 每个开发任务一份记录（`YYYY-MM-DD-主题.md`）：目标、做了什么、关键决策与理由、验证结果、遗留事项 |
| `knowledge/` | 开发中的 tips、错误、知识 | 每遇到一次「非显而易见」的问题记录一条：症状、原因、解决、预防；开始相关工作前先查阅，避免重复踩坑 |
| `CLAUDE.md` | AI 协作约定 | 工作方式、验证要求、文档维护规则；约定变化时更新 |
| `README.md` | 环境与常用命令 | 命令或环境要求变化时更新 |
