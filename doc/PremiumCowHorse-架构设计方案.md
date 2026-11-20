# PremiumCowHorse 架构设计方案

> 版本：v1.18　｜　日期：2026-11-20　｜　位置：`doc/`（项目的最新事实依据，实现变化时同步更新，见第 20 节）
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

对应关系（2026-11-19 时点）：1 → 工作区条目、资源树、扫描缓存与文件名搜索（M1，已实现）；2 → 标签页与预览插件（M1-3 目录视图已实现，文本 / 日志预览随后，其余 M2）；3、6 → 会话快照与恢复（单窗口版先行，多窗口 M3）；4 → 命令面板、最近使用（M5）；5 → 工作区导出 / 导入（后续）。


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
| 未挂载 SMB（需凭据） | `smb://{connectionId}/share/doc` | SmbProvider |
| FTP / FTPS | `ftp://{connectionId}/var/log/app.log` | FtpProvider |
| SFTP | `sftp://{connectionId}/home/ope/batch` | SftpProvider |
| 应用内部页面 | `internal://settings` | （非 VFS，由内部插件处理） |

URI 的 authority 部分使用 **connectionId** 而不是主机名：凭据不会出现在 URI 和条目数据中；服务器地址变更时只需改连接配置，所有引用自动生效。

### 2.4 「目录也是预览」

标签页打开的永远是「某个 URI + 某个预览插件」。目录视图（列表/网格/详细信息、排序、面包屑）就是 `pch.preview.folder` 插件。这样标签、弹窗、会话恢复、"用其他方式打开" 等机制对目录和文件完全一致，没有特殊分支。

### 2.5 主进程是「窗口与标签」状态的唯一事实来源

多窗口下如果每个渲染进程各自保存标签状态，移动标签、弹出窗口、会话保存都会出现一致性问题。因此布局状态（Layout）由主进程持有，渲染进程只发送「意图」（打开、关闭、移动、弹出），主进程用一个**纯函数 reducer** 计算新状态并广播给相关窗口。reducer 放在 `packages/shared`，可单元测试。M1 即按此实现（先只支持单窗口），M3 在其上增加弹出窗口与会话持久化，不需要返工。

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
| basic-ftp | FTP / FTPS 客户端 | 纯 JS、维护活跃、支持断点续传（startAt） |
| ssh2-sftp-client | SFTP 客户端 | 基于 ssh2，API 友好 |
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
| react-markdown + remark-gfm | Markdown 预览 | — |
| pdfjs-dist | PDF 预览 | Mozilla 官方 |
文本 / 日志预览（设计 `devDoc/2026-11-20-18-text-preview-design.md`）的行索引、按行读取与编码判断由工作区包 `@pch/text-engine` 自写，不引入第三方依赖（检测库的取舍见该设计第 4 节）。图片、音视频使用浏览器原生能力，无需依赖。Office 文件改由本机 Office 打开（第 10 节），因此**不再引入** xlsx（SheetJS）与 docx-preview；Office 联动只使用系统自带的 `reg.exe` 与 PowerShell，不新增依赖。

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
│   └── desktop/                  # Electron 应用：src/main · src/preload · src/renderer（electron-vite 目录约定）
├── packages/
│   ├── shared/                   # 三端共用：IPC 契约、领域类型、zod schema、URI 工具、布局 reducer
│   ├── i18n/                     # 语言资源（ja / zh-CN / en）与 i18next 初始化工厂
│   ├── ui/                       # shadcn/ui（Base UI）组件与主题 CSS（供渲染端与插件共用）
│   ├── plugin-sdk/               # 预览插件的类型定义与 definePreviewPlugin 辅助函数
│   └── text-engine/              # 文本预览的纯逻辑（行索引、按行读取、编码判断等）：不依赖任何包，主进程与插件共用
├── plugins/
│   └── builtin/                  # 内置预览插件（单个 workspace 包，M1 创建），每个插件一个子目录
│       └── src/
│           ├── folder/           # M1
│           ├── text/
│           ├── image/
│           ├── pdf/
│           ├── markdown/
│           ├── media/
│           ├── office/           # Office 文件启动面板（调用本机 Office）
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
│   │   │   ├── smb.provider.ts
│   │   │   ├── ftp.provider.ts
│   │   │   └── sftp.provider.ts
│   │   ├── connection-pool.ts        # 远程连接复用、空闲回收、重连
│   │   ├── remote-cache.ts           # 远程文件本地缓存（LRU）
│   │   └── pcfs-protocol.ts          # pcfs:// 协议处理
│   ├── modules/                      # 按业务领域划分，每个模块结构一致
│   │   ├── workspace/
│   │   │   ├── workspace.repo.ts     # 只做数据存取
│   │   │   ├── entry.repo.ts         # 条目的数据存取
│   │   │   ├── workspace.service.ts  # 业务规则
│   │   │   └── workspace.ipc.ts      # IPC handler：参数已校验，只转发给 service
│   │   ├── connection/
│   │   ├── layout/                   # 窗口与标签（持有布局状态）
│   │   ├── session/                  # 会话快照保存与恢复
│   │   ├── settings/
│   │   ├── plugin/                   # 插件发现与元数据（外部插件阶段启用）
│   │   ├── launcher/                 # 外部应用联动：Office 只读/编辑/新建打开、远程编辑会话
│   │   ├── system/                   # 应用信息、渲染端日志写入、在资源管理器显示、剪贴板、选择路径对话框
│   │   └── window/                   # 自绘窗口按钮：最小化 / 最大化 / 关闭发起调用的窗口
│   ├── windows/
│   │   ├── window-factory.ts         # 统一的 BrowserWindow 创建（安全选项集中在此）
│   │   ├── window.service.ts         # 窗口管理与事件广播（M3 起由 LayoutService 驱动）
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
│   │   ├── win32-enumerator.ts       # koffi：只读句柄的目录枚举、GetFileAttributesExW 取目录修改时间、Win32 错误码分类
│   │   ├── fs-enumerator.ts          # 回退：fs-list（隐藏按 . 开头）
│   │   └── create-enumerator.ts      # koffi 可用则用 win32 版，否则回退并记日志
│   ├── cache/                        # index.db（node:sqlite，可随时删除重建）
│   └── schedule/                     # scope（范围计算）、scheduler（优先级、并发、退避）、background-queue（后台队列的候选）、backoff
└── preload/
    └── index.ts                      # 暴露 window.pch
```

`scanner/` 的进程结构见 `devDoc/2026-11-19-01-refresh-cache-design.md` 4.1 节。scanner 与 vfs 的依赖由 lint 约束：scanner 只允许 import `shared` 与 vfs 中登记为 `vfs-portable` 的文件（`local-path`、`errors`、`location`、`path-name`、`fs-list`），这些文件与 scanner 一起禁止 import `electron`；反方向 `main-vfs` 只能以 `../../scanner/main?modulePath` 引用扫描进程入口（electron-vite 把入口单独打包，得到的只是文件路径，主进程不加载扫描进程的代码）。

主进程与扫描进程的消息定义在 `packages/shared/src/scanner/protocol.ts`（zod，两端收到后都校验，无效消息记日志并忽略）：主 → 扫描 `init { cacheFile }`（fork 后第一条）、`configure { config: ScannerConfig }`、`list { id, uri }`、`interest { ownerId, focus, visible, offscreen }`、`windowFocus`、`releaseOwner`、`refresh { uris }`、`cacheInfo { id }`、`clearCache { id }`、`search { id, scopes, terms, kind, showHidden, limit }`、`cancel { id }`（保留；搜索是同步 SQL 无法中途打断，主进程客户端以「丢弃旧结果」实现取消，不发送本消息）、`shutdown`；扫描 → 主 `result { id, ok, value | error }`、`changed { uri }`、`reachability { share, state, since }`、`log { level, message }`（扫描进程的调度器与枚举器日志经此写入 `main.log`，前缀 `[scanner]`）、`ready`。`ScannerConfig = { roots, allRootUris, indexTargets, settings }`；`Interest`、`ReachabilityEvent` 在 `shared/scanner/types.ts`。

扫描进程的生命周期：组合根创建 `ScannerClient` 并 `start()`（`utilityProcess.fork`，`serviceName: 'pch-scanner'`，`stdio: 'pipe'`，stdout / stderr 转写到日志；环境变量 `UV_THREADPOOL_SIZE=16`，扫描进程把同一值作为调度器的 `threadPoolSize`）；退出时 `dispose()` 发送 `shutdown`（扫描进程释放调度器、关闭 `index.db` 后退出；任一步抛错时仍执行后面的步骤并 `exit(0)`），2 秒内不退出则 `kill()`。意外退出：进行中的请求以 `INDEX_UNAVAILABLE` 拒绝并立即重启，重启后重发 `init`、最后一次 `configure` 与各窗口最后的焦点 / 关注点；5 分钟内意外退出 3 次则不再重启，`available` 变为 `false`（降级模式：`vfs.list` 由 `VfsService` 直接枚举、不缓存）。进程退出（将重启）或进入降级模式时，客户端对它记录的每个断开的共享（随 `reachability` 消息维护）发出 `online` 并清空——断开由该进程的探测判定，新进程若仍连不上会重新发出 `offline`，降级模式直接枚举；`ScannerClient.offlineShares()` 返回当前集合（IPC `vfs.offlineShares`）。请求另有兜底超时：60 秒没有结果即以 `FS_TIMEOUT` 拒绝（防扫描进程的事件循环卡住、结果丢失；不用 `INDEX_UNAVAILABLE`，因为扫描进程可能仍在同一共享上枚举，`vfs.list` 回退直接枚举会并发第二次访问）；结果消息校验失败但能读出 `id` 时同样以 `INDEX_UNAVAILABLE` 拒绝对应的请求。`index.db` 打不开（例如 `file is not a database`）时删除 `index.db`、`-wal`、`-shm` 重建一次，仍失败则记错误日志、所有请求以 `INDEX_UNAVAILABLE` 回应（进程不退出，避免反复重启）。

已实现（M0、M1-1、M1-2）：`bootstrap/`、`core/`、`infra/`（db、logger、paths、i18n）、`ipc/`、`modules/`（settings、system、window、workspace）、`vfs/`（types、errors、input-path、local-path、path-name、location、fs-list、vfs.service、vfs.ipc、providers/local.provider）、`windows/`、`preload/`；`scanner/main.ts` 与 `vfs/scanner-client.ts`、`vfs/scanner-process.ts`（扫描进程随应用启动；渲染端的目录请求经由它，见 7.1、8.3 节；`vfs/scanner-config.ts` 的 `buildScannerConfig` 在启动、`workspace.changed`（含切换工作区）与 `cache.*` / `vfs.*` 设置变化时下发配置）；`scanner/enum/`（目录枚举器，已有单元测试；`scanner/cache/`：缓存库 `index.db`（`Cache` 类，node:sqlite，`dirs` / `entries` / FTS5 trigram `entries_fts`；子目录 URI 与 LocalProvider 同法生成，驱动器根 URI 以 `/` 结尾，「在根之下」由纯函数 `isUnder` 判断且大小写敏感；`user_version` 不符则删表重建；队列查询 `nextUnlisted` / `oldestChecked(scopes: Scope[], limit, exclude?)`：`Scope = {uri, maxDepth}`；「从未尝试读取」= `checked_at IS NULL`（`nextUnlisted`，深度浅的优先、同深度按 uri），尝试过的（含读取失败的：`applyListing` / `markChecked` / `setState` 都写 `checked_at`）进入 `oldestChecked`（按 `checked_at` 升序）；范围走 `subtreeCondition`，层数用生成列 `dirs.depth`（URI 中 `/` 的个数，驱动器根末尾的 `/` 不计）；多范围合并去重、limit 为合并后总数；范围小（< 2000 个目录）走主键范围 + 排序，范围大用 `INDEXED BY` 按部分索引 `dirs_unlisted (depth, uri)` / `dirs_checked (checked_at, uri, depth)` 的顺序扫描 + LIMIT（30 万行合成数据、整卷且层数不限：内存库 / 文件库约 0.2–0.3ms；层数上限很小（`maxDepth` 1）时 `oldestChecked` 要沿 `checked_at` 顺序扫很多行，内存库约 15ms、文件库约 25–45ms，由后台队列的批量候选平摊，见 8.3 节）；`CACHE_VERSION` = 5；热点 `hot(k)` 走覆盖部分索引 `dirs_hot (visit_score, visited_at, uri) WHERE visit_score > 0`，不扫描整张表（30 万行合成数据、其中 30 个访问过：约 6.8ms → 0.04ms）；`removeMissing(uri)`：目录不存在时删除它与子树，并从父目录的缓存列表中删除该项（同名的是符号链接时保留），删除了该项时把父目录的 `dir_mtime` 置为 NULL（这是推断，父目录下一次确认必须完整读取），一个事务）；`scanner/schedule/scope.ts`（范围计算纯函数 `computeScope`，设计 8.2：输出定期确认的对象 `periodic: {uri, tier: 'focus'|'near'|'far', full}[]`（关注点 / 近 / 远，同一 URI 取更近的层，只有关注点 `full`；近层、远层各至多 `TIER_LIMIT` = 100 个：按目录树上离关注点的距离取，同等距离时热点优先、再按 URI，近层中视口内可见的已展开目录最优先）与后台队列的范围 `background: {indexTargets: Scope[], hot: string[], ranges: Scope[]}`；目录的策略取包含它的根中最高者，「消极」只有关注点一层；`RootConfig` / `CacheStrategy`（`CACHE_STRATEGIES`）在 `shared/scanner/types.ts`）；`scanner/schedule/background-queue.ts`（后台队列的候选 `BackgroundQueue`：按位置组分别从缓存批量取候选、在内存中逐个消费，见 8.3 节）；`scanner/schedule/scheduler.ts`（调度器 `Scheduler`：P0 用户动作 / 定期确认按层与位置的间隔 / 后台队列每个位置组同时 1 个、完成后休息 `backgroundGapMs`（用户正在操作时加倍），各窗口的范围分别计算后合并、全部失焦时定期确认暂停（后台队列照常）；缓存不设过期（没有「超过 1 小时强制完整读取」）；并发：每个位置组（本地卷 / 网络主机）「定期确认 / 后台队列 / 探测」共用 1 个 + P0 1 个，本地合计最多 4 个，总数不超过 libuv 线程池，本地合计、网络合计、单个组都不占用最后一个线程（被中止但未返回的原生调用继续占名额）；排队的 P0 调用方等待超过 `timeoutSec` 以 `FS_TIMEOUT` 拒绝；调度循环的异常记日志（构造参数 `log`）并在 1 秒后重试；看门狗按「没有进展的时间」计时；探测超时 / `FS_UNAVAILABLE` 使共享断开并按 `backoff.ts` 退避（30 秒起翻倍，最长 5 分钟）——`FS_UNAVAILABLE` 只来自确定的网络 / 设备类错误（win32 枚举器的 `UNAVAILABLE_ERRORS`：15、21、51、53、55、59、64、67、121、1167、1201、1222、1225、1231、1232、1236、1256、2250），因此枚举中途（已有批次）收到时同样判为断开；其他错误码为 `UNKNOWN`，只把该目录记为 `unreachable`（出错的目录在定期确认中按远层的间隔重试，在后台队列中以失败时刻为确认时刻排到后面）；`listNow` 在 2 秒内检查过（任何优先级）时直接返回 `fresh`、不再排 P0（确认时刻在「未来」即系统时钟回拨后，不算 fresh；P0 去重同理，差为负不算重复）；读取得到「不是目录」（`FS_NOT_A_DIRECTORY`，目录被同名文件替换）时删除该目录自身的子树缓存、该行保留为 `unreachable` / `FS_NOT_A_DIRECTORY`（带确认时刻），并对父目录排一次确认（P0，不与刚完成 / 正在执行的 P0 合并），由确认更正该项的类型，不从父目录的缓存列表中删除它；该目录已是此状态时再次出错不再强制父目录（父目录仍列为目录的情形，避免循环），按远层间隔重试（「不存在」才连同父目录列表中的该项一起删除）；读取得到「不存在」（`FS_NOT_FOUND`）时 `removeMissing`，并同样对父目录排一次确认（P0，`force`），由真实列表决定父目录的内容（上级目录改名期间读取、随即改回时，父目录的修改时间不变，只靠推断删除会永远缺少该项）；该目录行保留为 `not-found` / `FS_NOT_FOUND`（带确认时刻，父目录的确认不再列出它时删除这一行），已是此状态时再次出错（父目录仍列出它）不再强制父目录、不再从父目录列表中删除，按远层间隔重试；父目录的确认再次列出一个 `not-found` 子目录时把它的 `checked_at` 置 NULL（状态保持 `not-found`），使它作为「从未尝试过」尽快被重读（上级目录改走又改回后即可恢复，防循环的判断看的是状态，不受影响）；根没有父目录，只删除缓存并通知根；`ScanSettings` 在 `shared/scanner/types.ts`，`listNow` 的返回类型 `DirectoryListing` 在 `shared/vfs/types.ts`）；`scanner/search/search.ts`（文件名搜索后端，Task 11：只读缓存、绝不访问文件系统；`parseQuery` / `matchesName` 在 `packages/shared/src/search/query.ts`，扫描进程与主进程共用；3 字符以上的包含词走 `entries_fts MATCH`，短词与通配词用 `LIKE ... ESCAPE` / `lower() GLOB`；范围用 URI 前缀的范围比较（`scanner/cache/cache.ts` 的 `subtreeCondition`，缓存的子树删除也用它，都走主键索引）；IPC `search.query` 由 `main/ipc/search.ipc.ts` 组装 scopes 并合并固定的单个文件条目，`ScannerClient.search` 以同一 requestId 的新查询 / `vfs.cancel` 丢弃旧结果；见 `devDoc/2026-11-19-07-search.md`）；`packages/shared/src/vfs/normalize-uri.ts`（`normalizeRootUri` / `isUnderUri`，主进程、扫描进程与渲染端共用，缓存的 `isUnder` 即它）；`vfs/location.ts` 由 scanner 与主进程（组合根的超时、扫描配置）共用，主进程启动时按 `driveTypeStatus()` 记一条日志：`[vfs] drive type detection: native (koffi)`，koffi 不可用时为警告（映射的网络盘按本地处理）。M1-2 在 `vfs/` 中加入的目录监听（`fs.watch`）已于 2026-11-19 删除（7.1 节），在 `modules/system` 中加入 `system.revealInOs` / `copyText` / `selectPaths`（均不修改文件；`system.openPath` 于 2026-11-19 删除，M1-3 恢复为只由预览插件的宿主经用户点击调用：先经 `VfsService.stat` 确认存在（带超时与错误码映射），再 `shell.openPath`，失败时以 `UNKNOWN` 拒绝、detail 为系统返回的描述）。主进程至今**没有任何写文件、移动、删除文件的 API**。

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
    │   ├── shell/                    # 标题栏、活动栏、状态栏、命令面板、整体布局
    │   ├── address-bar/              # 应用级地址栏（后退 / 前进 / 上一级 / 刷新 + 逻辑路径，M1-3b）
    │   ├── workspace/                # 工作区切换、创建、编辑
    │   ├── explorer/                 # 资源树（条目 + 真实目录）
    │   ├── tabs/                     # 标签栏、拖拽、弹出
    │   ├── preview/                  # 插件注册表、PreviewHost 实现、PreviewContainer
    │   ├── connections/              # 远程连接管理
    │   └── settings/                 # 设置页（作为 internal://settings 标签打开）
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

切片规则：`app → features → (providers, data, stores, lib, @pch/ui, @pch/shared)`；`providers → data → lib`；feature 之间不得互相 import（需要共享的数据放 `data/`，共享的 UI 放 `packages/ui`，跨 feature 的纯 UI 状态放 `stores/`）。`app/` 不直接依赖 `data/`（lint 强制），需要数据的组件放在 feature 中。

外壳插槽（已实现）：`Shell` 的 props 为 `{ sidebarViews: Record<SidebarView, ReactNode>; workspaceSwitcher: ReactNode; addressBar: ReactNode; tabsArea: ReactNode }`，`app/app.tsx` 把 `ExplorerView`、`WorkspaceSwitcher`、`AddressBar`（M1-3b，标题栏正下方的一行）、`TabsArea` 等组合进去；标签内容同样经插槽组合：`TabsArea` 的 `renderContent(tab)` 由 `app/` 传入 `<PreviewContainer tab plugins />`（features/tabs 与 features/preview 互不 import）；外壳读 `stores/tabs-store.ts`，当前工作区有标签时显示 `tabsArea`，否则显示欢迎页。侧栏 `SideBar` 只提供外框，标题行由各视图自己渲染（资源管理器的标题行带刷新按钮）；新增侧栏视图需要自带标题行。

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

### 6.2 启动与退出流程

启动：开发环境的独立 userData → 单实例锁 → `protocol.registerSchemesAsPrivileged`（必须在 ready 之前）→ `app.whenReady()` → 创建容器（日志、DB 迁移、设置）→ 应用主题（`nativeTheme.themeSource`）→ 注册 `app://` 协议（M2 起加 `pcfs://`）→ 安全策略 → 注册 IPC → 去掉原生应用菜单（自绘标题栏）→ 联动主进程事件 → 注册退出处理 → 创建主窗口（M3 起改为 `SessionService.restoreLastWorkspace()`）。远程连接全部懒连接，不阻塞启动。

退出：`before-quit` 时先阻止退出，按顺序异步释放资源（M3 起先保存会话快照 → 关闭连接池 → 关闭监听器 → 注销 IPC → 关闭数据库）后再真正退出。会话平时也会在变化后防抖保存，即使异常断电，最多丢失约 1 秒的状态。

### 6.3 IPC 契约（共享）

```ts
// packages/shared/src/ipc/contract.ts
import { z } from 'zod';

const route = <O>() => <I extends z.ZodType>(input: I) =>
  ({ input, output: undefined as unknown as O });

// 目标形态节选；已实现：app.getInfo、settings.*、workspace.{list,active,create,update,delete,activate}、
// entry.{list,add,update,remove,move,setCacheStrategy}、index.{setTarget,list}、
// vfs.{stat,list,cancel,interest,refresh,offlineShares,cacheInfo,clearCache,sniff}、doc.*（7.5 节）、search.query、system.{revealInOs,openPath,copyText,selectPaths}、
// window.*、log.write；事件：settings.changed、workspace.changed、vfs.changed、vfs.reachability、window.stateChanged、doc.progress、doc.changed
// （vfs.watch 已于 2026-11-19 删除；system.openPath 同日删除、M1-3 恢复，只由预览插件的宿主调用；launcher.* 等为将来的预览窗口所用，见 10 节）
export const ipcContract = {
  'workspace.list':      route<Workspace[]>()(z.void()),
  'workspace.create':    route<Workspace>()(WorkspaceCreateInput),
  'workspace.activate':  route<void>()(z.object({ id: z.string() })),
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
  'editSession.list':    route<EditSessionDto[]>()(z.void()),
  'editSession.finish':  route<void>()(z.object({ id: z.string() })),
  'editSession.resolve': route<void>()(z.object({ id: z.string(), action: z.enum(['overwrite', 'uploadAsCopy', 'skip']) })),
  'system.openExternal': route<void>()(z.object({ uri: z.string() })),
  'system.revealInOs':   route<void>()(z.object({ uri: z.string() })),
  'system.copyText':     route<void>()(z.object({ text: z.string().max(32768) })),
  'system.selectPaths':  route<string[]>()(z.object({ kind: z.enum(['folder', 'file']), multiple: z.boolean() })),  // 取消时为空数组
  'window.minimize':     route<void>()(z.void()),            // 自绘窗口按钮：作用于发起调用的窗口
  'window.toggleMaximize': route<void>()(z.void()),
  'window.close':        route<void>()(z.void()),
  'window.getState':     route<WindowState>()(z.void()),     // { maximized }
  'log.write':           route<void>()(LogWriteInput),          // 渲染端错误写入 main.log
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
  'connection.status': { id: string; status: 'idle' | 'connecting' | 'online' | 'error' };
  'editSession.changed': EditSessionDto;
  'window.stateChanged': WindowState;
  'doc.progress':      DocProgressEvent;              // 只发给文档所属的窗口
  'doc.changed':       DocChangedEvent;               // 同上
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
      logger.error(`[ipc] ${channel}`, e);
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

错误码按领域前缀划分，定义在 `packages/shared` 的 `ERROR_CODES`：已有 `UNKNOWN`、`IPC_*`（FORBIDDEN / BAD_INPUT / UNKNOWN_CHANNEL）、`SETTINGS_INVALID`、`WORKSPACE_*`（NOT_FOUND / DEFAULT_PROTECTED / NAME_REQUIRED）、`ENTRY_*`（NOT_FOUND / INVALID_PARENT / KIND_MISMATCH / TEMPORARY_PATH）、`FS_*`（NOT_FOUND / PERMISSION_DENIED / NOT_A_DIRECTORY / INVALID_URI / UNSUPPORTED_SCHEME / CANCELLED / TIMEOUT / UNAVAILABLE）、`INDEX_UNAVAILABLE`（扫描进程或其缓存库不可用）、`DOC_NOT_FOUND`（文本文档已关闭 / 因每窗口上限被关闭 / 窗口已销毁，7.5 节）；网络类错误（ETIMEDOUT、ECONNRESET、ECONNREFUSED、ENETUNREACH、ENETDOWN、EHOSTUNREACH、EHOSTDOWN、EIO）映射为 `FS_UNAVAILABLE`（「位置无法访问」）；扫描进程的 win32 枚举器只把确定的网络 / 设备不可用类 Win32 错误码映射为 `FS_UNAVAILABLE`（列表见 5.2 节），其余未知错误码为 `UNKNOWN`（只影响该目录）；扫描进程客户端的 60 秒兜底超时为 `FS_TIMEOUT`；`ERR_INVALID_FILE_URL_*`、`ERR_INVALID_URL`、`ERR_INVALID_ARG_VALUE` 映射为 `FS_INVALID_URI`（M1-2）；M4 增加 `CONN_AUTH_FAILED`、`CONN_TIMEOUT`、`CONN_HOST_KEY_CHANGED` 等。渲染端用错误码查 i18n 文案（`errors.CONN_AUTH_FAILED`），所以错误提示天然支持多语言，主进程不拼接用户可见文案。渲染端未捕获的异常经 `log.write` 写入 `main.log`（12.3 节），用户反馈问题时只需提供这一个文件。

---

## 7. 虚拟文件系统与远程目录

### 7.1 Provider 接口

```ts
// apps/desktop/src/main/vfs/types.ts
export interface FileSystemProvider {
  readonly scheme: 'file' | 'smb' | 'ftp' | 'sftp';
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
}
```

已实现的是上面接口的子集（`stat`、`list`、`read`、`dispose`；`createReadStream` 于 M2 增加；`capabilities` 尚未引入）。**`read(uri, offset, length, signal?)`**（2026-11-20，文本预览）：每次调用 = 打开 → 读 → 在 `finally` 中关闭，不在调用之间持有句柄；到达文件末尾时返回更短的结果（offset 在末尾之后为空），不存在 → `FS_NOT_FOUND`。本地 provider 用 `fs.promises.open(p, 'r')`：libuv 在 Windows 上以 `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE` 打开（`knowledge/windows-and-tooling.md`），读取期间他人仍可追加、改名、删除该文件；但 **读取进行中的那一刻其上级目录不能改名**（Windows 的限制，与共享标志无关），因此只在一次读取期间打开（本地 1MB 约毫秒级）。`VfsService.read(uri, offset, length, signal?)` 同样按位置超时，并接受调用方的 `AbortSignal`（文档关闭时中止索引中的读取）。`watch` 已于 2026-11-19 删除（目录的持续刷新改由扫描进程负责，见下文），目标结构中也不再有 `watch`。`VfsService` 只负责一次性调用（`stat`、条目添加时的校验、扫描进程不可用时的直接枚举）：按 scheme 路由、统一超时（按位置取 `vfs.timeoutSec.local` / `vfs.timeoutSec.network`，整次调用的总时长，`FS_TIMEOUT`）与取消（`vfs.cancel` 通过 requestId 触发 AbortController，`FS_CANCELLED`；同一 requestId 的新请求取代旧请求）。取消与超时以「调用与中止信号赛跑」实现，即使 provider 不响应信号（例如无响应的网络共享上的 readdir）也能按时结束。Node 的文件系统错误统一转换为 `FS_*` 错误码（`vfs/errors.ts`）。新增一种远程类型（例如将来的 WebDAV、S3）只需新增一个 provider 并在组合根注册，其他代码零修改。

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

**SmbProvider（未挂载 SMB）**：以 Windows 为主要目标平台。将 `smb://{connId}/share/path` 解析为 `\\host\share\path`；首次访问某个共享时，用 `execFile('net', ['use', '\\\\host\\share', password, '/user:DOMAIN\\user', '/persistent:no'])` 建立**不占盘符**的会话（用 execFile 而非 shell，避免注入），之后委托给 LocalProvider 读写。后续阶段可用 koffi 调用 `WNetAddConnection2` 替换 `net use`，避免密码出现在进程参数中。macOS/Linux 如需支持，再单独实现。

**FtpProvider**：basic-ftp 的一个客户端同一时刻只能执行一个操作，因此连接池按连接配置维护少量客户端（默认 2 个：列目录与传输分离），每个客户端内部串行队列。支持 FTPS、主动/被动模式、文件名编码（日本服务器常见 Shift_JIS）等选项，存于连接的 `options`。

**SftpProvider**：ssh2-sftp-client，单连接可复用；首次连接时展示主机密钥指纹由用户确认并保存（TOFU），之后指纹变化报 `CONN_HOST_KEY_CHANGED` 拒绝连接。支持密码与私钥两种认证。

**连接池通用策略**：懒连接、空闲 5 分钟回收、断线自动重连一次、连接状态通过 `connection.status` 推送到状态栏。

### 7.3 `pcfs://` 协议：让预览插件「像访问网页资源一样」访问任意文件

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

工作区切换器（已实现，M1-2，`features/workspace`）：标题栏按钮显示当前工作区名称，下拉菜单含工作区列表（当前项打勾，选中即切换并关闭菜单）、新建工作区…、重命名当前工作区…、恢复默认名称（仅默认工作区且已改名时）、删除当前工作区…（默认工作区不显示）；欢迎页的「新建工作区」打开同一个对话框。新建 = `create` 后 `activate`（切换失败时提示「已创建但未能切换」并关闭对话框，避免再次提交重复创建）。**删除当前工作区时先切回默认工作区、成功后再删除**：主进程的 `workspace.delete` 不改变「当前工作区」，先删除会让 `last_opened_at` 最大的另一个工作区短暂成为当前工作区；切换失败则什么都不删。删除只删工作区与条目，确认框说明不会删除磁盘上的文件。重命名 / 删除对话框的目标在打开时锁定（工作区 id），对话框打开期间当前工作区变化（例如主进程事件）也只作用于打开时的工作区（最终审查 #51，e2e `workspace switcher: rename / delete dialogs act on the workspace they were opened for`）。

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
- **键盘与无障碍**：`role="tree"` 只有一个 Tab 停靠点（`aria-activedescendant`），行为 `treeitem`（`aria-level`、`aria-expanded`、`aria-selected`）；↑↓ 移动选择，→ 展开 / 进入首个子项，← 折叠 / 回到父项，Enter 展开或折叠，F2 重命名、Delete 移除（仅条目），F5 刷新（焦点在资源管理器视图内时）。树只处理自身获得焦点时的按键，行内控件上的按键交给控件。折叠时若选中项在其子孙中，选择移到被折叠的节点。M1-3b 起的打开方式与「树跟随标签」见 11.1 节「已实现」的资源树一条（目录单击不展开；双击 / 箭头 / → ← 展开折叠；键盘移动选中后 400ms 在当前标签打开）。
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
| 网络路径：UNC、映射的网络盘（M1）、未挂载 SMB（M4，内部转换为 UNC） | 同本地；每台服务器同时 1 个后台检查 + 1 个用户动作；断开时显示缓存、按退避重试 |
| FTP / SFTP（M4） | 目录修改时间不可靠 → 检查 = 重新列出 |

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
- `tabs.viewAs(mode)` / `tabs.canViewAs(mode)`（`ViewAsMode = 'text' | 'info'`，Task 5）：本标签改用文本插件（常量 `TEXT_PLUGIN_ID = 'pch.preview.text'`）/ 文件信息（fallback）查看当前资源；text 只对文件、文本插件已注册且不是当前插件，info 只要当前不是 fallback；不可用时 `viewAs` 不做任何事。
- `ResourceInfo.textLike?: boolean` 与 `match.textLike?: boolean`（Task 5）：见 9.3 节。
- `PreviewPluginManifest.handlesMissing?: boolean`（文本预览 Task 6）：插件自己处理「文件已不存在」。显示中的文件被删除、容器重新 stat 得到 `FS_NOT_FOUND`（且此前 stat 成功过）时，选中的插件声明了它就继续显示（资源描述为删除之前的，插件不重新挂载；同名文件重新出现时照常更新），否则显示「找不到」与「重试」（此前的行为）。文本插件声明它：日志被删除 / 轮转的间隙保留已显示的内容并提示。
- ~~插件调用宿主动作时预览标签转为常驻~~：M1-3b 取消「预览标签」（设计 `devDoc/2026-11-19-15-navigation-design.md` 2.8，需求方 2026-11-20 确认），宿主不再有「交互后转常驻」的逻辑；所有标签都是普通标签。
- `fs.refresh(uri): Promise<void>`（最终审查修复追加）：让宿主立即重新确认该目录（`vfs.refresh` 该目录，并让其目录查询失效），之后的 `list` 取得确认后的内容。M1-3b 起刷新的入口在应用的地址栏，插件经 `tabs.onRefresh` 收到请求后调用它。
- `fs.rootOf(uri): string | null`（M1-3 追加）：uri 所属的工作区 folder 条目的根（包含它的条目中 URI 最长者，`isUnderUri`），不在任何条目之下时为 null；`i18n.describeError(error)`（M1-3 追加）：宿主 API 拒绝时的错误（带 code）→ 应用的错误文案（`errors:<code>`），插件不必自带错误码文案。
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
- `PreviewContainer`（由 `app/` 经 `TabsArea.renderContent` 组合）：按 `tab.uri` 重建。**工作区总览**（`kind: 'workspace'`，M1-3b）不经插件，显示内置视图 `WorkspaceOverview`（11.1 节「已实现」）。**目录标签不 stat**（最终审查修复）：直接用标签的类型与标题构造 `ResourceInfo`（大小 / 时间为 0，folder 插件不使用）交给插件，断开、无响应、被删除等状态都由插件的 `fs.list`（缓存优先）表现——此前先 stat，共享无响应时要等到 stat 超时（本地 5 秒 / 网络 10 秒）才显示错误页，缓存与「已断开」基本显示不出来，且每次切换标签都在主进程 stat 一次（占用 libuv 线程池，`knowledge/electron.md`）。**文件标签**先 `vfs.stat`（TanStack Query，新鲜期 5 秒——期间切换回标签不再 stat；错误优先于数据，失败时显示错误码文案与「重试」）得到 `ResourceInfo`（链接按 stat 跟随后的类型）；所在共享在 reachability-store 中为断开时不发 stat，只显示文件名与「已断开（重新连接后显示）」，恢复在线后自动 stat。「以文件信息显示」（fallback）对目录也先 stat。然后选插件；插件模块用缓存的 `plugin.load()` Promise + React `use()` 加载（每个插件只加载一次，失败的加载保持失败直到重新加载窗口），外层 `PluginErrorBoundary`（按插件 id 作 key）+ `Suspense`。插件渲染抛错或加载失败时只在该标签显示错误面板（插件名称、「以文件信息显示」切换为 fallback 插件；错误写入 main.log），其他标签与外壳不受影响。（M1-3b 起没有预览标签，宿主不再把标签「转常驻」。）可执行类文件的确认框（shadcn AlertDialog，初始焦点在「取消」）由容器渲染、宿主调用。
- **未匹配文件的 sniff**（文本预览 Task 5）：非空文件没有被任何非 fallback 插件匹配、且有插件声明了 `match.textLike` 时（`needsSniff`），容器先 `vfs.sniff`（显示加载中），结果在该标签的这个位置内缓存（`use-sniff.ts`）；`text` → 资源描述带 `textLike: true`，`scoreResource` 对声明了 `textLike` 的插件视为命中（0 分 + priority，kinds / schemes / maxSize / when 照常），`binary` / `empty` / 读取失败 → `textLike: false`（fallback）。空文件不 sniff（fallback）。
- **查看方式覆盖**（Task 5）：`PreviewContainer` 按标签、按位置的临时状态 `viewAs: 'info' | 'text' | null`（原「以文件信息显示」的 `showInfo` 并入），导航离开后清除；`resolvePlugin`：info → fallback，text → 文本插件（未注册时 fallback），null → 按资源选择（不 sniff）。错误面板的「以文件信息显示」与插件的 `host.tabs.viewAs` 都设置它。
- e2e 的崩溃插件：`features/preview/plugins.ts` 的 `previewPlugins(builtin)` 在 bootstrap 的 `e2eCrashPlugin` 为 true 时追加两个测试插件（`.crash` 渲染时抛错、`.crashload` 懒加载失败）；主进程只在**未打包**且环境变量 `PCH_E2E_CRASH_PLUGIN=1` 时设置该标志（与 `PCH_USER_DATA_DIR` 相同的限制），打包后的应用不会注册它们。

### 9.4 内置插件

| 插件 | 处理对象 | 说明 |
|---|---|---|
| folder | 所有目录 | 列表 / 网格 / 详细信息视图，排序、筛选；viewState 保存视图模式与滚动位置（M1-3：详细信息列表、排序，viewState 只保存排序；M1-3b 最终审查修复起 viewState 保存排序、选中项与滚动位置；路径与「上一级」M1-3b 起由应用的地址栏提供） |
| text | 文本、代码、日志、CSV、bat、ini 等 | 自绘分页视图（任意大小立即打开、只渲染可见行），只读，编码切换，日志跟随末尾（文本预览设计 `devDoc/2026-11-20-18-text-preview-design.md`；CodeMirror 6 改为将来「编辑 / 高亮」的候选） |
| markdown | .md | 渲染 / 源码切换 |
| image | 常见图片 | 缩放、适应窗口 |
| pdf | .pdf | pdf.js，页码与缩放进 viewState |
| media | 音视频 | 原生播放器，依赖 pcfs 的 Range 支持 |
| office | Excel / Word / PowerPoint 等（扩展名可在设置中调整） | 不渲染内容，显示启动面板：只读 / 编辑 / 新建打开（按检测结果显示）与远程编辑状态，见第 10 节 |
| fallback | 其他 | 文件信息 + 用系统默认程序打开 |

需求方决定（2026-11-19）：**资源树只用于展示，对文件的操作都放在将来的预览窗口中**。上表与 9.3 节中「用系统应用打开」「只读 / 编辑 / 新建打开」等打开动作只由预览窗口（标签中的插件）提供，资源树的右键菜单不提供（`system.openPath` 于 2026-11-19 删除，M1-3 恢复为只由预览插件的宿主调用）。

**已实现（M1-3）：folder**（`plugins/builtin/src/folder/`，`match.kinds = ['directory']`）：没有工具栏（M1-3b：面包屑、「上一级」与「刷新」按钮都由应用的地址栏取代，12.2 节）。列表（`role="grid"`）：列为名称（图标区分目录 / 文件 / 链接 / 失效链接）、修改时间（`dateStyle`/`timeStyle` short，按界面语言）、类型（文件夹 / 「扩展名大写 + 文件」/ 链接类型）、大小（1024 进位，目录与失效链接不显示）；点击列头排序（同一列再点反转，`aria-sort`），目录与指向目录的链接始终在前，名称按 `Intl.Collator('ja', { numeric: true })`，其他列相等时按名称升序；排序、选中项（`selectedUri`）与滚动位置（`scrollTop`，滚动停止 150ms 后保存）存于标签的 viewState（只在内存中；同一标签内导航到新位置时 `layoutReducer` 清除，回到按名称升序；**后退 / 前进回到该目录时恢复**——视图按 URI 重建，选中取 viewState 的初值，列表首次就绪时滚到保存的位置，M1-3b 最终审查修复）。`@tanstack/react-virtual` 虚拟滚动（行高 28、`measureElement`、overscan 10；1 万项的目录 DOM 中的行数 ≤ 100，e2e 断言）。「显示隐藏文件」从 `host.settings.get` 读取，打开时隐藏项名称变淡。交互：单击只选中；双击 / Enter 在当前标签打开（M1-3b 设计 2.8）——目录与指向目录的链接 `host.tabs.navigate(uri, 'directory')`，普通文件 `host.tabs.navigate(uri, 'file')`（不 stat），指向文件的链接与失效链接 `host.tabs.navigate(uri)`（宿主 stat；失效时提示错误、标签不变），都进入标签的历史，「后退」回到目录列表；中键 / Ctrl+单击 / Ctrl+Enter 在新标签打开（`host.tabs.open(uri)`，同 URI 已打开则只激活；目录视图的行没有右键菜单，「在新标签页中打开」只在资源树）；Backspace / Alt+↑ 经 `host.tabs.up()` 到逻辑路径的上一级（条目根之上是工作区总览）；↑↓ / PageUp / PageDown / Home / End 移动选中；在标签内导航后焦点回到列表。刷新：地址栏的刷新按钮与全局 `F5`（M1-3b；此前是视图工具栏的按钮与视图内的 `F5`，已删除以免重复触发）经 `host.tabs.onRefresh` 通知插件，插件经 `host.fs.refresh` 让扫描进程立即确认该目录并重新列出，期间保留当前内容（最终审查修复）；刷新（`vfs.refresh` → `scheduler.refresh`）**绕过 P0 的 2 秒去重**（M1-3b 审查修复：此前刚列出后 2 秒内刷新会被静默丢掉），也不与正在执行的 P0 合并，已在排队的仍合并（连按 F5 不重复排队）。**条目之外的目录**（M1-3b 起「上一级」不再越过条目根，界面上已无法到达；保留给旧数据与将来的定位）不进缓存、不在调度范围内，没有 `vfs.changed`，外部变化不会自动显示，要用「刷新」；降级模式（扫描进程不可用、主进程直接枚举）下同样只能刷新。数据：`host.fs.list`（缓存优先）+ `host.fs.subscribe`（该目录的 `vfs.changed` 时重新列出，期间保留当前内容）；出错时显示错误文案（`host.i18n.describeError`）与「重试」，错误优先于旧内容。导航（双击目录）经 `host.tabs.navigate(uri, 'directory')`，宿主不 stat；上一级经 `host.tabs.up()`。**标签中显示的目录被删除**（最终审查修复）：不再依赖 stat——扫描进程在删除某目录的缓存时（读取得到「不存在」、被替换为文件，或父目录的列表中它已消失），除父目录外还对按关注点处理的目录（各窗口的选中目录与标签中的目录）中等于它或在其之下者各发一次 `vfs.changed`（`scheduler.ts` 的 `notifyRemoved`；之后再读取失败不再通知，不会循环），目录视图据此重新列出，`fs.list` 以 `FS_NOT_FOUND` 拒绝，显示「找不到」与「重试」（e2e 断言）。状态行：项目数、「已断开（基于缓存）」（`fs.list` 的 `state` 为 offline：扫描进程判定断开，或渲染端的可达状态为断开；可达状态变化时宿主重建、视图重新列出，显示中的目录随之切换）、读取中；**不显示「基于缓存（N 前）」**（控制者裁定）：检查后内容没有变化时扫描进程不广播 `vfs.changed`，列表的 `checkedAt` 不会更新，「N 前」会越来越旧，而该目录作为关注点实际每 5 秒都确认过，显示出来会误导用户（资源树的悬停提示「上次检查」保持不变）。

**已实现（M1-3）：fallback**（`plugins/builtin/src/fallback/`）：名称、位置（Windows 路径）、类型、大小（1024 进位单位 + 精确字节数，目录不显示）、修改时间（含秒，按界面语言），动作「用系统应用打开」「在资源管理器中显示」「复制路径」。目录由 folder 插件显示（fallback 只在「以文件信息显示」时显示目录）。「用系统应用打开」对可执行类扩展名（`.exe .com .bat .cmd .ps1 .vbs .vbe .js .jse .wsf .wsh .msi .msc .scr .lnk .reg .hta .cpl`，审查时追加 `.pif .scf .msp .jar .appref-ms`，最终审查追加 `.url .website .application .inf .chm .settingcontent-ms .psm1 .psd1 .ps1xml .ws .wsc .sct .vb .appinstaller .msix .appx .xll .diagcab .library-ms .search-ms .gadget`——只增加确认、不阻止打开，需求方可裁剪；大小写不敏感；NTFS 备用数据流的名称（`run.bat::$DATA`、`run.bat:stream`）按第一个 `:` 之前的文件名判断；判断前去掉名称末尾的点与空格——Windows 打开路径时会去掉它们）先弹确认框，取消（按钮 / Esc）时不调用 `system.openPath`。文件且 `host.tabs.canViewAs('text')` 时另有「作为文本查看」按钮（文本预览 Task 5；文本插件注册之前不显示）。

**已实现（文本预览 Task 6）：text**（`plugins/builtin/src/text/`，id `pch.preview.text`）：`match = { kinds: ['file'], extensions: [txt log out md csv tsv json jsonc xml yaml yml ini conf cfg properties toml sql env gitignore editorconfig sh bat cmd ps1 psm1 js ts tsx jsx mjs cjs py java kt c h cc cpp hpp cs go rs rb php html htm css scss less vue svelte gradle], textLike: true }`（扩展名表之外、容器 sniff 为文本的文件也交给它），`handlesMissing: true`。经 `host.doc` 读取（7.5 节），不用浏览器原生滚动高度：
- **视图**（`text-view.tsx` 布局与键鼠）：固定行高 20px，视口只渲染从 `top` 起的可见行（`visible + 1` 行）；行号栏（`gutter.tsx`，宽度按总行数的位数；**部分模式不显示**）、文本（`lines.tsx`，等宽字体 `font-mono`，不换行，横向由该元素原生滚动，`←` / `→` 也可横向移动；截断行末尾显示「…（行が長すぎるため省略）」）、自绘纵向滚动条（`scrollbar.tsx`，`role="scrollbar"`；拇指按 `@pch/text-engine` 的 `pager-model` 缩放，最小 20px，拖动按位置换算行号，点击轨道翻页）。移动：滚轮（纵向按 px / 行高换算，`Shift` / 横向交给原生横向滚动）、拖动、`↑` / `↓`、`PageUp` / `PageDown`（可见行数 − 1）、`Ctrl+Home` / `Ctrl+End`。可见范围内用浏览器原生选择与复制；跨屏选择不支持。
- **读取**（`use-visible-lines.ts` + `block-cache.ts` + `decode-lines.ts`）：块缓存按 1000 行一块、块内稀疏，LRU，按解码后的字符数 + 每行固定开销 16 设上限（2000 万；只按字符数时大量空行几乎不占额度，最终审查修复）；可见范围中缺的行按块请求（每块同时只有一个请求，同时在途 ≤ 4，从块中第一个缺的行到块尾，`readLines` ≤ 2000 行），未到的行显示占位「…」；应答到达时块已离开视口附近（前后各一块以外）则丢弃；`DocStaleError` 忽略，其他失败的块在行数 / epoch 改变之前不再请求（状态栏显示错误；错误属于当时的缓存，epoch 改变后不再显示）。解码用 `decodeBlock`（只对从第 0 行开始的块跳过 BOM），每行显示上限 10,000 字符（超过时截断并标记）。索引变化（行数、complete 或 `indexedTo`）而此前索引已完成时，原来的最后一行可能被追加延长：从它起丢弃（丢弃时在途的应答也不写回；`index-change.ts`，纯函数。只看行数与 complete 不够：追加的内容没有换行且中间状态被 React 批处理掉时两者前后相同，末行会一直停在旧内容——最终审查修复）。
- **文档**（`use-document.ts`）：挂载时 `host.doc.open(uri, { at, encoding? })`、卸载时 `close`；`onProgress` 更新行数与索引进度，`onChanged` 带来新的 `info`——`reset` 时 epoch 递增（换新的缓存，按跟随状态定位：跟随则在末尾，否则保持 `top`；宿主先不带 info 立即转达 reset，此时 epoch 先递增、`awaitingInfo` 期间不读取行、显示占位，info 到达后再读取），`appended` 时若跟随则保持在末尾，`missing` 时工具栏下显示「ファイルが存在しません。以前の内容を表示しています」并保留已缓存内容（同名文件重新出现时为 `reset`，提示消失）。切换编码（`setEncoding`）与「读取全部」（`buildIndex`）的结果同样替换 `info` 并递增 epoch；失败时 toast。自动刷新与 F5 由宿主负责，插件不计时。
- **位置与跟随**（`view-position.ts`，纯函数）：`effectiveTop` = 跟随时 `maxTop`，否则限制在范围内的 `top`；向上移动关闭跟随；**日志类**（`log-like.ts`：`.log` / `.out`、`*.log.<数字>` / `*.log.<日期>`、sniff 判为文本的无扩展名文件）打开时 `at: 'end'` 并跟随，移动到末尾时自动开启跟随；其他文件打开在开头（`at: 'start'`），只有工具栏的切换按钮开启跟随。
- **工具栏**（`toolbar.tsx`）：先頭へ / 末尾へ / 末尾を追従（`aria-pressed`）。**状态栏**（`status-bar.tsx`）：编码下拉（`DropdownMenu` 的单选：自動判別 + UTF-8 / UTF-16 LE / UTF-16 BE / Shift_JIS / EUC-JP / ISO-2022-JP / GB18030 (GBK) / Big5 / Windows-1252；按钮显示「Shift_JIS（自動）」或手动选择的名称）、提示（`confidence: 'guess'` →「文字コードは推定です」、可见行含 U+FFFD →「文字化けしている可能性があります」、`binary` →「バイナリファイルをテキストとして表示しています」、可见行有截断 →「長すぎる行は途中までしか表示していません」、索引 / 读取错误——都经 `describeError` 显示错误码对应的三语文案，索引失败为「読み込みに失敗しました（<文案>）。更新で再試行します」，不直接显示错误码；`describeError` 也接受错误码本身（`DocProgress.error`），最终审查修复）、行数（索引中为「行を数えています N%（M 行）」）、大小（1024 进位）；部分模式为「先頭 / 末尾 4 MB のみ表示（全体 N）」+「すべて読み込む」（`buildIndex`，之后显示行号；位置按 `view-position.ts` 的 `afterReadAll` 换算：部分模式的 `top` 是窗口内行号，开头窗口起点在第 0 行、不变，末尾窗口起点在全量索引中的行号无法得知，未跟随时跳到末尾并跟随，最终审查修复——此前窗口内行号被当作绝对行号，末尾窗口读取全部后跳到文件开头附近）。
- **viewState**（`view-state.ts`）：`{ top, encoding?, follow }`（移动停止 150ms 后保存；**卸载时防抖中的状态立即保存**——宿主的 `onViewStateChange` 带上该视图的位置（`setViewState(tabId, state, uri)`），标签已导航离开时 `layoutReducer` 把它写入刚离开的历史项而不是新位置，最终审查修复；后退 / 前进恢复，手动编码以 `open` 的 `encoding` 恢复）。
- e2e（`e2e/text.spec.ts`）：10 万行日志打开在末尾（最后一行与行号）、`Ctrl+Home`、拖动滚动条到中间（行号与内容一致）；外部追加 3 行 → 跟随显示；轮转 → 重新加载、删除 →「ファイルが存在しません」并保留内容；约 200MB 文件（全量模式；50MB 在磁盘缓存下可能在显示进度前就索引完）索引进行中改名该文件成功（改名后状态栏出现「読み込みに失敗しました（ファイルまたはフォルダーが見つかりません）…」，证明改名确实发生在索引进行中，且显示的是文案而不是错误码）、上级目录 2 秒内可改名、索引完成后上级目录一次改名成功；删除后读取失败的错误在同名空文件出现（reset）后消失；移动后立即导航离开、后退时位置恢复；末尾窗口「すべて読み込む」后在整个文件的末尾；Shift_JIS / EUC-JP / GBK / Big5 / UTF-16 LE·BE / ISO-2022-JP / Windows-1252 样本显示正确（Chromium 的 `TextDecoder` 支持这些标签）与手动切换；无扩展名文本按文本打开；PNG → 文件信息 →「テキストとして表示」；20MB 单行 → 截断提示、界面可操作；降低 `preview.maxTextSizeMB` → 部分模式 →「すべて読み込む」后显示行号。

### 9.5 第三方插件（后续阶段）

插件目录为 `userData/plugins/<id>/`，内含 `manifest.json` 与 ESM 产物；主进程的 plugin 模块负责发现与校验，渲染端通过 `pcplugin://` 协议动态 import。React 等公共依赖由宿主以 import map 方式共享，避免重复打包。由于插件代码运行在渲染进程，需提供启用开关与来源提示；对安全要求高时切换为 iframe 沙箱模式（见 9.1 的设计伏笔）。

---

## 10. Office 文件：交给本机 Office 打开

### 10.1 原则

Excel、Word、PowerPoint 等 Office 文件不在应用内渲染，而是交给本机安装的 Office 打开，提供三种打开方式：**只读打开**、**编辑打开**、**新建打开**（以该文件为蓝本新建一个未保存的文档，保存时 Office 会要求另存为，原文件不受影响）。

能力不硬造：每种方式是否可用，取决于本机 Office（或用户设置的其他关联程序）是否提供。检测不到的方式在菜单中直接不显示，而不是由本应用模拟。

### 10.2 能力检测：读取 Windows 文件关联

Windows 资源管理器右键菜单里的「開く」「読み取り専用で開く」「新規」等，本质上是注册表中该文件类型 ProgID 下的 shell verb。本应用按以下顺序检测，结果按扩展名缓存（启动时及用户手动刷新时重新检测）：

1. 读取 `HKCU\...\Explorer\FileExts\<ext>\UserChoice` 的 ProgId（用户自己选过的默认程序优先），没有则读 `HKCR\<ext>` 的默认值。
2. 列出 `HKCR\<ProgId>\shell` 下的所有 verb。直接读注册表而不用 .NET 的 `ProcessStartInfo.Verbs`，因为后者按设计不会列出 `New`。
3. 读取 `open` verb 的命令行，识别目标程序（`EXCEL.EXE`、`WINWORD.EXE`、`POWERPNT.EXE` 或其他）。

注册表读取使用系统自带的 `reg.exe`（通过 execFile 调用）。注意 `reg query` 输出中「默认值」的标签会随系统语言变化（日文系统为「(既定)」），解析时按 `REG_SZ` 等类型标记分割，不依赖标签文字。

### 10.3 打开方式与实现手段

每种方式优先使用 shell verb（与资源管理器右键菜单行为完全一致，DDE、DelegateExecute 等细节由 Windows 处理），其次使用 Office 官方文档记载的命令行开关；两者都没有就不提供。

| 方式 | 首选 verb | 备选命令行开关 | 说明 |
|---|---|---|---|
| 编辑打开 | `Open`（默认动作） | — | 共享盘上文件被他人占用时，由 Office 自己提示只读或通知 |
| 只读打开 | `OpenAsReadOnly` | Excel：`/r` | Word 没有只读开关（其 `/r` 是重新注册），只能依赖 verb |
| 受保护的视图 | `ViewProtected` | — | 仅当没有只读方式时作为替代显示，并如实标注为「受保护的视图」而非「只读」 |
| 新建打开 | `New` | Excel：`/t`；Word：`/f` | `New` verb 多见于模板类型（.xltx/.dotx/.potx）；PowerPoint 只依赖 verb |

命令行开关只在识别到 Microsoft Office 时使用，exe 路径从 `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\<exe>` 读取。

由于检测基于文件关联而不是写死 Office，若用户的默认程序是 WPS、LibreOffice 等，同样会显示该程序在注册表中提供的方式。

```ts
// packages/shared/src/launcher/types.ts
export type LaunchMode = 'edit' | 'readOnly' | 'protectedView' | 'newFromFile';

export interface LaunchOption {
  mode: LaunchMode;
  via: { type: 'verb'; verb: string } | { type: 'switch'; exe: string; args: string[] };
}

export interface LaunchCapabilities {
  ext: string;
  appName: string | null;            // 'Microsoft Excel' 等，取自程序的文件描述
  options: LaunchOption[];           // 只包含检测到的方式
}
```

```ts
// apps/desktop/src/main/modules/launcher/shell-execute.ts
// 通过 PowerShell 的 Start-Process 调用 ShellExecute，路径与 verb 经环境变量传入，避免命令注入
export async function shellExecuteVerb(target: string, verb: string): Promise<void> {
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -LiteralPath $env:PCH_TARGET -Verb $env:PCH_VERB'],
    { env: { ...process.env, PCH_TARGET: target, PCH_VERB: verb }, windowsHide: true, timeout: 15_000 },
  );
}
```

PowerShell 启动约需数百毫秒，对「打开文件」可以接受。若贵司终端策略禁止 PowerShell，可改为用 koffi 直接调用 `ShellExecuteExW`（届时会作为新依赖告知），接口不变。

### 10.4 不同资源类型的处理

| 资源 | 只读打开 | 编辑打开 | 新建打开 |
|---|---|---|---|
| 本地 / 已挂载 SMB / UNC | 直接传路径 | 直接传路径，Office 原生处理锁定与保存 | 直接传路径 |
| 未挂载 SMB | 先建立 `net use` 会话，再传 UNC 路径（会话对 Office 同样有效） | 同左 | 同左 |
| FTP / SFTP | 下载到缓存，设置只读属性后打开 | 走「远程编辑会话」（10.5） | 下载到缓存后新建打开，保存时由用户另存到任意位置 |

缓存副本保持原文件名，使 Office 标题栏显示正确。

### 10.5 远程编辑会话（FTP / SFTP）

FTP/SFTP 上的文件无法被 Office 直接写回，因此由本应用代理：

1. 下载到 `userData/edit-sessions/<sessionId>/<原文件名>`，记录基线：远端 mtime、size，以及本地文件的 SHA-256。
2. 用 `Open` verb 打开，监听该目录（忽略 `~$*`、`*.tmp` 等 Office 临时文件，等待写入稳定），因为 Office 保存时通常是「写临时文件再替换」。
3. 检测到内容哈希变化后自动上传：先 stat 远端，若与基线不一致则判定冲突，弹窗让用户选择「覆盖服务器」「以副本名上传」「暂不上传」；无冲突则先上传到临时文件名再重命名覆盖，成功后更新基线。
4. 定期尝试以读写方式打开本地文件，Office 关闭该文件后锁会释放，此时完成最后一次同步并结束会话、清理副本。
5. 会话持久化到 SQLite。应用重启时若发现未同步的修改，在状态栏和通知中提示用户处理，不会静默丢失。

状态栏显示「远程编辑中 (n)」，点击可查看每个会话的状态（编辑中、上传中、已同步、冲突、错误）并手动「完成编辑」。为此 FTP/SFTP Provider 需要增加 `upload` 与 `rename` 能力（`capabilities.write = true`），本地类 Provider 仍保持只读，因为 Office 会直接写本地或共享盘文件。

### 10.6 在界面中的体现

1. 目录视图（预览窗口中的 `pch.preview.folder`）的右键菜单出现「用 {appName} 打开 ▸ 只读 / 编辑 / 新建」，子项按检测结果动态生成。资源树不提供（需求方 2026-11-19 决定：资源树只用于展示，打开动作只由将来的预览窗口提供）。
2. 在预览窗口（目录视图）中双击 Office 文件的默认动作由设置 `launcher.officeDefaultAction` 决定（只读 / 编辑 / 每次询问），默认**只读**：保守业务中查阅设计书远多于修改，且在共享盘上以编辑方式打开会锁定文件，影响同事。
3. 在应用内以标签方式打开 Office 文件时，由内置的 `pch.preview.office` 插件显示一个启动面板：文件信息、三个打开按钮（只显示可用的）、该文件的远程编辑会话状态。这样标签、会话恢复等机制对 Office 文件依然成立。

### 10.7 代码位置

```
apps/desktop/src/main/modules/launcher/
├── association.ts            # 读取注册表，解析 ProgId、verb、exe
├── capability.service.ts     # 按扩展名检测并缓存 LaunchCapabilities
├── office-switches.ts        # 已核实的 Office 命令行开关表
├── shell-execute.ts          # verb 调用（PowerShell 实现，可替换为 koffi）
├── launcher.service.ts       # 根据资源类型与方式，准备本地路径并启动
├── edit-session.service.ts   # 远程编辑会话：监听、上传、冲突、结束
├── edit-session.repo.ts
└── launcher.ipc.ts
plugins/preview-office/       # Office 文件的启动面板插件
```

---

## 11. 标签页、多窗口与会话恢复

### 11.1 状态模型（packages/shared）

```ts
export interface TabState {
  id: string;
  uri: string;                 // 资源 URI 或 internal://settings
  pluginId: string;
  title: string;
  pinned: boolean;
  viewState?: unknown;         // 由插件定义：滚动位置、页码、缩放、排序、编码……
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

**打开**（M1-3b 起，浏览器式，设计 `devDoc/2026-11-19-15-navigation-design.md` 2.8，需求方 2026-11-20 确认）：单击（或 Enter）在当前标签打开，记入该标签的历史，没有标签时新建；中键 / Ctrl+单击 / 右键「在新标签页中打开」在新标签打开，同一 URI 已打开则直接激活。没有「预览标签」（此前的斜体预览标签、被下一次单击替换、双击标签头 / 宿主动作转常驻都已取消）。

**弹出**：标签右键「在新窗口打开」或把标签拖出窗口边缘 → 渲染端发送 `tab/detach` → reducer 新建一个 detached 窗口并移入该标签 → LayoutService 发现新窗口，用 window-factory 创建 BrowserWindow 加载 `/window/?id=…`。弹出窗口内同样有标签栏，可继续打开多个。

**合并**：弹出窗口的标签菜单提供「移回主窗口」；跨窗口直接拖拽合并作为第二阶段（需要主进程跟踪全局鼠标坐标）。关闭弹出窗口时，可在设置中选择「关闭其中的标签」或「移回主窗口」。

**同步**：主进程每次 reduce 后，只向受影响的窗口推送 `layout.changed`（该窗口自己的 WindowView），渲染端 zustand store 整体替换。`tab/viewState` 属于高频更新，渲染端防抖 500ms 后发送，主进程不广播此类变化。

**已实现（M1-3，单窗口子集）**：上面的 `LayoutState` / `LayoutAction` 是 M3 的目标结构。M1-3 只实现单窗口的子集，状态由**渲染端**持有（`stores/tabs-store.ts`，按工作区各保存一份、只在内存中；切换工作区时显示该工作区的标签），M3 多窗口时移到主进程 `LayoutService`（2.5 节届时落实）。类型与 reducer 在 `packages/shared/src/layout/`：

```ts
// M1-3b：标签显示「位置」；workspace 的 uri 为 'pch-workspace:<工作区 id>'（location.ts：workspaceUri / workspaceIdOfUri）
export type LocationKind = 'workspace' | 'directory' | 'file'
export interface TabLocation { uri: string; kind: LocationKind; title: string }
export interface TabHistoryEntry extends TabLocation { viewState?: unknown }   // 离开该位置时的 viewState（没有时不含该键）
export interface TabHistory { back: TabHistoryEntry[]; forward: TabHistoryEntry[] }   // 各至多 TAB_HISTORY_LIMIT = 50
export interface TabState extends TabLocation { id: string; viewState?: unknown; history: TabHistory }   // M1-3b 起没有 preview
export interface TabsState { tabs: TabState[]; activeId: string | null }
export type TabsAction =
  | ({ type: 'tab/open' } & TabLocation)          // 新标签
  | { type: 'tab/close'; id: string }
  | { type: 'tab/activate'; id: string }
  | ({ type: 'tab/navigate'; id: string } & TabLocation)
  | { type: 'tab/back'; id: string }
  | { type: 'tab/forward'; id: string }
  | { type: 'tab/viewState'; id: string; viewState: unknown }
export function layoutReducer(state: TabsState, action: TabsAction, newId: () => string): TabsState
```

- `tab/open`（新标签）：同 URI 已打开 → 只激活；否则插在激活标签右侧。`tab/close`：关闭激活标签时激活右侧相邻标签，没有则左侧；关闭最后一个 → 欢迎页。`tab/navigate`（当前标签）：同标签内改位置并清除 viewState（允许与其他标签的 URI 重复），离开的位置连同其 viewState 压入后退栈、前进栈清空；导航到当前 URI 不入栈（只更新类型与标题，viewState 保留）。`tab/back` / `tab/forward`（M1-3b）：浏览器式，当前位置连同 viewState 压入另一侧的栈，**恢复目标位置离开时的 viewState**（像浏览器后退恢复滚动位置；目标没有保存时为 undefined。M1-3b 最终审查修复，此前同样清除）；没有可去的位置时不变。（M1-3b 取消预览标签：`preview` 字段、`tab/promote` 与「预览打开替换预览标签」都已删除。）`tab/viewState` 可带 `uri`（该状态所属的位置；文本预览最终审查修复）：与当前位置相同或省略时写入当前；标签已离开该位置（视图在导航之后才卸载、补存防抖中的状态）时写入后退栈顶或前进栈顶中 URI 相同的一项（两者都相同时取后退栈顶），都不是时不变——此前卸载后保存会落到新位置上，因此插件在卸载时不保存。`stores/tabs-store.ts` 的 `openHere(workspaceId, target, { newTab? })` 是界面共用的浏览器式打开：有激活标签时 `tab/navigate`，没有或 `newTab` 时 `tab/open`（资源树、地址栏使用）。历史属于标签（每个标签独立、只在内存中，关闭标签即消失；新开的标签历史为空），两个栈各至多 50 项，超出时丢弃最旧的。没有变化时返回同一个状态对象。
- 逻辑路径（M1-3b，`renderer/src/lib/logical-path.ts`，地址栏与预览区共用）：`logicalPath(loc, { workspace: { id, name }, entries })` → `PathSegment[]`（`{ label, target: TabLocation, kind: 'workspace' | 'entry' | 'dir' | 'file' }`）：`工作区名` ›（分组不出现）› `条目标签（别名）` › 相对路径各段 ›（文件时）文件名。所属条目为包含它的 folder 条目或 URI 相同的 file 条目，多个时取 URI 最长者；条目段的目标标题也是别名（标签在条目根时标题为别名）。条目之外的位置在工作区之后退化为绝对路径（驱动器 `C:` / 共享 `\\host\share` 开始）。`parentLocation(loc, ctx)` = 逻辑路径的上一段：条目根之上是工作区总览、总览为 null、条目之外为磁盘上的上级（驱动器 / 共享根之上为总览）。
- 工作区总览（M1-3b，`features/preview/workspace-overview.tsx`，应用内置视图、不是插件）：工作区 id 取自标签的 URI（标签按工作区区分，总览只会是所属工作区的），标题为工作区显示名；分组为分节（`overview-model.ts`：未分组的项在前、无标题，之后是分组；分组内先项后子分组，同层按 sortOrder），folder / file 条目为项（别名、真实路径；悬停提示为真实路径）。单击只获得焦点；双击 / Enter 在当前标签打开（folder 为目录、file 为文件，都进入历史）；中键 / Ctrl+单击 / Ctrl+Enter 在新标签打开（M1-3b 设计 2.8）。从条目根上来时焦点落在刚离开的条目上。`pch-workspace:` 不是文件 URI：不发给扫描进程、不进 `vfs.interest.tabs`（`selectActiveDirectory` 只取 `kind: 'directory'`），资源树不定位它（激活标签为总览时树的选中保持不变）。
- 资源树（`features/explorer`，M1-3b 设计 2.4 / 2.8）：
  - **打开**：单击 = 选中 + 在当前标签打开（`openHere`，记入历史；没有标签时新建）；**目录单击不展开**（需求 7）。中键 / Ctrl+单击 / Ctrl+Enter / 右键「在新标签页中打开」= 在新标签打开（同 URI 已打开则只激活）。**双击**：分组 / 目录 = 展开 / 折叠（第二次单击 `detail` 为 2 不再处理）；文件与单击相同（不另开标签）。展开箭头（`data-tree-toggle`）单击只展开 / 折叠，不选中、不打开。→ / ← 照旧展开折叠 / 移动。Enter = 可展开的节点展开或折叠 + 立即在当前标签打开（错误行为重试）。
  - **键盘移动选中**（↑↓，以及 → ← 移到子项 / 父项）后 **400ms 防抖**在当前标签打开（`KEY_OPEN_DELAY_MS`）：快速连按只在最后停留处打开一次、记一条历史；单击 / Enter / 菜单打开，以及激活标签的位置被其他操作改变（同步请求到达）时取消尚未触发的打开。
  - 设置 `explorer.singleClickPreview`（键名沿用，避免迁移）的含义改为「单击 / 键盘移动选中即在当前标签打开」：关闭时单击与 ↑↓ 只选中，Enter 打开，文件双击打开，目录双击只展开。
  - **树跟随标签**（预览区 → 树）：`stores/navigation-store.ts` 订阅 tabs-store，激活标签（id 或位置）一变——打开、切换标签、标签内导航、后退 / 前进、地址栏点段、上一级——就发出 `mode: 'sync'` 的定位请求；资源树经 `use-reveal.ts`（与搜索的 `locate` 共用：所属条目 → 展开祖先 → 逐层等待列表）选中并滚动到该节点（`align: 'auto'`），**不聚焦、不提示、不确认目录**；位置不在树中（工作区总览、条目之外，以及展开祖先后列表中没有该项、某一层超时）时选中不变——只在找到目标时选中（`settleReveal` / `settleRevealTimeout` 按模式区分；搜索结果等的 `locate` 仍选中已到达的最深一层并提示。M1-3b 最终审查修复：此前 sync 也会选中最深的祖先）；选中节点的 URI 已是该位置时不动（同一 URI 在树中出现多次时，选中留在用户点的那一行）。请求在 store 层发出，资源树不挂载期间（侧栏显示搜索）的变化留到挂载时处理（只保留最新一个）。**不形成循环**：打开只由用户的单击 / 键盘 / 菜单发起，同步引起的选中不触发打开（e2e 以选中次数与历史条数断言）。
  - 条目根 / 真实目录 / 指向目录的链接打开为 `directory`，文件 / 指向文件的链接为 `file`；分组、状态行、失效链接不打开。标题为节点显示名（条目为条目标签）。
- 标签栏（`features/tabs`）：`role="tablist"` / `tab`；单击激活、× / 中键关闭（M1-3b 起没有斜体的预览标签与「双击转常驻」）、`Ctrl+W` 关闭激活标签；悬停提示为完整路径（`lib/file-uri.ts`；工作区总览为标题），图标按位置种类（总览 / 目录 / 文件）；只有一个 Tab 停靠点，←→ / Home / End 切换；溢出时横向滚动（纵向滚轮换成横向）。内容区只渲染激活标签（按标签 id 重建），内容由 `PreviewContainer` 提供（9.3 节「已实现」）。
- ~~预览转常驻~~：M1-3b 取消预览标签（设计 2.8，需求方 2026-11-20 确认），所有标签都是普通标签。

### 11.3 会话快照

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

### 12.2 界面布局

```
┌ 标题栏：工作区切换器 │ 搜索/命令面板（Ctrl+K） │ 主题/语言快捷切换 │ 窗口按钮 ┐
├ 地址栏：[←][→][↑][⟳]  工作区 ▾ › 条目别名 › 段 … › 文件名 ─────────────────────┤
├──┬────────────────┬─────────────────────────────────────────────────────┤
│活│ 资源树          │ 标签栏（拖拽排序、固定、预览模式、溢出菜单）              │
│动│ （工作区条目 +  ├─────────────────────────────────────────────────────┤
│栏│  真实目录）     │ PreviewContainer（插件内容区）                          │
│  │                │                                                     │
├──┴────────────────┴─────────────────────────────────────────────────────┤
│ 状态栏：连接状态 │ 当前资源路径 │ 编码 │ 插件状态项 │ 通知                    │
└──────────────────────────────────────────────────────────────────────────┘
```

隐藏系统标题栏（`titleBarStyle: 'hidden'`，不使用 Window Controls Overlay），由渲染端自绘整条标题栏：Windows / Linux 在右端绘制最小化、最大化/还原、关闭按钮（尺寸与交互参照 Windows 11，经 `window.*` IPC 控制发起调用的窗口；最大化状态由 `window.stateChanged` 事件同步），外观随主题变化，也不会像系统按钮那样遮挡标题栏的边框；macOS 保留系统惯例的红绿灯。双击标题栏空白处最大化 / 还原由系统处理（已用系统级鼠标事件验证）；拖动窗口贴靠屏幕边缘、Win+方向键属于系统对隐藏标题栏窗口的标准行为，应同样可用（未逐一验证）。取舍是 Windows 11 悬停最大化按钮时出现的贴靠布局面板（Snap Layouts）不再出现。分栏用 shadcn Resizable，右键菜单用 ContextMenu，命令面板用 Command，通知用 Sonner。活动栏切换侧栏内容：资源树、搜索、远程连接、（后续）最近使用。已实现（M1-2）：标题栏左侧的工作区切换器（8.1 节）、侧栏的资源树（8.2 节）；（2026-11-19）活动栏的「搜索」视图与 `Ctrl+Shift+F`（8.4 节；标题栏中间的「搜索文件或命令」是 M5 的命令面板入口，与之不同）；欢迎页标题显示当前工作区名称；（M1-3）标签栏已实现（11 节「已实现」：没有标签时显示欢迎页；拖拽排序、固定、溢出菜单推迟），PreviewContainer 与 fallback 插件已实现（9.3、9.4 节「已实现」），folder 与 fallback 插件均已实现（9.4 节「已实现」）。

**地址栏（M1-3b 已实现，`features/address-bar`，设计 `devDoc/2026-11-19-15-navigation-design.md` 2.2 / 2.8 节）**：标题栏正下方、横跨活动栏 / 侧栏 / 内容区的一行（`Shell` 的 `addressBar` 插槽，`<nav>`，与标题栏同级、不属于任何标签的内容），显示当前工作区**激活标签**的位置；没有标签时只有工作区一段。
- 按钮：后退 / 前进（按该标签自己的历史，11.1 节）、上一级（`lib/logical-path.ts` 的 `parentLocation`，与目录视图的 Backspace / `Alt+↑` 相同）、刷新（`stores/tabs-store.ts` 的 `requestRefresh(tabId)`：目录视图重新确认并列出、文件标签重新 stat、工作区总览重新取得条目）；不可用时禁用（没有标签时全部禁用）。悬停提示带快捷键。
- 路径段：每次由 `logicalPath` 用最新的工作区名与条目计算（条目改名后立即更新；标签栏的标题仍是打开时的快照）。单击段 = 在当前标签内导航（进入历史；当前位置本身不变）；中键 / `Ctrl+单击` = 在新标签打开（同 URI 已打开时按 `tab/open` 只激活）；没有激活标签时单击也新建标签。段的悬停提示为真实路径（Windows 路径；工作区段没有）；最后一段 `aria-current="location"`。段过长时截断（最大宽度），段多时横向滚动（滚动条隐藏，纵向滚轮换成横向），路径或宽度变化后滚到末尾，使当前位置可见。
- 工作区段旁的 ▾：列出工作区（当前项选中），选中即切换（与标题栏的切换器相同，经 `data/workspace` 的 `activate`；新建 / 重命名 / 删除只在标题栏的切换器中）。
- 快捷键（`use-navigation-shortcuts.ts`，监听 window，按键 → 命令为纯函数 `commands.ts`）：`Alt+←` / `Alt+→` 后退 / 前进（焦点在输入框时也有效，与浏览器相同）；`F5` 刷新激活标签（焦点在 input / textarea / select / contenteditable 时除外；视图内已处理的按键——`defaultPrevented`，例如资源树内的 `F5` 刷新资源树——不再处理）；鼠标侧键为 `mouseup` 的 `button` 3 / 4（后退 / 前进），侧键的 `mousedown` / `mouseup` / `auxclick` 都阻止默认动作（不用主进程的 `app-command`）。**有模态对话框打开时**（DOM 中有未隐藏的 `[role="dialog"]` / `[role="alertdialog"]`，即 Base UI Dialog / AlertDialog 的弹出层；`OPEN_MODAL_SELECTOR`）这些快捷键与侧键都不处理（否则作用于对话框背后的标签；侧键的默认动作仍阻止。M1-3b 最终审查修复）。系统级侧键（`mouse_event` 的 XBUTTON1 / XBUTTON2）已实测：每按一次后退 / 前进一步，页面不发生历史导航。

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

位置：`userData/data/pch.db`；启动时设置 `PRAGMA journal_mode = WAL` 与 `PRAGMA foreign_keys = ON`，并执行 Kysely 迁移（`infra/db/migrations/`）。下面以 SQL 描述表设计，各表在对应里程碑以迁移的形式落地（已实现：`settings`（迁移 0001）、`workspaces` 与 `workspace_entries`（迁移 0002，同时写入默认工作区 `default`）、`workspace_entries.refresh_level` 与 `index_targets`（迁移 0003，同时把已有条目 URI 的结尾 `/` 去掉，驱动器根 `file:///C:/` 除外）、`refresh_level` 改名为 `cache_strategy`（迁移 0004，旧值与 CHECK 约束保留））。

```sql
-- 时间戳一律为 UNIX 毫秒（INTEGER）；JSON 列以 TEXT 存储
CREATE TABLE workspaces (                             -- M1-1 已实现
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT,
  color          TEXT,
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

CREATE TABLE connections (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('smb', 'ftp', 'sftp')),
  name       TEXT NOT NULL,
  host       TEXT NOT NULL,
  port       INTEGER,
  username   TEXT,
  domain     TEXT,
  secret     BLOB,                                    -- safeStorage 加密后的密码或私钥口令
  options    TEXT,                                    -- JSON：编码、被动模式、私钥路径、主机指纹……
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
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

CREATE TABLE recent_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  uri          TEXT NOT NULL,
  opened_at    INTEGER NOT NULL
);
```

密码等机密永远不发送到渲染进程：返回给前端的 `ConnectionDto` 只包含 `hasSecret: boolean`。ID 使用 `crypto.randomUUID()`，不额外引入 ID 库。

**目录缓存库 `index.db`（已实现，2026-11-19）**：与 `pch.db` 分开，位于 `userData/cache/index.db`，只由扫描进程打开（`scanner/cache/cache.ts`，node:sqlite 直接使用，不经 Kysely；`journal_mode = WAL`、`synchronous = NORMAL`、`foreign_keys = ON`）。它是可随时删除重建的缓存：**不做迁移**，表结构在 `scanner/cache/cache-schema.ts`，变化时递增 `CACHE_VERSION`，打开时 `user_version` 不符即删表重建；打不开（例如损坏）时删除 `index.db` / `-wal` / `-shm` 重建一次（5.2 节）。表：`dirs`（整数编号 `id INTEGER PRIMARY KEY AUTOINCREMENT`（编号不复用：目录删除后以同一 URI 重建得到新编号）、目录 URI `uri`（`UNIQUE`）、父目录编号 `parent_id`（NULL 表示根、父行尚不存在的孤儿，或父行已被清理的根；新建目录行与 `prune` 之后由 `adoptOrphans` 认领孤儿，`applyListing` 不以 NULL 覆盖已有值）、上次枚举时目录自身的修改时间 `dir_mtime`、`listed_at` / `checked_at`、`state`（ok / not-found / denied / unreachable）与 `error_code`、热点计分 `visited_at` / `visit_score`、生成列 `depth`（URI 中 `/` 的个数，驱动器根末尾的 `/` 不计）；索引 `dirs_parent (parent_id)`，后台队列用的两个互不重叠的部分索引 `dirs_unlisted (depth, uri) WHERE checked_at IS NULL` 与 `dirs_checked (checked_at, uri, depth) WHERE checked_at IS NOT NULL`，热点查询用的覆盖部分索引 `dirs_hot (visit_score, visited_at, uri) WHERE visit_score > 0`）、`entries`（`dir_id` 引用 `dirs.id`、`(dir_id, name)` 为主键，随目录级联删除：`entries` 不再保存目录 URI，长路径下体积约为原来的 1/3，见 devDoc 11；删除子树只需按 `dirs.uri` 的区间删 `dirs`，条目与 `entries_fts` 的触发器随外键级联生效；搜索由命中的 `entries.dir_id` 关联 `dirs.uri` 做范围筛选与结果 URI 拼接）、FTS5 external content 表 `entries_fts`（`tokenize='trigram'`，由触发器与 `entries` 同步，供文件名搜索使用，8.4 节）。`CACHE_VERSION` = 5。写入只在内容有差异时发生；配置下发后删除不在任何工作区任何 folder 条目之下的目录缓存。占用与清空经 `vfs.cacheInfo` / `vfs.clearCache`（界面随 M5）。

---

## 14. 设置、国际化与主题

### 14.1 设置

设置项以 zod schema 定义在 `packages/shared`，同时提供默认值与校验；数据库只保存与默认值不同的键。

```ts
export const settingsSchema = z.object({
  'general.language':            z.enum(['system', 'ja', 'zh-CN', 'en']).default('system'),
  'appearance.themeMode':        z.enum(['system', 'light', 'dark']).default('system'),
  'appearance.accent':           z.enum(['neutral', 'blue', 'green', 'violet', 'orange']).default('neutral'),
  'appearance.density':          z.enum(['comfortable', 'compact']).default('comfortable'),
  'explorer.showHiddenFiles':    z.boolean().default(false),
  'explorer.singleClickPreview': z.boolean().default(true),   // M1-3b：「单击 / 键盘移动选中即在当前标签打开」（键名沿用）
  'preview.associations':        z.record(z.string(), z.string()).default({}),
  'preview.maxTextSizeMB':       z.number().int().min(1).max(500).default(50),   // 自动建立完整行索引的上限（超过时只显示开头 / 末尾 4MB 的部分模式，7.5 节）
  'session.restoreOnStartup':    z.boolean().default(true),
  'window.onDetachedClose':      z.enum(['close-tabs', 'return-to-main']).default('return-to-main'),
  'remote.cacheSizeMB':          z.number().int().min(100).default(1024),
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
  'launcher.officeExtensions':   z.array(z.string()).default(['xlsx', 'xlsm', 'xls', 'xltx', 'docx', 'doc', 'dotx', 'pptx', 'ppt', 'potx']),
  'launcher.officeDefaultAction': z.enum(['readOnly', 'edit', 'ask']).default('readOnly'),
  'launcher.autoUploadRemoteEdits': z.boolean().default(true),         // 远程编辑会话保存后自动上传
});
export type Settings = z.infer<typeof settingsSchema>;
```

已实现：上面的全部键均在 `packages/shared/src/settings/schema.ts` 中定义（`refresh.*` / `vfs.timeoutSec.*` 于 2026-11-19 加入，`remote.pollIntervalSec` 同时删除；`refresh.*` 随后改为 `cache.*`，库中残留的 `refresh.*` 键被忽略）；`cache.*` / `vfs.*` 变化时主进程重新下发扫描配置（7.1 节）。目前只有语言、主题等少数键有界面，缓存与超时的全局设置暂无界面（M5「设置页完善」），条目级的缓存策略在资源树右键菜单中设置（8.2 节）。

设置页本身是一个内部标签（`internal://settings`），由内部插件渲染，因此同样支持弹出与会话恢复。修改后主进程广播 `settings.changed`，所有窗口即时生效。

### 14.2 国际化

`packages/i18n` 存放 `ja`、`zh-CN`、`en` 三套资源，按命名空间拆分（M0：common、explorer、connections、welcome、errors；M1-2 增加 workspace；2026-11-19 增加 search；随功能增加）。主进程与渲染进程用同一个工厂函数创建 i18next 实例，资源随代码打包、同步初始化；语言切换时主进程更新窗口标题（M5 起还要重建托盘菜单），渲染端调用 `changeLanguage`。插件通过 manifest 的 `i18n` 字段注入自己的命名空间。日期、文件大小统一用 `Intl` 格式化。三种语言的键一致性由类型（以日语资源为基准，缺键或多键编译失败）与单元测试（不允许空文案）共同保证。

### 14.3 主题

shadcn/ui 的 CSS 变量体系（Tailwind v4、oklch 颜色）。明暗模式通过 `<html class="dark">` 切换，强调色通过 `data-accent` 属性切换一组变量，紧凑密度通过 `data-density` 调整间距。主题以 SQLite 中的设置为唯一来源，并同步 `nativeTheme.themeSource`，使滚动条、表单控件等原生绘制部分与窗口底色一致（窗口按钮由渲染端自绘，直接使用主题变量）。这里自行实现约 50 行的 ThemeProvider，而不使用 next-themes，因为后者以 localStorage 为存储，与「设置存 SQLite」的要求冲突（shadcn 生成的 `sonner.tsx` 默认引用 next-themes，已改为由调用方传入主题）。

---

## 15. 安全设计

1. 所有窗口统一由 window-factory 创建：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webSecurity: true`。
2. `index.html` 以 meta 声明 CSP（`script-src 'self'`，不允许内联脚本；`style-src` 因组件浮层定位需要 `'unsafe-inline'`）；禁止页面内导航到外部地址，`setWindowOpenHandler` 一律拒绝，外部链接经白名单校验后用 `shell.openExternal` 打开。
3. IPC 校验发送方来源（只接受 `app://renderer` 或开发地址），所有输入经 zod 校验。
4. `pcfs://` 只接受已知 scheme，远程 URI 必须对应已存在的连接；本地路径做规范化，防止路径穿越。
5. 机密使用 `safeStorage`（Windows 下为 DPAPI）加密存储，不进入渲染进程、不写日志。
6. SFTP 主机密钥 TOFU 校验；FTP 明文连接在界面上标注风险并推荐 FTPS。
7. 插件仅能访问 PreviewHost；第三方插件默认关闭，需用户显式启用。
8. 打包时启用 Electron Fuses（`electron-builder.yml` 的 `electronFuses`：关闭 RunAsNode、NODE_OPTIONS 与 inspect 参数，启用 asar 完整性校验与仅从 asar 加载）；渲染端产物位于 asar 内，同受完整性校验保护；发布时进行代码签名。

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

根目录 `pnpm dev` 即 `electron-vite dev`：Vite dev server 提供渲染端（只监听 localhost），主进程 / preload 重新构建后自动重启 Electron，开发窗口中 F12 打开 DevTools。开发环境使用独立的 userData（`PremiumCowHorse-dev`）。

### 16.4 打包与分发

`pnpm build` 执行类型检查与 `electron-vite build`（产出 `apps/desktop/out`）；`pnpm dist` 再调用 electron-builder 生成 **zip 免安装文件夹版**（`PremiumCowHorse-<版本>-win-x64.zip`），解压到任意目录后运行其中的 `PremiumCowHorse.exe`，不需要安装与管理员权限。asar 中只包含 `out/` 与主进程的运行时依赖（`dependencies`）。由于使用 `node:sqlite`，无需原生模块重编译步骤。用户数据位于 `%APPDATA%\PremiumCowHorse`，与程序所在目录无关，替换新版本时直接覆盖程序目录即可。

分发形式的选择（实测）：

| 形式 | 结论 | 依据 |
|---|---|---|
| NSIS 安装程序 | 不提供 | 需求方要求免安装 |
| portable 单文件 exe | 不采用 | 每次启动都把约 300MB 解压到 `%TEMP%` 并被杀毒软件扫描，启动 24–31 秒；强制结束后残留解压目录 |
| zip 文件夹版 | 采用 | 首次启动约 15 秒（杀毒软件首次扫描），之后约 1.4 秒 |

打包工具链注意事项：electron-builder 自带的 7-Zip 24.09 被公司漏洞管理（TVM）封锁，需安装 7-Zip 25.01 以上版本并以 electron-builder 官方环境变量 `ELECTRON_BUILDER_7ZIP_PATH` 指定（见 README）。若将来恢复安装程序或 portable 目标（二者内部使用 NSIS），需在 `electron-builder.yml` 中设置 `toolsets.nsis: '1.2.1'`（NSIS 3.12），默认的 NSIS 3.0.4.1 含 CVE-2023-37378。

---

## 17. 质量保障

| 层次 | 内容 | 工具 |
|---|---|---|
| 单元测试 | layoutReducer、URI 工具、插件匹配算法、设置 schema | vitest |
| 服务测试 | 各 service + 内存数据库（`node:sqlite` 的 `:memory:`），含事务并发安全测试 | vitest |
| Provider 集成测试 | 用容器启动 FTP / SFTP 服务器做真实读写与断线重连 | vitest + Docker |
| 端到端测试 | 启动与沙箱/白名单、CSP、错误落盘、设置持久化、自绘窗口按钮；经 IPC 的工作区流程与重启后保留（M1-1）；资源树的懒加载、键盘、错误行与重试、先显示缓存再按检查更新（新建 / 删除）、切回窗口不显示「加载中」、折叠后再展开 / 切回工作区时重新列出、拖放前后的磁盘递归快照、右键菜单、工作区切换器（M1-2）；原则回归（展开 `A\B\C` 时改名上级 `A`）、条目级缓存策略 / 建立索引菜单、断开图标（刷新与缓存引擎，`e2e/app.spec.ts`、`e2e/explorer.spec.ts`，共用 `e2e/support.ts`）；标签的打开 / 关闭（`e2e/tabs.spec.ts`；M1-3b 起为浏览器式：单击当前标签、中键 / Ctrl+单击 / 菜单新标签、目录单击不展开、双击 / 箭头展开）、树跟随标签与 ↑↓ 防抖打开、同步不循环（`e2e/tree-sync.spec.ts`，M1-3b）、全部折叠 / 定位到当前项、分组抽屉的互斥与恢复、未分组条目在上（`e2e/drawer.spec.ts`，M1-3b）、fallback 的文件信息与三个动作、可执行文件的确认、没有预览标签（点击 / 按键 / 插件动作都不改变标签）、插件崩溃只影响自己的标签（`e2e/preview.spec.ts`：在主进程替换 `shell.openPath` / `shell.showItemInFolder` 计数，不真的打开应用；崩溃插件见 9.3 节）（M1-3）；后续：打开与弹出标签、重启后恢复 | Playwright（Electron 模式） |
| 视觉确认 | 系统原生绘制的部分（窗口边框、系统按钮等）不在页面截图中，需用系统级截屏确认（方法见 `knowledge/`） | Playwright + PowerShell |
| 静态检查 | 类型检查、lint、模块边界规则（5.5 节）、i18n 键一致性（类型 + 单元测试） | tsc、eslint、eslint-plugin-boundaries、vitest |
| 依赖审计 | 已知漏洞 | pnpm audit |

---

## 18. 实施路线图

| 阶段 | 目标 | 主要交付 |
|---|---|---|
| M0 骨架（✅ 2026-11-18 完成） | 跑通全链路 | monorepo、electron-vite、app 协议、类型化 IPC、SQLite 与迁移、设置服务、i18n、主题、自绘标题栏与窗口按钮、lint 与模块边界、错误落盘、zip 分发 |
| M1 工作区与本地文件（✅ 2026-11-20 完成，合并到 `main`，标签 `m1`；总结与待确认清单见 `devDoc/2026-11-20-21-m1-summary.md`） | 能日常使用 | 分子计划：M1-1 数据层（工作区与条目的存储与规则、本地 Provider、VFS 与 IPC）；M1-2 资源树（工作区切换、虚拟化条目树、懒加载、拖入添加、右键菜单、变更感知；✅ 2026-11-18 完成，从系统资源管理器真实拖入待需求方确认）；**目录刷新与缓存引擎**（插入在 M1-2 之后：去掉 `fs.watch`，扫描进程 + `index.db`、koffi 枚举、4 级刷新级别与建立索引、断开显示、按松手位置插入、拒绝临时文件拖入；✅ 2026-11-19 完成，设计第 7 节的决定待需求方确认，见 `devDoc/2026-11-19-06-refresh-cache.md`）；**文件名搜索**（复用 `index.db` 的 FTS5 trigram 索引：活动栏的搜索视图、`Ctrl+Shift+F`、在资源树中定位；✅ 2026-11-19 完成，设计 `devDoc/2026-11-19-02-search-design.md` 第 6 节的决定待需求方确认，见 `devDoc/2026-11-19-07-search.md`）；**M1-3 标签与目录视图（✅ 2026-11-19 完成，为「最低可用原型」：单窗口 layoutReducer、标签栏与预览模式、最小插件体系与 folder / fallback 插件、激活目录按关注点处理；设计 `devDoc/2026-11-19-12-m1-3-design.md` 第 6 节的决定待需求方确认，见 `devDoc/2026-11-19-14-m1-3.md`；标签拖拽 / 固定 / 溢出菜单、网格视图、会话恢复均推迟）**；**M1-3b 导航、同步与资源树改进（✅ 2026-11-20 完成：标签历史与逻辑路径、浏览器式打开（取消预览标签）、应用地址栏、树与预览区双向同步、类型图标、定位 / 全部折叠与分组抽屉；设计 `devDoc/2026-11-19-15-navigation-design.md`，部分决定待需求方确认，见 `devDoc/2026-11-19-17-navigation.md`）**；**文本 / 日志预览（✅ 2026-11-20 完成：`@pch/text-engine`、provider `read`、主进程文档服务与 `vfs.sniff`、自写编码判断、文本插件（自绘分页、日志跟随、部分模式）、`PreviewHost.doc`；设计 `devDoc/2026-11-20-18-text-preview-design.md` 第 7 节的决定待需求方确认，见 `devDoc/2026-11-20-20-text-preview.md`）** |
| M2 预览插件体系 | 插件化落地 | plugin-sdk、注册表与匹配、PreviewContainer、pcfs 协议、text（M1 内已提前完成，见上）/markdown/image/pdf/media/fallback 插件；Office 打开方式检测与本地/SMB 文件的只读/编辑/新建打开、office 启动面板插件 |
| M3 多窗口与会话 | 中断恢复 | LayoutService 与 reducer、标签弹出与移回、会话快照保存与恢复、工作区切换时的会话切换 |
| M4 远程目录 | 覆盖全部资源类型 | 连接管理界面、safeStorage、SMB/FTP/SFTP Provider、连接池、远程缓存、主机密钥确认、连接状态显示；FTP/SFTP 上 Office 文件的远程编辑会话与冲突处理 |
| M5 完善与发布 | 可分发 | 命令面板与最近使用、设置页完善、打包签名、E2E 测试，按需加入自动更新 |
| 后续 | 扩展 | 第三方插件加载、跨窗口拖拽合并、工作区导出/导入（团队共享案件目录结构） |

M3 放在 M4 之前，是因为会话与多窗口决定了标签和插件 viewState 的数据结构，越早定型，后续返工越少。

---

## 19. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| `node:sqlite` 仍在演进，API 可能变化 | 数据层 | 访问收敛在 `client.ts` 与 Repository；保留切换 better-sqlite3 的路径 |
| Kysely 0.x 版本的 API 调整（如 0.29 将迁移 API 移到 `kysely/migration`） | 数据层 | 升级时跑全部数据库测试；使用面收敛在 `infra/db` |
| 公司漏洞管理（TVM）封锁构建工具链中的旧版程序 | 无法打包 | 7-Zip 使用 25.01 以上版本并以环境变量指定；若恢复 NSIS 目标则用 3.12 工具包；新增构建工具时先确认版本 |
| 自绘窗口按钮失去 Windows 11 的贴靠布局面板（Snap Layouts） | 少一种窗口布局入口 | 双击标题栏最大化已验证可用；拖动贴靠、Win+方向键预期可用（未逐一验证）；如用户需要再评估恢复系统按钮 |
| SMB 认证依赖 `net use`，且仅限 Windows | 未挂载 SMB | 先满足主要平台；后续用 koffi 调用 Windows API；接口不变 |
| FTP 单连接串行、日文服务器编码各异 | 远程性能与乱码 | 连接池 + 队列；连接级编码选项 |
| 终端策略禁止 PowerShell | Office 打开动作（只在将来的预览窗口中提供） | 改用 koffi 调用 `ShellExecuteExW`（koffi 已引入）；默认「编辑打开」也可退回 `shell.openPath` |
| 文件关联被第三方软件改写或 Office 修复后变化 | 打开方式显示不准 | 检测结果可手动刷新；启动时重新检测 |
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
| `index.db` 随树的规模增大 | 占用用户磁盘 | 只缓存工作区 folder 条目之下的目录，配置变化后清理；可随时删除重建（`vfs.clearCache`，界面随 M5）；1 万目录 / 11 万条目、平均 URI 204 字符的合成树编号化后约 23MB（编号化前 75MB；`entries` 以整数 `dir_id` 引用目录，不再保存目录 URI，见 13 节与 `devDoc/2026-11-19-11-dir-id.md`），真实应用中补满后的体积未验证 |

---

## 20. 文档与知识管理

| 位置 | 内容 | 维护规则 |
|---|---|---|
| `doc/` | 设计文档（本文档） | 项目的**最新事实依据**。实现与设计发生变化时，在同一次改动中同步更新，并在文首记录版本与变更摘要；描述以「目标结构」与「已实现」区分，不写尚未核实的内容 |
| `devDoc/` | 开发过程记录 | 每个开发任务一份记录（`YYYY-MM-DD-主题.md`）：目标、做了什么、关键决策与理由、验证结果、遗留事项 |
| `knowledge/` | 开发中的 tips、错误、知识 | 每遇到一次「非显而易见」的问题记录一条：症状、原因、解决、预防；开始相关工作前先查阅，避免重复踩坑 |
| `CLAUDE.md` | AI 协作约定 | 工作方式、验证要求、文档维护规则；约定变化时更新 |
| `README.md` | 环境与常用命令 | 命令或环境要求变化时更新 |
