# 文本 / 日志预览（大文件分页模型）：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任意大小的文本 / 日志立即打开、按需读取，中日英编码自动判断，日志跟随末尾与变化反映。

**Architecture:** 纯逻辑在新包 `@pch/text-engine`（行索引、按行读取、sniff、编码判断、解码、分页数学；无依赖、无 I/O）；主进程 `vfs/document` 负责开-读-关的读取、文档表、索引任务与刷新，经 `doc.*` IPC 提供；渲染端宿主实现 `PreviewHost.doc` 并负责轮询；`plugins/builtin/src/text` 是自绘分页视图。

**Tech Stack:** TypeScript、Node `fs/promises`（主进程）、`TextDecoder`（WHATWG 标签）、React 19、Vitest、Playwright；Python 仅用于生成测试样本（不进运行时）。

**Spec:** [`devDoc/2026-11-20-18-text-preview-design.md`](./2026-11-20-18-text-preview-design.md)（第 3 节架构、第 4 节编码决定、第 7 节控制者决定）；现状 `doc/` v1.16。

## Global Constraints

- 原型优先：只做设计第 1–3 节的「目标」；简报之外的问题只修明显 / 重要的，其余记录。测试范围按改动判断（`CLAUDE.md`）；全量在 Task 7 由控制者兜底。
- `@pch/text-engine` 不依赖任何包、不 import Node / DOM / Electron 专有 API（`TextDecoder`、`Uint8Array` 可用）；**不引入编码检测库**（设计第 4 节）。
- 文件系统原则：只读；每次读取 = 打开 → 读 → 立即关闭；打开方式不得妨碍他人写入 / 删除 / 改名。不新增自定义协议，不放宽 CSP。
- 常量（设计原值）：检查点每 1000 行或距上一个检查点 ≥ 1MB；`doc.readLines` 每次 ≤ 2000 行且 ≤ 4MB；单行返回 ≤ 64KB（超出截断并标记）；显示每行 ≤ 10000 字符；部分模式窗口 4MB（对齐行边界）；编码抽样开头 / 中间 / 末尾各 64KB；sniff 读开头 8KB；`doc.progress` 节流 ≥ 200ms；每窗口最多 16 个打开的文档（超出关闭最久未用的）；渲染端块 = 1000 行、缓存上限约 2000 万字符；读取块 1MB。
- `preview.maxTextSizeMB`（默认 50，键名不变）= 自动建立完整行索引的上限；超过则部分模式。
- WHATWG 编码标签集合：`utf-8`、`utf-16le`、`utf-16be`、`shift_jis`、`euc-jp`、`iso-2022-jp`、`gb18030`、`big5`、`windows-1252`。
- 分层：新元素在 `eslint.config.mjs` 登记（`text-engine` 可被 main-vfs、plugin 引用）；IPC 新通道走「契约 → 主进程 handler → 渲染端 `call()`」；三语文案同时添加；shadcn 组件不改。
- 结构变化同一提交更新 `doc/`；Task 7 升为 v1.17。

## Review Focus

1. 日志在建索引 / 查看期间被追加：索引不错位、行数单调增长、跟随时显示新行。→ Task 4 单元测试（扫描中途增长）+ Task 6 e2e。
2. 打开中的文件被轮转（改名后新建同名）、截断或删除：重新加载或显示「文件已不存在」，不崩溃、不显示错位内容。→ Task 4 单元测试 + Task 6 e2e。
3. 建索引期间改名该文件与其上级目录成功（文件系统原则）。→ Task 4 确认打开方式 + Task 6 e2e（约 50MB 文件，索引进行中改名）。
4. Shift_JIS 半角片假名、只有汉字的短文本、GBK / Big5 生僻字不被误判；两候选接近时为 `guess`。→ Task 2 样本集 + Task 3 测试。
5. 无换行的超大单行文件（约 20MB 的压缩 JSON）：打开不卡死、显示截断提示、读取量有界。→ Task 1 读取测试 + Task 6 e2e。

---

### Task 1: `@pch/text-engine` 包、稀疏行索引与按行读取

**Files:** Create `packages/text-engine/{package.json, tsconfig.json, src/index.ts, src/types.ts, src/line-index.ts, src/line-reader.ts}` 与测试；Modify `eslint.config.mjs`（元素 `text-engine`，允许 main-vfs / plugin 引用；text-engine 只能引用自身）、`tsconfig` 引用（照 `packages/shared` 的做法）、`plugins/builtin/package.json` 与 `apps/desktop/package.json` 依赖 `@pch/text-engine: workspace:*`；doc 3 / 5 节（新包与分层）。

**Interfaces（Produces）:**

```ts
export type EncodingLabel =
  | 'utf-8'
  | 'utf-16le'
  | 'utf-16be'
  | 'shift_jis'
  | 'euc-jp'
  | 'iso-2022-jp'
  | 'gb18030'
  | 'big5'
  | 'windows-1252'
export const ENCODING_LABELS: readonly EncodingLabel[]
export type NewlineUnit = 'byte' | 'utf16le' | 'utf16be'
export const unitOf: (label: EncodingLabel) => NewlineUnit
export interface LineIndexOptions {
  unit: NewlineUnit
  checkpointLines?: number
  checkpointBytes?: number
} // 默认 1000 / 1_048_576
export class LineIndex {
  constructor(windowStart: number, options: LineIndexOptions)
  feed(chunk: Uint8Array, offset: number): void // offset 必须等于 indexedTo
  finish(windowEnd: number): void // 末尾无换行的部分计为一行
  reopen(): void // 追加前调用：末行若无换行则重新视为未完成
  readonly lines: number // 已确定的行数（finish 后含末尾无换行的行）
  readonly indexedTo: number
  readonly complete: boolean
  checkpointFor(line: number): { line: number; offset: number }
}
export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>
export interface LineBlock {
  start: number
  bytes: Uint8Array
  starts: number[]
  ends: number[]
  truncated: number[]
} // starts/ends 为 bytes 内偏移，ends 不含 \n 与前面的 \r（UTF-16 按单元）
export function readLines(
  index: LineIndex,
  readAt: ReadAt,
  start: number,
  count: number,
  limits?: { maxBytes?: number; maxLineBytes?: number }
): Promise<LineBlock> // 默认 4MB / 65536
```

- [ ] **Step 1: 写失败的测试**：`LF` / `CRLF` / 混合；`\r\n` 恰好跨两次 `feed`；末尾无换行（`finish` 后行数 +1）；空文件 0 行；UTF-16LE / BE 换行（含 `0x0A` 出现在非换行码元的高字节，如 `U+0A00` 系不应切行）；检查点：第 1000 行、以及一行 3MB 后的下一行有检查点；`reopen` 后追加使末行延长而非新增；窗口起点非 0；`readLines` 跨检查点、`count` 超出末尾、超 64KB 的行被截断且列入 `truncated`、总量 > 4MB 时提前结束；**20MB 无换行单行：`readLines(0, 10)` 只读取有界字节**（Review Focus 5，用计数的 `readAt` 断言读取总量 < 2MB）。基准测试（生成 200MB 数据，`PCH_BENCH=1` 时才跑）记录索引吞吐。
- [ ] **Step 2–4:** 失败 → 实现 → 通过（`pnpm vitest run packages/text-engine` + typecheck / lint / prettier）。
- [ ] **Step 5: 提交** `feat(text-engine): add the sparse line index and line reader`

### Task 2: 编码测试样本集（由不同于 Task 3 实现者的 agent 编写）

**Files:** Create `packages/text-engine/fixtures/{gen.py, manifest.json, README.md, samples/*}`（生成的样本文件入库，总量 < 3MB）、`packages/text-engine/src/fixtures.test-helper.ts`（读取 manifest 与样本，供 Task 3 使用）。

**Interfaces（Produces）:** `manifest.json`：`[{ file: string; label: EncodingLabel; acceptable: EncodingLabel[]; lang: 'ja'|'zh-CN'|'zh-TW'|'en'|'mixed'; shape: string; ambiguous?: boolean }]`（`acceptable` = 解码结果与原文一致的所有标签；`ambiguous: true` 表示人也无法判定、只要求 `confidence: 'guess'`）。`loadFixtures(): Array<{ entry; bytes: Uint8Array; text: string }>`。

- [ ] **Step 1:** 编写 `gen.py`（Python codecs）。语料自然、各语言用词不同、句子不重复（每种 ≥ 30 句，运维 / 业务 / 日志场景）。必须覆盖：日（cp932 含 ①㈱髙№ 与 **半角片假名**行、shift_jis、euc_jp、iso2022_jp、utf-8、utf-8 BOM、JIS 第二水准汉字）；简（gbk、gb18030 含四字节字符、utf-8）；繁（cp950 / big5 含二级字、utf-8）；英（cp1252 含 é ü £ 弯引号 —、utf-8、ascii）；UTF-16LE / BE 有 BOM 与无 BOM（含纯中日文无 ASCII 的）；形态：单行短文本（含只有汉字的 4–8 字，标 `ambiguous`）、段落、8KB、日志型（几乎全 ASCII、每 30–50 行夹中日文）、CSV（逗号 + 汉字）、只含半角片假名的日志行。
- [ ] **Step 2:** 生成并写 `README.md`（如何重新生成、各样本含义）；`loadFixtures` 的冒烟测试（每个样本按 `label` 用 `TextDecoder` 解码 === 原文；这同时验证 Chromium / Node 支持这些标签）。
- [ ] **Step 3: 提交** `test(text-engine): add the encoding fixture corpus`

### Task 3: sniff、编码判断与解码

**Files:** Create `packages/text-engine/src/{sniff.ts, encoding.ts, decode.ts}` 与测试。

**Interfaces（Produces）:**

```ts
export interface SniffResult {
  kind: 'text' | 'binary' | 'empty'
  bom: EncodingLabel | null
}
export function sniff(head: Uint8Array): SniffResult // 开头 8KB；NUL / 控制字符比例；UTF-16（有无 BOM）不算二进制
export interface EncodingGuess {
  label: EncodingLabel
  confidence: 'certain' | 'likely' | 'guess'
  bomLength: number
}
export function detectEncoding(
  samples: Uint8Array[],
  prefs?: { preferred?: 'ja' | 'zh-CN' | 'en' }
): EncodingGuess
export function decodeBlock(
  block: LineBlock,
  label: EncodingLabel,
  opts?: { skipBytesAtStart?: number; maxChars?: number }
): { lines: string[]; replaced: boolean } // 默认 maxChars 10000；replaced = 出现 U+FFFD
```

- 判断顺序（设计 3.4 / 第 4 节）：BOM（certain）→ 无 BOM UTF-16（NUL 分布，**加**「按 UTF-16 解码合法且码点集中在 CJK / 假名区」）→ 严格 UTF-8（容忍样本末尾截断）→ ISO-2022-JP 转义序列 → Shift_JIS / EUC-JP / GBK(gb18030) / Big5 / Windows-1252 常用字区打分，排除用该编码 fatal 解码失败者；前两名差距小于阈值或总分过低 → `guess`；平局按 `preferred` 排序。参考实验实现（只读参考，勿照抄未测部分）：`C:/Users/yongjun.fu/AppData/Local/Temp/claude/61e7f65027d4b9f3/9c40c981-47b8-4b09-b70c-6a2382fd5c8e/scratchpad/enc-spike/detectors.mjs` 第 28–80 行。

- [ ] **Step 1: 写失败的测试**：对 Task 2 全部样本：非 `ambiguous` 的结果 ∈ `acceptable`；`ambiguous` 的结果 `confidence === 'guess'`（Review Focus 4）；sniff：PNG / ZIP / exe 头 → binary，UTF-16 有无 BOM → text，空 → empty；decode：去掉 BOM、`\r` 已由 reader 去掉、截断到 maxChars、非法字节 → `replaced`。准确率汇总打印到测试输出（便于记录）。
- [ ] **Step 2–4:** 失败 → 实现 → 通过。**不得为通过测试而修改样本或 manifest**；认为样本有误时在报告中说明，由控制者裁定。
- [ ] **Step 5: 提交** `feat(text-engine): detect text encodings for Japanese, Chinese and English`

### Task 4: 主进程文档服务与 IPC

**Files:** Modify `apps/desktop/src/main/vfs/types.ts`、`providers/local.provider.ts`（`read`）、`vfs.service.ts`（路由 `read`）；Create `apps/desktop/src/main/vfs/document/{document-service.ts, document.ipc.ts}` 与测试；Modify `packages/shared/src/ipc/contract.ts`（`doc.*`、`vfs.sniff`、事件）、`packages/shared/src/doc/types.ts`（`DocumentInfo`、`DOC_ENCODINGS`）、主进程组合根注册 handler、窗口销毁时释放；`knowledge/`（打开方式的结论）；doc 7.1 / 7.5 节。

**Interfaces（Produces）:**

```ts
// FileSystemProvider
read(uri: URL, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>   // 开-读-关
// shared
export interface DocumentInfo {
  docId: string; uri: string; size: number; mtime: number
  encoding: { label: DocEncoding; confidence: 'certain' | 'likely' | 'guess'; bomLength: number; manual: boolean }
  binary: boolean
  mode: 'full' | 'partial'; window: { start: number; end: number }
  index: { lines: number; complete: boolean; indexedTo: number }
}
// IPC
'doc.open' { uri, encoding?: DocEncoding, at?: 'start' | 'end' } → DocumentInfo       // at 决定部分模式取开头还是末尾
'doc.readLines' { docId, start, count (1..2000) } → LineBlock
'doc.refresh' { docId } → DocumentInfo
'doc.setEncoding' { docId, encoding: DocEncoding | null } → DocumentInfo
'doc.buildIndex' { docId } → DocumentInfo
'doc.close' { docId } → void
'vfs.sniff' { uri } → { kind: 'text' | 'binary' | 'empty' }
event 'doc.progress' { docId, indexedTo, lines, complete }
event 'doc.changed' { docId, appended?: true, reset?: true, missing?: true }
```

- `DOC_ENCODINGS`（shared 的 zod enum）与 text-engine 的 `ENCODING_LABELS` 是同一集合：在主进程加一个类型层面的相等性断言测试。
- 身份变化判定（与 provider 无关）：大小变小，或开头 4KB 与打开时不同 → `reset`；只增长 → 从 `reopen()` 续扫新增部分 → `appended`；不存在 → `missing`。
- 编码：`detectEncoding` 的样本取窗口开头 / 中间 / 末尾各 64KB，`preferred` 取当前界面语言（ja → 'ja'、zh-CN → 'zh-CN'、en → 'en'）。全量模式建索引时，若判断为 `utf-8` 且不是 BOM 确定的，继续对全部内容做 UTF-8 校验；发现非法字节则重新判断（用含该处的样本）并发 `doc.changed { reset: true }`（设计 3.4 第 3 条）。
- 打开方式：先查 libuv 源码确认 Windows 下 `fs.open` 的共享标志（`FILE_SHARE_READ | WRITE | DELETE`），把结论与出处写入 `knowledge/`；不满足时改用 koffi `CreateFileW`。

- [ ] **Step 1: 写失败的测试**：`local.provider.read`（偏移 / 长度 / 越界 / 不存在 → `FS_NOT_FOUND`，读后句柄关闭——Windows 上读完立即可改名该文件）；`DocumentService`（用内存假 provider）：打开 → 索引完成、进度节流、全量 / 部分模式按阈值、`at: 'end'` 的窗口对齐行边界；**扫描中途文件增长**不错位（Review Focus 1）；追加 → `appended`；截断 / 开头变化 → `reset`；删除 → `missing`（Review Focus 2）；前 64KB 纯 ASCII、后部出现 Shift_JIS 的日志 → 建索引后改判为 shift_jis 并 `reset`；`setEncoding` 切换 UTF-16 ↔ 其他时重建；每 owner 上限 16（LRU）；owner 释放后 `readLines` 以错误拒绝；IPC handler 的输入校验（count 超限被拒）。
- [ ] **Step 2–4:** 失败 → 实现 → 通过。
- [ ] **Step 5: 提交** `feat(vfs): serve paged text documents to the renderer`

### Task 5: 宿主 API、插件选择与「作为文本查看」

**Files:** Modify `packages/plugin-sdk/src/index.ts`（`PreviewHost.doc`、`ResourceInfo.textLike`、`match.textLike`）、`apps/desktop/src/renderer/src/features/preview/{host.ts, registry.ts, preview-container.tsx}`、`data/`（`doc.*` 调用与事件订阅）、fallback 插件（「作为文本查看」按钮）、三语资源；doc 9.x 节。

**Interfaces（Produces）:**

```ts
PreviewHost.doc: {
  open(uri: string, opts?: { encoding?: DocEncoding; at?: 'start' | 'end' }): Promise<DocumentInfo>
  readLines(docId: string, start: number, count: number): Promise<LineBlock>
  setEncoding(docId: string, encoding: DocEncoding | null): Promise<DocumentInfo>
  buildIndex(docId: string): Promise<DocumentInfo>
  close(docId: string): void
  onProgress(docId: string, cb: (p: DocProgress) => void): () => void
  onChanged(docId: string, cb: (c: DocChange) => void): () => void      // 宿主轮询 + 刷新也经此回调
}
// 插件只声明 match.textLike: true 表示「接受 sniff 判为文本的未匹配文件」
```

- 宿主轮询：标签为激活标签且窗口聚焦时，每 `cache.interval.focus.local` / `.network` 秒（按位置）对该标签打开的文档 `doc.refresh`；地址栏刷新 / F5（`onRefresh`）立即 `doc.refresh`。插件不自己计时。
- 选择：文件没有被任何非 fallback 插件按扩展名 / MIME 匹配时，容器先 `vfs.sniff`（加载中显示占位），`text` → 带 `textLike` 的插件，否则 fallback。
- 「作为文本查看」：与现有「以文件信息显示」（`preview-container.tsx` 的 `showInfo`）同一种按标签的本地状态（`viewAs: 'info' | 'text' | null`），导航到其他位置时清除。

- [ ] **Step 1: 写失败的测试**：registry（textLike 只在未匹配且 sniff 为 text 时参与；扩展名匹配优先）；宿主轮询（非激活 / 失焦不轮询；间隔取本地 / 网络设置；`onRefresh` 立即刷新）；e2e 留给 Task 6。
- [ ] **Step 2–4:** 失败 → 实现 → 通过。
- [ ] **Step 5: 提交** `feat(preview): expose paged documents to plugins and sniff unknown files`

### Task 6: 文本插件（自绘分页视图）

**Files:** Create `packages/text-engine/src/pager-model.ts` 与测试；`plugins/builtin/src/text/{index.ts, i18n.ts, text-view.tsx, gutter / lines / scrollbar 组件, status-bar.tsx, block-cache.ts, log-like.ts}` 与测试；注册到 `plugins/builtin/src/index.ts`；e2e `e2e/text.spec.ts`；doc 9.4 节、设置一节（`preview.maxTextSizeMB` 语义）。

**Interfaces:**

```ts
// text-engine/pager-model.ts（纯函数）
export interface Pager { top: number; visible: number; total: number }
export function clampTop(p: Pager): number
export function scrollLines(p: Pager, delta: number): Pager
export function thumb(p: Pager, trackPx: number, minThumbPx?: number): { offsetPx: number; sizePx: number }
export function topFromThumb(p: Pager, trackPx: number, offsetPx: number, minThumbPx?: number): number
// plugin
export function isLogLike(name: string, sniffedWithoutExtension: boolean): boolean   // .log / .out / *.log.<n> / *.log.<date> / 无扩展名的文本
viewState: { top: number; encoding?: DocEncoding; follow: boolean }
```

- 视图：固定行高；只渲染可见行；行号栏（部分模式不显示绝对行号）；自绘滚动条；滚轮 / 拖动 / PageUp / PageDown / Ctrl+Home / Ctrl+End / ↑↓；缺块显示占位行；块请求按块去重、离开视口可丢弃。
- 状态栏：编码下拉（自动 + 9 个标签；`guess` 时显示「编码为推测」，`replaced` 时显示「可能乱码」）、行数或索引进度、大小、模式（部分模式：「仅显示末尾 4MB / 共 N」+「读取全部」按钮）、单行截断提示。
- 工具栏：开头 / 末尾 / 跟随。日志类打开在末尾并跟随；用户向上滚动关闭跟随；`appended` 时若跟随则保持在末尾；`reset` 时清缓存后按跟随状态定位；`missing` 时显示「文件已不存在」并保留已缓存内容。
- 关闭标签 / 卸载时 `host.doc.close`。

- [ ] **Step 1: 写失败的测试**：pager-model（边界、缩放映射往返、total < visible）；block-cache（LRU 按字符数上限）；isLogLike。e2e：10 万行日志打开在末尾、最后一行与行号正确；Ctrl+Home 到开头、拖滚动条到中间显示对应行号的内容；外部追加 3 行 → 跟随显示（Review Focus 1）；轮转（改名后新建同名）→ 重新加载、删除 → 「文件已不存在」（Review Focus 2）；**约 50MB 文件索引进行中改名该文件、再改名其上级目录均成功**（Review Focus 3）；Shift_JIS / EUC-JP / GBK / Big5 / UTF-16 样本显示正确、手动切换编码生效；无扩展名文本自动按文本打开；PNG → fallback →「作为文本查看」；约 20MB 无换行单行 → 显示截断提示、界面可操作（Review Focus 5）；降低 `preview.maxTextSizeMB` → 部分模式 →「读取全部」后显示行号。页面级截图（ja 浅色）。
- [ ] **Step 2–4:** 失败 → 实现 → 通过。
- [ ] **Step 5: 提交** `feat(preview): add the paged text and log viewer`

### Task 7: 收尾

**Files:** `doc/`（v1.17：3.4、5、7.1、7.5、9.4、设置、路线图；目标结构与「已实现」分开写）、`devDoc/2026-11-20-20-text-preview.md`（新建并登记：做了什么、已验证 / 未验证、基准数据、控制者决定、待确认、记录的问题）、页面级截图（ja 浅色、zh-CN 深色、en 浅色）、基准（`PCH_BENCH=1`）结果。

- [ ] **Step 1:** 文档、基准与截图。
- [ ] **Step 2:** 控制者全量检查兜底。
- [ ] **Step 3: 提交** `docs: document the paged text and log viewer`
