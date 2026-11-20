# 文本 / 日志预览（大文件分页模型）：设计

- 日期：2026-11-20
- 状态：需求方 2026-11-20 确认方向——同意引入 `encoding-japanese`（对比实验后控制者决定不引入任何检测库，见第 4 节）；中日英旧编码需原生支持；编码库由控制者对比实验后决定（第 4 节）；大文件不一次加载全部内容，按 klogg 的「行索引 + 按需读取」模型自己实现，并**封装为独立的 workspace 包**（需求方提议，控制者同意）；其余按控制者建议。授权控制者自行比较、验证、决定。
- 位置：M1-3b 之后；单窗口会话保存 / 恢复之前。
- 取代：`doc/` 3.4 节「CodeMirror 6 用于文本 / 日志预览」与 7.5 节「`vfs.readText` + jschardet + iconv-lite 读取全文」的目标设计（见第 9 节的文档改动）。CodeMirror 保留为将来「编辑 / 语法高亮」的候选，只用于小文件。

## 1. 目标与非目标

目标（产品目标 2「集中查看常见文件」，对日运维的日志与配置）：

- 任意大小的文本 / 日志都能**立即**打开：首屏不等待全量读取；内存占用与文件大小无关（有上限）。
- 编码自动判断覆盖中日英：UTF-8 / UTF-16（有无 BOM）/ Shift_JIS（CP932）/ EUC-JP / ISO-2022-JP / GBK（GB18030）/ Big5 / Windows-1252；可手动切换。
- 行号、跳到开头 / 末尾、日志「跟随末尾」、文件变化（追加 / 轮转）自动反映、地址栏刷新与 F5。
- 无扩展名或未知扩展名的文本（`catalina.out`、`app.log.1`、`messages`）自动按文本打开；二进制交给兜底插件，并可「作为文本查看」。

非目标（本次不做，记录）：编辑、语法高亮、Ctrl+F 搜索（第 8 节给出接口预留）、自动换行（先横向滚动）、多编码混合文件的逐行判断、远程（FTP / SFTP）文件（provider 届时实现 `read` 即可接入）。

## 2. 原则约束

- **文件系统原则**：只读；每次读取 = 打开 → 读 → 立即关闭，不长期持有句柄（索引扫描按块反复开关，不在整个扫描期间持有）。打开方式须允许他人同时写入 / 删除 / 改名（日志写入方继续写、用户可改名）。Node `fs.open` 在 Windows 上的共享标志需查 libuv 源码确认，不满足时改用 koffi `CreateFileW`（已有依赖）。用 e2e 验证「打开中的文件可被改名、其上级目录可被改名、日志可被追加」。
- **安全**：渲染端 sandbox / CSP 不放宽；字节经现有 IPC（`pch:invoke`）以 `Uint8Array` 传递；不新增自定义协议（`pcfs://` 留给图片 / PDF 等需要 URL 的插件）。
- **分层**：纯逻辑放在新包中，不依赖 Node / DOM / Electron；主进程负责 I/O 与生命周期；插件负责界面。

## 3. 架构

```
packages/text-engine   (@pch/text-engine，纯 TS：Node / 浏览器通用，无 I/O)
 ├─ line-index        增量稀疏行索引：feed(bytes, baseOffset) → 行数、检查点
 ├─ line-reader       按行读取：readLines(index, readAt, start, count, caps) → 字节 + 行边界
 ├─ sniff             文本 / 二进制判断（开头 8KB：NUL、控制字符比例；UTF-16 例外）
 ├─ encoding          确定性前置判断（BOM / 无 BOM UTF-16 / 严格 UTF-8 / ISO-2022-JP）
 │                    + 旧编码打分（自写，第 4 节）；WHATWG 标签表
 ├─ decode            按块解码（TextDecoder；去掉行尾 \r；超长行截断）
 └─ pager-model       视口数学：topLine / 可见行数 / 缩放滚动条映射 / 键盘移动（纯函数）

apps/desktop/src/main/vfs
 ├─ providers/local.provider.ts   + read(uri, offset, length, signal)：开-读-关
 └─ document/                     DocumentService（打开的文档表、索引任务、刷新、按 owner 释放）
                                  document.ipc.ts（doc.* 通道）

packages/plugin-sdk    PreviewHost.doc（open / readLines / refresh / setEncoding / buildIndex / close / 事件）
apps/desktop/src/renderer/src/features/preview
                       host.ts 实现 host.doc；容器对「未匹配的文件」先 sniff 再选插件；按标签的查看方式覆盖
plugins/builtin/src/text   文本插件：分页视图（行号栏、行、可缩放的自绘滚动条）、状态栏（编码下拉、行数 / 进度、
                           模式）、工具栏（开头 / 末尾 / 跟随）、块缓存（LRU，按解码后字符数设上限）
```

依赖方向：`text-engine` ← main/vfs、plugins/builtin（以及将来的搜索）。`eslint.config.mjs` 新增元素 `text-engine`，允许 main-vfs、plugin 引用；`text-engine` 不依赖任何包（第 4 节：不引入检测库）。

为什么是包而不是插件内的文件：同一套索引 / 读取 / 编码逻辑主进程与渲染端都要用（主进程建索引与判断编码，渲染端解码与分页），将来搜索、FTP provider 也复用；纯函数包可单独做单元测试与大文件基准；将来若引入检测 / 转换库，也只作为该包的依赖，不渗入应用其他部分。

### 3.1 文档模型（主进程）

```ts
interface DocumentInfo {
  docId: string
  uri: string
  size: number // 打开 / 最近一次刷新时的大小
  mtimeMs: number
  encoding: EncodingGuess // { label: WhatwgLabel; confidence: 'certain' | 'likely' | 'guess'; source }
  binary: boolean // sniff 判为二进制（插件提示，可强制按文本）
  window: { start: number; end: number } // 当前文档对应的字节窗口（全量 = [0, size)）
  index: { lines: number; complete: boolean; indexedTo: number }
}
```

- **全量模式**：文件 ≤ 阈值（设置 `preview.maxTextSizeMB`，默认 50，语义改为「自动建立完整行索引的上限」）时，打开即后台建索引；扫完第一块就可显示，进度经事件推送。
- **部分模式**：超过阈值时不自动全量读取（网络上读几 GB 代价大）：窗口取文件末尾（日志类：`.log`、`.out`、轮转名、sniff 文本）或开头（其他）若干 MB（定为 4MB，对齐到行边界），只对窗口建索引；行号不显示（或显示「窗口内」相对行号）；状态栏提示「仅显示末尾 4MB / 共 2.1GB」并提供「读取全部并建立索引」按钮（`doc.buildIndex`）。
- 两种模式共用同一套代码：都是「对一个字节窗口建索引 + 按行读取」。

### 3.2 稀疏行索引（`line-index`）

- 检查点：行号是 K（=1000）的倍数，**或**距上一个检查点已超过 1MB 字节时，记录「行号 → 行首字节偏移」。内存：1 亿行约 10 万个检查点（< 1MB）。
- 按换行字节切行：UTF-8 / Shift_JIS / EUC-JP / GBK / Big5 / Windows-1252 / ISO-2022-JP 中 `0x0A` 不会出现在多字节字符内部，按字节切安全；UTF-16 按 2 字节单元找 `0x000A`。`\r\n` 跨块边界、文件末尾无换行、空文件都要有测试。
- 增量：`feed(chunk, baseOffset)` 可从任意已索引位置续扫（日志追加时只扫新增部分）。

### 3.3 按行读取（`line-reader`）

- `readLines(start, count)`：从 ≤ start 的最近检查点读起（最多跨 K 行或 ~1MB），跳到 start，返回 count 行的原始字节与行边界。
- 上限：每次 ≤ 2000 行且 ≤ 4MB；单行超过 64KB 时只返回前 64KB 并标记截断（显示「…（本行过长，已截断）」）；超长行后的下一行有检查点（1MB 规则），读取量有界。
- `readAt(offset, length)` 由调用方注入：主进程用 provider 的 `read`（开-读-关）。

### 3.4 编码

1. BOM → UTF-8 / UTF-16LE / UTF-16BE（certain）。
2. 无 BOM 的 UTF-16（NUL 集中在奇 / 偶位）→ UTF-16LE / BE（likely）。
3. 严格 UTF-8 校验（`TextDecoder('utf-8', { fatal: true })`，样本末尾截断的多字节字符除外）→ UTF-8（ASCII 亦归此类）。**样本取开头、中间、末尾各 64KB**——只看开头会把「前面全是英文、后面才有日文」的日志误判为 UTF-8；全量模式建索引时对全部内容继续做 UTF-8 校验，发现非法字节后重新判断并发 `doc.changed`。
4. ISO-2022-JP：出现 `ESC $ B` / `ESC $ @` / `ESC ( J` 等转义序列。
5. 其余在 Shift_JIS（CP932）/ EUC-JP / GBK / Big5 / Windows-1252 中按常用字区打分（自写，第 4 节），排除用该编码 fatal 解码失败者。平局时按界面语言与系统 ANSI 代码页排序（ja / cp932 → 日文编码在前；zh-CN → GBK 在前）。
6. 都无把握：按 UTF-8 宽松解码（`�`），状态栏提示「编码可能不正确」。

- 解码一律在渲染端用 `TextDecoder`（WHATWG 标签：`utf-8`、`utf-16le`、`utf-16be`、`shift_jis`、`euc-jp`、`iso-2022-jp`、`gb18030`、`big5`、`windows-1252`；这些标签在 Chromium 中的支持需在实现时用测试确认）。
- 手动切换：状态栏下拉「自动 / 上述标签」，记入标签 viewState（随后退 / 前进恢复；会话恢复时保存）。切换到 / 离开 UTF-16 需重建索引（`doc.setEncoding`），其余只在渲染端换解码器。

### 3.5 视图（文本插件）

- **自绘分页**，不用浏览器原生滚动高度：行高固定，视口只渲染 `topLine` 起的可见行；滚动条自绘，拇指位置 = `topLine / (lines - visible)`。原因：Chromium 元素高度有上限（约千万像素级），百万行以上的原生虚拟滚动会失效；统一用分页避免「大小文件两套逻辑」。
- 滚轮 / 拖动滚动条 / PageUp / PageDown / Ctrl+Home / Ctrl+End / ↑↓ 修改 `topLine`；块缓存按 1000 行一块，LRU，上限约 2000 万字符；缺块时先显示占位行，到达后替换（请求按块去重、离开视口的请求可丢弃）。
- 行号栏宽度按总行数位数；部分模式不显示绝对行号。
- 文本选择：可见范围内用浏览器原生选择与复制；跨屏选择不支持（记录）。
- 跟随末尾：日志类在末尾时自动开启；有追加时保持在末尾；用户向上滚动即关闭。
- 状态栏：编码（下拉）、行数（或索引进度）、大小、模式（全量 / 部分）、「编码可能不正确」提示。
- 刷新：地址栏刷新 / F5（`host.tabs.onRefresh`）→ `doc.refresh`；另外在标签激活且窗口聚焦时按扫描的关注点间隔（本地 5 秒 / 网络 10 秒，取 `cache.interval.focus.*`）自动 `doc.refresh`。
- viewState：`{ topLine, encodingOverride?, follow }`（后退 / 前进恢复，M1-3b 修复波已支持）。

### 3.6 刷新与变化（主进程）

`doc.refresh`：stat 一次——

- 大小增加且文件身份未变（`ino` / `birthtimeMs` 相同）→ 只索引新增部分，发 `doc.changed { docId, appended }`。
- 大小减小、身份变化（轮转 / 被替换）或修改时间倒退 → 重建（全量或部分模式按新大小重新决定），发 `doc.changed { docId, reset: true }`，渲染端清缓存、保持跟随状态。
- 文件不存在 → `doc.changed { docId, missing: true }`，视图显示「文件已不存在」并保留已缓存内容。

### 3.7 IPC（`packages/shared/src/ipc/contract.ts`）

| 通道                | 输入                                       | 输出                                                                    |
| ------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| `doc.open`          | `{ uri, encoding? }`                       | `DocumentInfo`（同时开始索引）                                          |
| `doc.readLines`     | `{ docId, start, count ≤ 2000 }`           | `{ start, bytes: Uint8Array, lineEnds: number[], truncated: number[] }` |
| `doc.refresh`       | `{ docId }`                                | `DocumentInfo`                                                          |
| `doc.setEncoding`   | `{ docId, encoding: WhatwgLabel \| null }` | `DocumentInfo`                                                          |
| `doc.buildIndex`    | `{ docId }`                                | `DocumentInfo`（部分 → 全量）                                           |
| `doc.close`         | `{ docId }`                                | `void`                                                                  |
| 事件 `doc.progress` | —                                          | `{ docId, indexedTo, lines, complete }`（节流 ≥ 200ms）                 |
| 事件 `doc.changed`  | —                                          | `{ docId, appended? , reset?, missing? }`                               |

- 文档归属调用方 webContents；窗口销毁时全部释放；每窗口最多 16 个打开的文档（超出时关闭最久未用的）。
- 新增通道遵循现有流程：契约 → 主进程 handler（漏写编译失败）→ 渲染端 `call()`。

### 3.8 选择插件

- 文本插件 `pch.preview.text`：扩展名表（`txt log md csv tsv json xml yaml yml ini conf cfg properties toml sql sh bat cmd ps1 psm1 js ts tsx jsx mjs cjs py java c h cpp cs go rs rb php html htm css scss vue svelte gradle env gitignore editorconfig` 等，代码类同样按文本显示）。
- 未被任何插件按扩展名 / MIME 匹配的文件：容器先调用 `vfs.sniff { uri } → { kind: 'text' | 'binary' | 'empty' }`（读开头 8KB，开-读-关），文本则交给文本插件，否则交给兜底插件。
- 兜底插件增加「作为文本查看」：按标签记录查看方式覆盖（`tabs-store`，进入该标签的历史条目；不持久化，会话恢复时再定）。

## 4. 编码检测：对比实验与决定

**实验**（2026-11-20，临时目录，项目未改动；Node 26）：114 个样本 = 19 种编码（日：cp932〔含 ①㈱髙№〕/ shift_jis / euc_jp / iso2022_jp / utf-8 / utf-8 BOM；简：gbk / gb18030 / utf-8；繁：cp950 / big5 / utf-8；英：cp1252〔é ü £ 弯引号 —〕/ utf-8 / ascii；UTF-16LE 有 / 无 BOM 的日、简）× 6 种形态（4–6 字、10–20 字、约 200 字、约 8KB、日志型 2000 行几乎全 ASCII 每 30–50 行夹一个中日文词、日志型只取前 64KB 检测）。判定：按检测结果的 WHATWG 标签用 `TextDecoder` 解码后与原文完全一致。

| 候选                              | 版本 / 许可证                         | 准确率（114） | 去掉无 BOM 纯中日文 UTF-16（102） | 主要失败                                                                                                          |
| --------------------------------- | ------------------------------------- | ------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `encoding-japanese`               | 2.5.0 / MIT                           | 65.8%         | 73                                | 不支持中文与 cp1252：GBK → euc-jp，Big5 → `UNICODE`                                                               |
| `jschardet`                       | 4.1.0 / 0BSD（v4 起，不再是 LGPL）    | 77.2%         | 84                                | 日志型几乎全错（判成 iso-8859-1 / 15）；返回 TextDecoder 不支持的标签（hp-roman8、ibm855、kz1048）；体积 7.5MB    |
| `chardet`                         | 2.2.0 / MIT                           | 83.3%         | 95                                | 极短文本一律 shift_jis；耗时随输入线性增长（10MB 1.6 秒）                                                         |
| `chardetng-wasm`                  | 1.0.2 / Apache-2.0（2021 年后未发布） | 76.3%         | 87                                | 不看 BOM；极短日文判成 windows-1250 / euc-kr；无 `main` / `exports`；渲染端需 CSP `wasm-unsafe-eval`（Edge 实测） |
| 前置判断 + chardetng              | —                                     | 90.4%         | 99                                | 极短日文                                                                                                          |
| **自写：前置判断 + 常用字区打分** | 约 85 行                              | **93.0%**     | **102（全对）**                   | 只错在无 BOM 的纯中日文 UTF-16（没有 NUL 可用）                                                                   |

性能：只取 64KB 抽样时所有候选 ≤ 11ms，不是区分因素。

**决定（控制者，按授权）**：

1. **自写判断放在 `@pch/text-engine`，不引入编码检测库**（包括需求方已同意的 `encoding-japanese`——实验显示它对中文无效，日文部分自写判断已全对；将来做「按 Shift_JIS / EUC-JP 编码搜索词」时它的转换功能可再考虑）。理由：准确率最高、日志型（核心场景）全对、无依赖 / 无 WASM / 不放宽 CSP；所有库本来就需要自己补 BOM / UTF-16 / UTF-8 前置判断。
2. **偏差风险与对策**：实验样本与打分由同一个 agent 编写、句子重复、只用了常用字，结果偏乐观。实现时：
   - 测试样本集由**不同于实现者**的人（审查者 / 单独的 agent）扩充，覆盖：**半角片假名**（日本旧系统日志常见：`ﾃｽﾄ`，Shift_JIS 单字节 A1–DF，易被误判为 GBK / Big5）、JIS 第二水准汉字、GB18030 四字节、Big5 二级字、只有汉字的短文本、CSV（逗号 + 汉字）、混入少量 Windows-1252 符号的英文。
   - 补「合法 UTF-16 且码点集中在 CJK / 假名区」的无 BOM UTF-16 判断。
   - 打分在两个候选接近时（差距 < 阈值）返回 `confidence: 'guess'`，状态栏提示「编码为推测」并突出手动切换。
   - 解码结果出现 U+FFFD 时提示「可能乱码」。
3. 抽样：开头 / 中间 / 末尾各 64KB 做判断；全量模式建索引时继续做 UTF-8 校验（3.4 节第 3 条）。

## 5. 性能目标

- 本地 1GB 日志：首屏（末尾）< 300ms；全量索引 ≥ 300MB/s（SSD）；任意位置跳转 < 100ms。
- 网络共享：首屏只读 4MB 窗口（部分模式）或头块；跳转按块读取。
- 内存：主进程每文档索引 < 2MB；渲染端块缓存上限约 2000 万字符。
- 基准放在 `text-engine` 的单元测试（生成数据，不入库），e2e 只验证功能。

## 6. 测试

- `text-engine` 单元测试：索引（LF / CRLF / 混合、`\r\n` 跨块、末尾无换行、空文件、UTF-16LE/BE、超长行检查点、增量续扫）；读取（检查点定位、跨检查点、上限、截断）；sniff；编码（各前置判断与第 4 节的样本集）；解码（去 `\r`、截断、ISO-2022-JP 块边界）；分页数学（缩放滚动条映射、边界）。
- 主进程：`DocumentService`（追加 / 轮转 / 消失、owner 释放、上限）；`local.provider.read`（开-读-关）。
- e2e：打开 10 万行日志 → 显示末尾与正确行号；跳到开头 / 中间；外部追加 → 跟随显示新行；轮转（改名后新建同名）→ 重新加载；**打开中的文件改名、上级目录改名都成功**（原则）；编码样本（Shift_JIS / EUC-JP / GBK / Big5 / UTF-16）显示正确与手动切换；无扩展名文本自动按文本打开；二进制 → 兜底插件 →「作为文本查看」；部分模式（降低阈值设置）→「读取全部」。

## 7. 待需求方确认（控制者的决定）

1. 文本插件用自绘分页（不用原生滚动高度）：跨屏文本选择不支持。
2. `preview.maxTextSizeMB` 语义改为「自动建立完整行索引的上限」（键名不变）；超过时显示末尾或开头 4MB 的部分模式。
3. 日志类（`.log`、`.out`、轮转名、sniff 判为文本的无扩展名文件）打开时在末尾并跟随；其他在开头。
4. 编码手动选择只按标签记住（不按文件持久化）。
5. 代码类扩展名也由文本插件显示（无高亮）。

## 8. 将来

- 搜索：`text-engine` 增加分块扫描接口（按编码解码后匹配），主进程实现 `doc.search`（流式结果、可取消）。
- 编辑 / 高亮：小文件改用 CodeMirror（按需引入）。
- 远程文件：provider 实现 `read` 后自动可用。

## 9. 文档改动（实现时同步）

`doc/` 3.4（新包 `@pch/text-engine`，无外部依赖；CodeMirror 改为将来）、5.x（新包与分层规则）、7.1（provider `read`）、7.5（编码：本设计 3.4 节）、9.4（文本插件）、设置一节（`preview.maxTextSizeMB` 语义）、路线图。
