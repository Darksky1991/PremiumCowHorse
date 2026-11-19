# 编码测试样本集

供 `@pch/text-engine` 的编码判断做验收。样本由独立脚本 `gen.py` 用 Python codecs 生成，**不含也不参考任何编码判断实现**，
目的是避免「出题人与答题人是同一个」的偏差。语料在 `corpus.py`：日 / 简 / 繁 / 英各至少 30 句（运维 / 业务 / 日志场景），句子带数字占位符、不逐字重复。

## 重新生成

```bash
cd packages/text-engine/fixtures
PYTHONIOENCODING=utf-8 python gen.py
```

需要 Python 3 与 Node（用于调用 `compute-acceptable.mjs`）。随机数种子固定，重复运行产物一致。生成会：

1. 写 `samples/*`（各编码的字节）与 `expected/*`（原文，UTF-8）；
2. 写 `manifest.json`；
3. 用 Node 的 `TextDecoder` 对每个样本按 9 个标签解码，与原文完全一致的标签写入 `acceptable`（**脚本计算，不手填**）；
4. 自检：`label` 必须在 `acceptable` 中；`ambiguous` 样本的字节必须能被至少 2 个 CJK 标签合法解码（fatal 模式不报错）；无 BOM 纯中日文 UTF-16 样本不得含 ASCII；
5. 重写本 README 的样本表。

## manifest 字段

- `file`：`samples/` 下的文件名；原文在 `expected/` 的同名文件（UTF-8）。
- `label`：真实编码（WHATWG 标签）。Python 的 `cp932` / `shift_jis` 都标 `shift_jis`；`gbk` / `gb18030` 标 `gb18030`；`cp950` / `big5` 标 `big5`；纯 ASCII 样本标 `utf-8`。
- `acceptable`：解码结果与原文完全一致的所有标签。判断结果只要落在其中即算对；`label` 以外的标签（如纯 ASCII 的 `windows-1252`）也算对。
- `lang`：`ja` / `zh-CN` / `zh-TW` / `en` / `mixed`。
- `shape`：形态（short、kanji-only、paragraph、8kb、log、log-sparse、csv、halfwidth-kana*、no-bom-*、bom* 等）。
- `ambiguous`：人也无法从字节判断的样本，只要求判断结果 `confidence: 'guess'`，不要求命中。

## 为什么有些样本是 ambiguous

只有 4-6 个汉字、没有假名也没有 ASCII 的极短文本（`*-kanji4*`、`*-kanji6*`），其字节是双字节序列，首字节落在 0xA1-0xFE（或 0x81-0xFE），
尾字节落在 0xA1-0xFE。这些范围在 GBK / Big5 / EUC-JP（部分在 Shift_JIS）下都是合法字符，只是显示成不同的汉字，**文本是否「说得通」只有懂语言的人才能看出来**。
`acceptable` 在这些样本里只有真实编码（其他编码解出的是另一串汉字），但没有字节层面的证据能排除其他标签；生成时自检保证这些字节能被至少 2 个 CJK 标签合法解码。因此只要求 `confidence: 'guess'`，不要求命中。

## 刻意设置的难点

- **半角片假名**（`*-hw-*`）：模拟旧系统日志，纯半角行混在 ASCII 行中、以及半角与全角混排；Shift_JIS 单字节 0xA1-0xDF 易被当作 GBK / Big5 的首字节。EUC-JP 下是 0x8E + 0xA1-0xDF。
- **cp932 扩展**（`ja-sjis-ext`）：① ㈱ 髙 № 等，严格 Shift_JIS 与 EUC-JP 无法表示。
- **JIS 第二水准、GB18030 四字节、Big5 二级字**：常用字区打分不容易覆盖的字符。
- **日志型**（`*-log`、`*-log-sparse`）：几乎全 ASCII，每 30-50 行才夹一条中日文，甚至整份只有 1 行非 ASCII。
- **CSV**：逗号 + 纯汉字单元格，每个单元格都很短。
- **无 BOM 的 UTF-16**：含 ASCII（大量 NUL）与纯中日文（没有 NUL）两类。
- **BOM**：UTF-8 / UTF-16LE / BE，包括「纯 ASCII 内容 + UTF-8 BOM」。
- **Windows-1252**：英文中偶尔出现 é ü £ 弯引号 —，包括整份日志只有 1 行。
- **ISO-2022-JP**：全部为 7 位字节，含 ESC 序列。
- 同样的内容用不同编码各出一份（日 / 简 / 繁 / 英 × 旧编码 / UTF-8），便于对比。

## 样本表

| 文件 | 语言 | 编码 | 形态 | acceptable | ambiguous | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `ja-sjis-short.txt` | ja | shift_jis | short | shift_jis |  | 单行短文本，含平假名 |
| `ja-sjis-short-kana.txt` | ja | shift_jis | short | shift_jis |  | 短文本，片假名+平假名 |
| `ja-sjis-kanji4.txt` | ja | shift_jis | kanji-only | shift_jis | 是 | 4 个汉字：这 8 个字节同时是合法的 GBK / Big5 / EUC-JP 序列，无假名、无 ASCII，无法从字节判断 |
| `ja-sjis-kanji6.txt` | ja | shift_jis | kanji-only | shift_jis | 是 | 6 个汉字：同上，GBK / Big5 / EUC-JP 下也都是合法字节 |
| `ja-sjis-paragraph.txt` | ja | shift_jis | paragraph | shift_jis |  | 约 200 字的段落 |
| `ja-sjis-8kb.txt` | ja | shift_jis | 8kb | shift_jis |  | 约 8KB，CRLF 换行 |
| `ja-sjis-log.txt` | ja | shift_jis | log | shift_jis |  | 400 行日志，几乎全 ASCII，每 30-50 行夹一条日文，CRLF |
| `ja-sjis-log-sparse.txt` | ja | shift_jis | log-sparse | shift_jis |  | 400 行 ASCII 日志中只有 1 行日文 |
| `ja-sjis-csv.txt` | ja | shift_jis | csv | shift_jis |  | CSV：逗号 + 日文人名 / 部门（多数为纯汉字单元格） |
| `ja-sjis-ext.txt` | ja | shift_jis | cp932-ext | shift_jis |  | 含 ① ㈱ 髙 № Ⅰ ㊤ ㌫ ㎏ 等 cp932 厂商扩展（NEC 选定 IBM 扩展），Shift_JIS 严格子集无法表示 |
| `ja-sjis-jis2.txt` | ja | shift_jis | jis-level2 | shift_jis |  | JIS 第二水准汉字（齟齬 鬱 毀 稟 贖 憑 …） |
| `ja-sjis-plain-paragraph.txt` | ja | shift_jis | paragraph | shift_jis |  | 用 Python 严格 shift_jis 编码（仅 JIS X 0208） |
| `ja-sjis-plain-8kb.txt` | ja | shift_jis | 8kb | shift_jis |  | 严格 shift_jis，约 8KB |
| `ja-sjis-hw-tiny.txt` | ja | shift_jis | halfwidth-kana | shift_jis |  | 单行：时间戳 + 半角片假名。0xB4 0xD7 0xB0 同时是 GBK / Big5 的合法首字节，易被误判 |
| `ja-sjis-hw-short.txt` | ja | shift_jis | halfwidth-kana | shift_jis |  | 两行：纯半角片假名行 + ASCII |
| `ja-sjis-hw-log.txt` | ja | shift_jis | halfwidth-kana-log | shift_jis |  | 400 行旧系统风格日志：纯半角片假名行混在 ASCII 行中（无全角日文） |
| `ja-sjis-hw-mixed-log.txt` | ja | shift_jis | halfwidth-kana-mixed | shift_jis |  | 日志中既有纯半角片假名行，也有半角 + 全角日文混排行 |
| `ja-sjis-hw-mixed-text.txt` | ja | shift_jis | halfwidth-kana-mixed | shift_jis |  | 半角片假名与全角日文混排的短文档（无 ASCII 行） |
| `ja-sjis-hw-only.txt` | ja | shift_jis | halfwidth-kana | shift_jis |  | 只有半角片假名行（含少量 ASCII 数字），无全角字符 |
| `ja-eucjp-short.txt` | ja | euc-jp | short | euc-jp |  | 单行短文本 |
| `ja-eucjp-kanji4.txt` | ja | euc-jp | kanji-only | euc-jp | 是 | 4 个汉字：EUC-JP 的 A1-FE 双字节同时是合法的 GBK / Big5 序列，无法判断 |
| `ja-eucjp-paragraph.txt` | ja | euc-jp | paragraph | euc-jp |  | 约 200 字 |
| `ja-eucjp-8kb.txt` | ja | euc-jp | 8kb | euc-jp |  | 约 8KB，LF |
| `ja-eucjp-log.txt` | ja | euc-jp | log | euc-jp |  | 400 行 ASCII 日志夹日文，LF（Unix 系统常见） |
| `ja-eucjp-csv.txt` | ja | euc-jp | csv | euc-jp |  | CSV 逗号 + 日文 |
| `ja-eucjp-jis2.txt` | ja | euc-jp | jis-level2 | euc-jp |  | JIS 第二水准汉字 |
| `ja-eucjp-hw-log.txt` | ja | euc-jp | halfwidth-kana-log | euc-jp |  | EUC-JP 中半角片假名为 0x8E + 0xA1-0xDF；纯半角行与混排行混在 ASCII 日志中 |
| `ja-eucjp-hw-short.txt` | ja | euc-jp | halfwidth-kana | euc-jp |  | 单行 EUC-JP 半角片假名（0x8E 前缀） |
| `ja-jis-short.txt` | ja | iso-2022-jp | short | iso-2022-jp |  | 7 位 JIS，单行（含 ESC 序列） |
| `ja-jis-paragraph.txt` | ja | iso-2022-jp | paragraph | iso-2022-jp |  | ISO-2022-JP 段落 |
| `ja-jis-8kb.txt` | ja | iso-2022-jp | 8kb | iso-2022-jp |  | 约 8KB（邮件正文常见） |
| `ja-jis-log.txt` | ja | iso-2022-jp | log | iso-2022-jp |  | 几乎全 ASCII 的日志夹 ESC $ B ... ESC ( B 日文段 |
| `ja-utf8-short.txt` | ja | utf-8 | short | utf-8 |  | 单行短文本 |
| `ja-utf8-kanji4.txt` | ja | utf-8 | kanji-only | utf-8 |  | 只有汉字的 UTF-8：非法的旧编码序列，应可判定 |
| `ja-utf8-paragraph.txt` | ja | utf-8 | paragraph | utf-8 |  | 约 200 字 |
| `ja-utf8-8kb.txt` | ja | utf-8 | 8kb | utf-8 |  | 约 8KB |
| `ja-utf8-log.txt` | ja | utf-8 | log | utf-8 |  | 日志夹日文 |
| `ja-utf8-csv.txt` | ja | utf-8 | csv | utf-8 |  | CSV |
| `ja-utf8-hw-log.txt` | ja | utf-8 | halfwidth-kana-log | utf-8 |  | UTF-8 中的半角片假名（U+FF61-FF9F） |
| `ja-utf8bom-paragraph.txt` | ja | utf-8 | bom | utf-8 |  | UTF-8 BOM（EF BB BF） |
| `ja-utf8bom-log.txt` | ja | utf-8 | bom-log | utf-8 |  | UTF-8 BOM + CRLF 日志 |
| `ja-utf16le-bom-paragraph.txt` | ja | utf-16le | bom | utf-16le |  | UTF-16LE + BOM |
| `ja-utf16be-bom-paragraph.txt` | ja | utf-16be | bom | utf-16be |  | UTF-16BE + BOM |
| `ja-utf16le-bom-8kb.txt` | ja | utf-16le | bom-8kb | utf-16le |  | UTF-16LE + BOM，约 8KB，CRLF |
| `ja-utf16le-nobom-log.txt` | ja | utf-16le | no-bom-log | utf-16le |  | 无 BOM 的 UTF-16LE 日志（大量 NUL 字节） |
| `ja-utf16be-nobom-log.txt` | ja | utf-16be | no-bom-log | utf-16be |  | 无 BOM 的 UTF-16BE 日志 |
| `ja-utf16le-nobom-pure.txt` | ja | utf-16le | no-bom-pure-cjk | utf-16le |  | 无 BOM、无 ASCII 的纯日文 UTF-16LE（没有 NUL 字节可作线索，码点都在假名 / CJK 区） |
| `ja-utf16be-nobom-pure.txt` | ja | utf-16be | no-bom-pure-cjk | utf-16be |  | 无 BOM、无 ASCII 的纯日文 UTF-16BE |
| `ja-utf16le-nobom-pure-8kb.txt` | ja | utf-16le | no-bom-pure-cjk | utf-16le |  | 无 BOM 纯日文 UTF-16LE，约 8KB |
| `zh-gbk-short.txt` | zh-CN | gb18030 | short | gb18030 |  | 单行短文本（含标点，无 ASCII） |
| `zh-gbk-kanji4.txt` | zh-CN | gb18030 | kanji-only | gb18030 | 是 | 4 个汉字：GBK 双字节同时是合法的 Big5 / EUC-JP / Shift_JIS 序列，无法判断 |
| `zh-gbk-kanji4b.txt` | zh-CN | gb18030 | kanji-only | gb18030 | 是 | 4 个汉字，同上 |
| `zh-gbk-paragraph.txt` | zh-CN | gb18030 | paragraph | gb18030 |  | 约 200 字 |
| `zh-gbk-8kb.txt` | zh-CN | gb18030 | 8kb | gb18030 |  | 约 8KB，含二级字 |
| `zh-gbk-log.txt` | zh-CN | gb18030 | log | gb18030 |  | 400 行 ASCII 日志夹中文，CRLF |
| `zh-gbk-log-sparse.txt` | zh-CN | gb18030 | log-sparse | gb18030 |  | 全文只有 1 行中文 |
| `zh-gbk-csv.txt` | zh-CN | gb18030 | csv | gb18030 |  | CSV：逗号 + 中文人名 / 部门（Excel 导出常见） |
| `zh-gbk-rare.txt` | zh-CN | gb18030 | rare-chars | gb18030 |  | 较生僻字（殚 亟 濒 …） |
| `zh-gb18030-4byte.txt` | zh-CN | gb18030 | gb18030-4byte | gb18030 |  | 含 GB18030 四字节字符（𠮷 😀 𡈽 …），GBK 无法表示 |
| `zh-gb18030-8kb.txt` | zh-CN | gb18030 | 8kb | gb18030 |  | 约 8KB，混入四字节字符 |
| `zh-gb18030-log.txt` | zh-CN | gb18030 | log | gb18030 |  | 日志夹中文 + 偶有四字节字符 |
| `zh-utf8-short.txt` | zh-CN | utf-8 | short | utf-8 |  | 单行短文本 |
| `zh-utf8-kanji4.txt` | zh-CN | utf-8 | kanji-only | utf-8 |  | 4 个汉字的 UTF-8 |
| `zh-utf8-paragraph.txt` | zh-CN | utf-8 | paragraph | utf-8 |  | 约 200 字 |
| `zh-utf8-8kb.txt` | zh-CN | utf-8 | 8kb | utf-8 |  | 约 8KB |
| `zh-utf8-log.txt` | zh-CN | utf-8 | log | utf-8 |  | 日志夹中文 |
| `zh-utf8-csv.txt` | zh-CN | utf-8 | csv | utf-8 |  | CSV |
| `zh-utf16le-bom-paragraph.txt` | zh-CN | utf-16le | bom | utf-16le |  | UTF-16LE + BOM |
| `zh-utf16le-nobom-pure.txt` | zh-CN | utf-16le | no-bom-pure-cjk | utf-16le |  | 无 BOM、无 ASCII 的纯中文 UTF-16LE |
| `zh-utf16be-nobom-pure.txt` | zh-CN | utf-16be | no-bom-pure-cjk | utf-16be |  | 无 BOM、无 ASCII 的纯中文 UTF-16BE |
| `zh-utf16le-nobom-log.txt` | zh-CN | utf-16le | no-bom-log | utf-16le |  | 无 BOM UTF-16LE 日志 |
| `tw-big5-short.txt` | zh-TW | big5 | short | big5 |  | 单行短文本 |
| `tw-big5-kanji4.txt` | zh-TW | big5 | kanji-only | big5 | 是 | 4 个汉字：Big5 双字节同时是合法的 GBK / EUC-JP 序列，无法判断 |
| `tw-big5-kanji4b.txt` | zh-TW | big5 | kanji-only | big5 | 是 | 5 个汉字，同上 |
| `tw-big5-paragraph.txt` | zh-TW | big5 | paragraph | big5 |  | 约 200 字 |
| `tw-big5-8kb.txt` | zh-TW | big5 | 8kb | big5 |  | 约 8KB，含 Big5 二级字（鑫 堙 謾 龕 叡 氘 …） |
| `tw-big5-log.txt` | zh-TW | big5 | log | big5 |  | 400 行 ASCII 日志夹繁体中文，CRLF |
| `tw-big5-csv.txt` | zh-TW | big5 | csv | big5 |  | CSV |
| `tw-big5-level2.txt` | zh-TW | big5 | big5-level2 | big5 |  | Big5 二级字（首字节 0xC9-0xF9：鑫 堙 謾 龕 叡 氘 僳 鄯 糴 貘） |
| `tw-big5-strict-paragraph.txt` | zh-TW | big5 | paragraph | big5 |  | Python 严格 big5 编码（不含 cp950 扩展） |
| `tw-big5-strict-8kb.txt` | zh-TW | big5 | 8kb | big5 |  | 严格 big5，约 8KB |
| `tw-utf8-short.txt` | zh-TW | utf-8 | short | utf-8 |  | 单行短文本 |
| `tw-utf8-paragraph.txt` | zh-TW | utf-8 | paragraph | utf-8 |  | 约 200 字 |
| `tw-utf8-8kb.txt` | zh-TW | utf-8 | 8kb | utf-8 |  | 约 8KB |
| `tw-utf8-log.txt` | zh-TW | utf-8 | log | utf-8 |  | 日志夹繁体中文 |
| `tw-utf16le-bom-paragraph.txt` | zh-TW | utf-16le | bom | utf-16le |  | UTF-16LE + BOM |
| `en-ascii-short.txt` | en | utf-8 | short | utf-8, shift_jis, euc-jp, iso-2022-jp, gb18030, big5, windows-1252 |  | 纯 ASCII 单行 |
| `en-ascii-paragraph.txt` | en | utf-8 | paragraph | utf-8, shift_jis, euc-jp, iso-2022-jp, gb18030, big5, windows-1252 |  | 纯 ASCII 段落 |
| `en-ascii-8kb.txt` | en | utf-8 | 8kb | utf-8, shift_jis, euc-jp, iso-2022-jp, gb18030, big5, windows-1252 |  | 纯 ASCII，约 8KB |
| `en-ascii-log.txt` | en | utf-8 | log | utf-8, shift_jis, euc-jp, iso-2022-jp, gb18030, big5, windows-1252 |  | 纯 ASCII 日志 |
| `en-ascii-csv.txt` | en | utf-8 | csv | utf-8, shift_jis, euc-jp, iso-2022-jp, gb18030, big5, windows-1252 |  | 纯 ASCII CSV |
| `en-1252-short.txt` | en | windows-1252 | short | windows-1252 |  | 单行：é 弯引号 — £ |
| `en-1252-short2.txt` | en | windows-1252 | short | windows-1252 |  | 极短：只含一个 ë 和一个 ü（0xEB、0xFC） |
| `en-1252-paragraph.txt` | en | windows-1252 | paragraph | windows-1252 |  | 英文段落，含 é ü £ 弯引号 — |
| `en-1252-8kb.txt` | en | windows-1252 | 8kb | windows-1252 |  | 约 8KB，大部分是 ASCII，偶尔有 Windows-1252 符号 |
| `en-1252-log.txt` | en | windows-1252 | log | windows-1252 |  | 日志：每 30-50 行夹一条含 é “ ” £ 的消息 |
| `en-1252-log-sparse.txt` | en | windows-1252 | log-sparse | windows-1252 |  | 整份日志只有 1 行含 ü £ — |
| `en-1252-csv.txt` | en | windows-1252 | csv | windows-1252 |  | CSV：逗号 + 带重音的姓名 + £ |
| `en-utf8-short.txt` | en | utf-8 | short | utf-8 |  | UTF-8 的同一类符号：é ’ — £ |
| `en-utf8-paragraph.txt` | en | utf-8 | paragraph | utf-8 |  | UTF-8 段落，含重音与弯引号 |
| `en-utf8-8kb.txt` | en | utf-8 | 8kb | utf-8 |  | 约 8KB |
| `en-utf8-log.txt` | en | utf-8 | log | utf-8 |  | 日志夹 UTF-8 的重音字符 |
| `en-utf8-csv.txt` | en | utf-8 | csv | utf-8 |  | CSV |
| `en-utf8bom-log.txt` | en | utf-8 | bom-log | utf-8 |  | 纯 ASCII 内容 + UTF-8 BOM（PowerShell 5 的 Out-File 常见） |
| `en-utf16le-bom-log.txt` | en | utf-16le | bom-log | utf-16le |  | UTF-16LE + BOM 的英文日志（Windows 命令输出重定向常见） |
| `en-utf16le-nobom-log.txt` | en | utf-16le | no-bom-log | utf-16le |  | 无 BOM 的 UTF-16LE，几乎全是 ASCII 的英文（每个字符后一个 NUL） |
| `en-utf16be-nobom-log.txt` | en | utf-16be | no-bom-log | utf-16be |  | 无 BOM 的 UTF-16BE 英文 |
| `en-utf16le-nobom-short.txt` | en | utf-16le | short | utf-16le |  | 无 BOM 的 UTF-16LE 极短英文 |
| `mixed-utf8-log.txt` | mixed | utf-8 | log | utf-8 |  | 多语言日志：日 / 简 / 繁 / 英混合，UTF-8 |
| `mixed-utf8-paragraph.txt` | mixed | utf-8 | paragraph | utf-8 |  | 一份文件里日 / 简 / 繁 / 英各一段 |
| `mixed-utf16le-bom-log.txt` | mixed | utf-16le | bom-log | utf-16le |  | 多语言 UTF-16LE + BOM 日志 |

## 注意

- 日文语料不使用 〜（U+301C）、－、―、∥ 等 Python 与 WHATWG 映射不同的字符，所以 `shift_jis` / `euc-jp` 样本都能与 `TextDecoder` 往返一致。
- `ja-sjis-*` 实际是 cp932（Windows-31J）：WHATWG 的 `shift_jis` 标签就是 cp932。
- 读取样本用 `src/fixtures.test-helper.ts` 的 `loadFixtures()`（只在测试里使用）。
