# Windows 环境与工具

### Git Bash 中 `rm -f` 静默删除失败

- 日期：2026-11-18
- 症状：`rm -f` 没有报错，但文件仍在。
- 原因：文件被其他进程占用（例如另一个进程打开着 SQLite 数据库），`-f` 抑制了错误输出。
- 解决：确认没有进程占用后，用 PowerShell `Remove-Item` 删除并再次 `Get-ChildItem` 确认。
- 预防：删除后总是确认结果。

### 停止 `pnpm dev` 后残留 electron 进程

- 日期：2026-11-18
- 症状：强制停止开发服务器后，`Get-Process electron` 仍有 `--type=utility --utility-sub-type=network.mojom.NetworkService` 进程。
- 原因：父进程被强制结束，子进程成为孤儿进程。
- 解决：用 `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"` 查看命令行，确认属于本项目后结束。
- 预防：自动化脚本结束后检查残留进程。

### Python 输出中文报 `UnicodeEncodeError: 'cp932'`

- 日期：2026-11-18
- 症状：在终端中 `print` 中文字符报错。
- 原因：系统代码页为日文（cp932）。
- 解决：`PYTHONIOENCODING=utf-8 python ...`；读写文件时显式 `encoding='utf8'`。
- 预防：—

### （AI 工具环境）长 heredoc 在 Bash 工具中解析失败

- 日期：2026-11-18
- 症状：`unexpected EOF while looking for matching '"'`，命令未执行或只执行了一部分。
- 解决：用 Write 工具把脚本写到临时目录再执行；或拆成多个短命令。
- 预防：多文件、多行的批量修改不要放在一个 heredoc 里。

### 用户级环境变量在当前终端不生效

- 日期：2026-11-18
- 症状：`[Environment]::SetEnvironmentVariable(..., 'User')` 后，当前终端里读不到。
- 原因：用户级环境变量只对之后新启动的进程生效。
- 解决：当前终端另行 `$env:NAME = ...`，或重开终端。
- 预防：—

### （AI 工具环境）Bash heredoc 写文件时反斜杠丢失

- 日期：2026-11-18
- 日期修订：2026-11-19（原「给定界符加引号即可」的结论被推翻）
- 症状：用 `cat > file <<EOF` 写含 Windows 路径的测试代码，源码中的 `'C:\\x'`（转义后的一个反斜杠）变成了 `'C:\x'`，测试期望值被悄悄改变（M1-2 Task 4）。**加引号的 `<<'EOF'` 同样如此**：M1-2 最终审查者实测，2026-11-19 再次实测确认（`<<'EOF'` 写入 `'C:\\x'`，`od -c` 看到的是 `' C : \ x '`，只剩一个反斜杠；同一文件中的 `'\n'` 保持不变）。
- 原因：不加引号时 heredoc 本身会做反斜杠处理（`\\` → `\`、`\$` → `$`）；加引号时真正的 bash 不处理，但本 AI 工具环境在交给 shell 之前仍把 `\\` 折叠为 `\`（推测在工具层，未深究）。
- 解决：**含反斜杠的文件一律用 Write / Edit 工具写**（包括由脚本生成的文件：把脚本本身用 Write 写到临时目录再执行）。不要用 Bash heredoc 写含 `\\` 的内容，加引号也不行。
- 预防：写完后 `grep` / `od -c` 检查一次关键的转义序列；用 heredoc 写的补丁脚本只在确认内容不含 `\\` 时使用。

### `fs.watch` 的句柄阻止被监听目录的上级改名 / 移动

- 日期：2026-11-19
- 症状：资源树中展开了 `案件\設計書` 时，在资源管理器里把 `案件` 改名或移动失败（拒绝访问）。M1-2 最终审查 I4，控制者在 Windows 11 上用 node `fs.watch` + PowerShell `Rename-Item` 实机验证：监听 `A\B` 时重命名 / 移动其上级 `A` 失败；重命名被监听目录自身、或被监听目录的子目录不受影响；只监听根目录时重命名其子目录正常。
- 原因（推测，未查 libuv 源码确认）：Windows 下 `fs.watch` 经 `ReadDirectoryChangesW` 实现，需要一直打开被监听目录的句柄；路径上的某个目录存在打开的句柄时，其上级目录不能改名 / 移动。被监听目录自身可以改名，推测是句柄以允许删除 / 改名的共享方式打开。
- 解决：~~待需求方决定~~（候选：(1) 维持现状；(2) 每个条目根只建一个递归监听（`fs.watch(root, { recursive: true })`），只阻止条目根的上级改名；(3) 不使用 `fs.watch`，改为聚焦 / 展开时刷新 + 可选轮询。）**2026-11-19 起不再使用 `fs.watch`**：需求方选择「扫描 + 缓存」（设计 `devDoc/2026-11-19-01-refresh-cache-design.md`），目录只在一次枚举期间持有句柄，监听代码已全部删除（`doc/` 7.1、8.3 节）。
- 预防：在 Windows 上为目录建立长期打开的句柄（监听、打开的目录流等）时，先评估对用户在资源管理器中改名 / 移动上级目录的影响。

### `fs.watch` 在目录仍在时异步报错：处理不当会形成「重建 → 报错 → 重列」循环

- 日期：2026-11-19
- 症状：（M1-2 最终审查 I3，由代码推断，未在真实 NAS 上复现）不支持变更通知的 NAS / Samba、WebDAV 或网络抖动时，`fs.watch` 同步成功，随后 `ReadDirectoryChangesW` 异步失败（`error` 事件）。原实现在 `error` 时先通知变化再报告失效 → 渲染端重新列出（成功）并重发监听集合 → 主进程重建监听 → 再次报错，约每 0.5 秒整体重列一次。
- 原因：把「监听出错」等同于「目录被删除」，通知了变化；且失效后的重建没有任何节流。
- 解决：`LocalProvider` 在 `error` 时先 `fs.stat(dir)`：目录仍在 → 只报告失效（`onClose`），不通知变化；目录不在 → 先通知变化再报告失效。`VfsService` 记录失效时刻，该 URI 仍留在集合中时 60 秒内不重建（`watchRetryBackoffMs`）；离开所有集合后退避清除。单元测试用假 watcher（`vi.spyOn(fsSync, 'watch')`，provider 因此经模块对象调用 `fsSync.watch`）触发 `error`。
- 预防：监听的「失效」要区分目录已不在与监听本身失败；任何「失败后自动重建」都要有退避。
- 现状（2026-11-19）：**不再适用**——`fs.watch`、`LocalProvider.watch` 与 `VfsService` 的监听退避已删除。「失败后的重试要有退避」的结论保留在扫描进程中：共享断开后按 30 秒起翻倍、最长 5 分钟的退避只探测一个目录（`scanner/schedule/backoff.ts`）。

### Python 文本模式在 Windows 上写出 CRLF，prettier 报满屏 `Delete ␍`

- 日期：2026-11-18
- 症状：用 Python 脚本批量修改文件后，`prettier --check` 报大量 `Delete ␍`。
- 原因：Windows 下 `open(..., 'w')` 默认把 `\n` 写成 `\r\n`；仓库按 LF 管理。
- 解决：`io.open(path, 'w', encoding='utf8', newline='\n')`，或用 Write / Edit 工具。
- 预防：批量修改脚本统一指定 `newline='\n'`。

### Git Bash 的 `whoami` 遮蔽系统的 `whoami.exe`；Entra ID 账户名不能直接给 icacls

- 日期：2026-11-19
- 症状：测试中 `execFileSync('whoami')` 返回 `dir+yongjun.fu` 一类的名称，`icacls <dir> /deny <名称>:(WA)` 报 `No mapping between account names and security IDs was done.`；`whoami /user` 报 `extra operand '/user'`。
- 原因：从 Git Bash 启动的进程 PATH 中 Git 的 `usr/bin/whoami` 排在 System32 之前；它输出的名称不是 Windows 账户名。
- 解决：用 `%SystemRoot%\System32\whoami.exe /user /fo csv /nh` 取 SID，icacls 以 `*<SID>` 指定用户。
- 预防：测试中调用 Windows 自带命令时写全路径，账户用 SID 指定。

### 系统盘根目录不能以 `FILE_WRITE_ATTRIBUTES` 打开

- 日期：2026-11-19
- 症状：`CreateFileW("\\?\C:\", FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES, …)` 返回 `ERROR_ACCESS_DENIED`（5），普通子目录可以。
- 原因：系统盘根目录的 ACL 不给普通用户写属性权限。
- 解决：枚举器拒绝访问时去掉 `FILE_WRITE_ATTRIBUTES` 重试（此时无法用 LastAccessTime = -1 保护访问时间，按共享 / 盘符记一次日志）。
- 预防：需要写权限的「保护性」打开都要有只读回退；测试回退路径时用 `icacls /deny *<SID>:(WA)` 构造，不去碰真实的盘根目录。
