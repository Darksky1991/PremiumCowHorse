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
- 再次踩到（2026-11-21，M3 Task 2 / Task 11）：用 heredoc 写测试文件，路径字面量 `'C:\\work\\a.xlsx'` 落盘成 `'C:\work\a.xlsx'`（运行时成了控制字符），`keys.test.ts` / `item-label.test.ts` 因此失败，改用 Write 工具后通过。2026-11-22 在命令行里直接 `node -e '…`^\\d+$`…'` 也被折叠成 `^\d+$`：**不只是 heredoc，Bash 工具命令文本中的 `\\` 都可能被折叠**，验证转义的实验要把脚本写成文件再运行。
- 再次踩到（2026-11-22，M3 合并前修正波）：在 heredoc 里写 Python 补丁脚本，Python 源码中的 `'C:\\x'`、`r"""…\\…"""` 落盘前已被折叠成一个反斜杠（TS 测试报 `Invalid escape sequence`）；`git commit -F - <<'EOF'` 的提交信息里 `\\` 同样变成 `\`。含反斜杠的补丁脚本、提交信息改用 Write 工具写成文件再执行 / `git commit -F <文件>`。

### `fs.watch` 的句柄阻止被监听目录的上级改名 / 移动（2026-11-19 起不再使用 `fs.watch`）

- 日期：2026-11-19
- 症状：资源树中展开了 `案件\設計書` 时，在资源管理器里把 `案件` 改名或移动失败（拒绝访问）。M1-2 最终审查 I4，控制者在 Windows 11 上用 node `fs.watch` + PowerShell `Rename-Item` 实机验证：监听 `A\B` 时重命名 / 移动其上级 `A` 失败；重命名被监听目录自身、或被监听目录的子目录不受影响；只监听根目录时重命名其子目录正常。
- 原因（推测，未查 libuv 源码确认）：Windows 下 `fs.watch` 经 `ReadDirectoryChangesW` 实现，需要一直打开被监听目录的句柄；路径上的某个目录存在打开的句柄时，其上级目录不能改名 / 移动。被监听目录自身可以改名，推测是句柄以允许删除 / 改名的共享方式打开。
- 解决：~~待需求方决定~~（候选：(1) 维持现状；(2) 每个条目根只建一个递归监听（`fs.watch(root, { recursive: true })`），只阻止条目根的上级改名；(3) 不使用 `fs.watch`，改为聚焦 / 展开时刷新 + 可选轮询。）**2026-11-19 起不再使用 `fs.watch`**：需求方选择「扫描 + 缓存」（设计 `devDoc/2026-11-19-01-refresh-cache-design.md`），目录只在一次枚举期间持有句柄，监听代码已全部删除（`doc/` 7.1、8.3 节）。
- 预防：在 Windows 上为目录建立长期打开的句柄（监听、打开的目录流等）时，先评估对用户在资源管理器中改名 / 移动上级目录的影响。回归测试：e2e `principle: renaming an ancestor of an expanded directory succeeds`（展开 `A\B\C`、经过 2 个刷新间隔后由测试进程改名 `A` 10 次）。2026-11-19 另用一次性脚本在测试进程内对照：`fs.watch(A\B\C)` 期间 `renameSync(A, A2)` 报 `EPERM`，关闭监听后成功——即该用例的做法能检出长期持有的句柄。

### Node `fs.open` 在 Windows 上的共享方式：`FILE_SHARE_READ | WRITE | DELETE`；但打开期间上级目录仍不能改名

- 日期：2026-11-20
- 症状：（文本预览 Task 4 预先确认）需要「读取文件时不妨碍他人写入、删除、改名」。一次性脚本实测（Node 26.13.1 与 Electron 45.3.3 内置的 Node 24.22.3，libuv 都是 1.52.1）：`fs.promises.open(p, 'r')` 的句柄打开期间，他人**追加写入、改名该文件、删除该文件都成功**，同一句柄改名后仍能继续读；**改名其上级（祖父）目录报 `EPERM`**；关闭句柄后改名上级目录成功。
- 原因：libuv `src/win/fs.c` 的 `fs__open`（v1.52.1，约 499–513 行）：除非传 `UV_FS_O_EXLOCK`，否则 `share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`（注释：为了与 UNIX 语义一致，打开中的文件也能删除），随后（约 612 行）`CreateFileW(req->file.pathw, access, share, NULL, disposition, attributes, NULL)`。出处：`https://raw.githubusercontent.com/libuv/libuv/v1.52.1/src/win/fs.c`；版本用 `process.versions.uv` 确认。上级目录不能改名是 Windows 本身的限制：目录之下有打开的句柄时该目录不能改名 / 移动，与句柄的共享标志无关（改用 koffi `CreateFileW` 以同样的标志打开不会有区别）。
- 解决：`LocalProvider.read` 直接用 `fs.promises.open` + `FileHandle.read` + `finally` 中 `close`（每次读取开-读-关，不在调用之间持有句柄）；文本文档的索引按 1MB 分块，每块单独开关。上级目录只在一次读取的那一刻（本地毫秒级）不能改名，与目录枚举期间的限制相同。
- 预防：任何读取都不要在调用之间保留 `FileHandle` / 流；需要长时间读取时分块、每块开关。回归测试：`local.provider.test.ts` 的 `closes the file right after reading: the file and its folder can be renamed`（读完立即改名文件与其上级目录，句柄泄漏时上级改名会 `EPERM`）。

### `fs.watch` 在目录仍在时异步报错：处理不当会形成「重建 → 报错 → 重列」循环（2026-11-19 起不再使用 `fs.watch`）

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
- 2026-11-19 起不再使用：需求方决定读目录只用只读句柄，原因是写属性访问会在服务器上留下审核记录；变化检测不依赖访问时间。

### Bash 工具：命令中的反斜杠被吞（`'\\server'` 变成 `\server`）

- 日期：2026-11-19
- 症状：用 heredoc 写含 UNC 路径 / 正则 / 转义的源码，写出的文件里反斜杠少了一半（`\` → `\`、`\n` 被当成换行），测试因此莫名失败。
- 原因：命令文本经过工具层与 shell 两次转义处理，heredoc 里的反斜杠不保证按字面写入。
- 解决：含反斜杠的内容用 Edit / Write 工具写；脚本里需要路径转换时用 `pathToFileURL` 等函数而不是手写转义；写完用 `grep -n` 或 Read 核对实际落盘内容。
- 预防：测试里 UNC 键写成 `'\\server\share'`（运行时为 `\server\share`）并在用例名里不要出现反斜杠（`no-useless-escape`）。

### 临时目录判断要同时比较原始路径与 realpath

- 日期：2026-11-19
- 症状：只做字符串比较时，8.3 短文件名（`C:/Users/YONGJU~1/.../Temp`）与长名不一致，或经目录联接 / 符号链接指向临时目录内的路径，会漏判。
- 原因：同一目录在 Windows 上有多种路径形式。
- 解决：`WorkspaceService` 对 `tempDir`（构造时一次，`fs.realpathSync.native`）与目标路径（`fs/promises.realpath`）各取原始与 realpath 两种形式，任一命中即视为在临时目录下；realpath 失败（不存在等）回退原值。realpath 只读取，不改变文件系统。本机实测 `%TEMP%` 的短名与长名相同，其他机器上可能不同（未验证）。
- 预防：判断「是否在某目录之下」时不要只信字符串；测试用 `fs.symlinkSync(target, link, 'junction')`（无需管理员）构造联接。

### 枚举目录会更新该目录自身的最后访问时间

- 日期：2026-11-19
- 症状：（设计阶段实测，Windows 11 本机 NTFS）`fsutil behavior query disablelastaccess` 为 2（System Managed, ENABLED）时，列一次目录后该目录的 LastAccessTime 变化；子文件的访问时间不变（只有读取内容才变）。NTFS 只在与旧值相差超过约 1 小时时写入，所以短时间内重复测试看不出来。
- 原因：目录枚举本身就是对目录的「访问」，由文件系统更新元数据，与应用是否写文件无关。这违反「应用不得对文件系统产生任何影响」。
- 解决：koffi 枚举器（`scanner/enum/win32-enumerator.ts`）以 `FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES` + `FILE_FLAG_BACKUP_SEMANTICS` 打开目录，`SetFileInformationByHandle(FileBasicInfo)` 把 LastAccessTime 设为 -1（文档化的「此句柄后续操作不更新访问时间」），再在同一句柄上 `GetFileInformationByHandleEx(FileFullDirectoryInfo)` 枚举；目录自身的修改时间用 `GetFileAttributesExW` 取得（不打开句柄）。拿不到写属性权限（系统盘根目录、只读共享）时回退为只读句柄（访问时间不受保护，按共享 / 盘符记一次日志，见上文「系统盘根目录不能以 `FILE_WRITE_ATTRIBUTES` 打开」）。单元测试 `does not update the directory's last access time` 用「先把 atime 设到很久以前，再枚举」验证（避开 1 小时的写入阈值）。网络共享上是否生效未验证。
- 2026-11-19 起不再使用：需求方决定读目录只用只读句柄，原因是写属性访问会在服务器上留下审核记录；变化检测不依赖访问时间。原则同时改为「读取时由系统自动更新的元数据（如访问时间）不在此列」。
- 预防（历史）：判断「是否影响文件系统」时连元数据（访问时间）一起看；测访问时间先把 atime 调到 1 小时以前，否则 NTFS 的写入阈值会让测试假通过。node:fs 回退枚举器（koffi 不可用时）无法保护访问时间。

### Win32 错误码：不认识的码不能一律当作「位置断开」

- 日期：2026-11-19
- 症状：（最终审查发现）koffi 枚举器把除 2 / 3 / 5 / 267 以外的所有 Win32 错误码都映射为 `FS_UNAVAILABLE`，调度器据此把整个共享 / 卷判为断开、停止访问其他目录；一个目录上的偶发错误（如 32 共享冲突、1117 I/O 设备错误）就能让整卷「断开」。同时，以写属性打开只对 5 / 19 退回只读，部分 NAS 返回的其他拒绝码（如 50 ERROR_NOT_SUPPORTED）直接失败；87 在任何一批都被当作「不是目录」。
- 原因：默认分支兜底过宽；87（ERROR_INVALID_PARAMETER）只在「打开的是文件」时实测过，其他原因（不支持该信息类等）也会返回 87。
- 解决：`scanner/enum/win32-enumerator.ts` 的 `UNAVAILABLE_ERRORS` 白名单（网络路径 / 连接 / 主机不可达、设备未就绪 / 未连接；每个码按 Microsoft Learn「System Error Codes (0-499) / (1000-1299) / (1700-3999)」核对含义），其余为 `UNKNOWN`（只记该目录 unreachable）；写属性打开除 2 / 3 与白名单外都退回只读；87 只在第一批且 `GetFileAttributesExW` 确认不是目录时才是 `FS_NOT_A_DIRECTORY`。测试用替换 `GetLastError` 的假 kernel32 注入任意错误码（`win32-enumerator.test.ts` 的 `forcedErrors`）。
- 预防：错误分类按「确定知道含义的才归类，其余归通用错误」写；会影响大范围状态（断开、删除子树）的分类尤其要保守。不凭记忆写错误码的含义，查官方列表。

### 目录修改时间只反映直接子项的增删改名（缓存「比较修改时间」的盲区）

- 日期：2026-11-19
- 症状：缓存策略的近 / 远层与后台队列只比较目录修改时间、变了才完整读取（设计 8.2）；以下变化不会让该目录的修改时间改变，缓存会保留过时信息。
- 原因（本机 NTFS 实测，node `fs.statSync().mtimeMs`）：在目录中新建、改名、删除直接子项 → 目录修改时间变化；**修改直接子文件的内容（大小 / 时间变化）→ 不变**；**在子目录中新建文件 → 上级目录不变**（变化不向上传递）。另外：工具可以把时间改回去（robocopy `/DCOPY:T`、rsync `-t`、解压、备份还原；本机用 `fs.utimesSync` 写回原值，复原后的值与原值相差不到 1ms 但不完全相等——node 只能按毫秒设置，按 FILETIME 原样复制时间的工具未实测）；FAT32 的修改时间精度为 2 秒，同一时间窗内的两次变化分辨不出（未实测）。
- 解决：设计上接受（设计 8.5）：只有关注点每次完整读取（文件大小 / 时间的变化也能发现），其余目录只按修改时间；缓存不设过期，这类过时信息保留到该目录成为关注点、被 P0 确认（展开且查询失效或未缓存、滚回视口、切回窗口）或 F5 为止（从搜索结果定位失败时的确认也是 P0，设计 8.3）。
- 预防：不要把「目录修改时间没变」当作「子树没变」或「子文件没变」；需要发现文件内容变化的场景（关注点）必须完整读取。测试修改时间相关的行为时，用「新建 / 删除直接子项」触发变化，不要用改写已有文件的内容。

### 缓存从父目录列表中「推断删除」子目录后，修改时间比较发现不了它其实还在（上级改名后改回）

- 日期：2026-11-19
- 症状：e2e `principle: renaming an ancestor of an expanded directory succeeds` 偶发失败（全量中约 1/5）：改名全部成功，但改回后树中 `A` 显示「没有项目」，`c.txt` 一直不出现；搜索也找不到 `A\B` 之下的整棵子树；F5、选中 `A` 或折叠再展开后恢复。默认设置下同样存在（每次「改走并改回」约 0.2% 以上），不会自愈。
- 原因：`A` 改名期间扫描进程读取 `A\B` 得到 `FS_NOT_FOUND`，`Cache.removeMissing` 把 `B` 从 `A` 的缓存列表中删除，但 `A` 的 `dir_mtime` 不变。`A` 在 50–80ms 前刚确认过（fresh），渲染端重新列出时直接用缓存、不排 P0。`A` 改回后它自身在磁盘上的修改时间根本没变（改名 `A` 只改变其父目录的修改时间），之后每次「比较修改时间」的确认都判为未变，`A` 的列表永远缺 `B`。诊断：扫描进程插桩日志 + 定向复现（在 `A` 刚确认之后立即改名），见 `devDoc/2026-11-19-11-dir-id.md`「`FS_NOT_FOUND`：重新读取父目录」。
- 解决：`FS_NOT_FOUND` 时除了 `removeMissing`（保留：父目录 fresh 时树与搜索立即不显示已删除的目录），再对父目录排一次 `requestP0(parent, { force: true })`，由真实枚举决定父目录的列表；`removeMissing` 删除了父目录列表中的该项时把父目录的 `dir_mtime` 置为 NULL，P0 没有执行时下一次确认也完整读取。该目录行保留为 `not-found` / `FS_NOT_FOUND`（带确认时刻）：父目录的真实列表仍列出它、它却持续报「不存在」时，再次出错不再强制父目录（否则 10 分钟内父目录完整读取 1171 次，测试实测），按远层间隔重试。
- 预防：缓存中凡是「按推断」改动了某目录的列表（不是来自该目录自身的枚举），都要让该目录的修改时间比较失效或排一次真实读取——修改时间只证明「磁盘上没有变」，不证明「缓存与磁盘一致」。由出错的子项去强制父目录时，要像 `FS_NOT_A_DIRECTORY` 一样设限，并写「父目录持续列出它」的循环上限测试。

### 在仓库根目录 `npx electron-vite build` 报 `Cannot find module 'electron/package.json'`

- 日期：2026-11-20
- 症状：在仓库根目录执行 `npx electron-vite build`，错误栈指向 `%LOCALAPPDATA%\npm-cache\_npx\...\electron-vite`。
- 原因：electron-vite 只是 `apps/desktop` 的依赖，根目录的 `node_modules/.bin` 中没有它，npx 便从 npm 下载了一份到 npx 缓存中运行，那里找不到 electron。
- 解决：`pnpm --filter @pch/desktop exec electron-vite build`（只构建、不做类型检查；完整构建用 `pnpm build`）。
- 预防：工作区包的命令用 `pnpm --filter <包> exec`，不在根目录用 npx 调用只属于某个包的工具（npx 会静默下载，也绕过了锁定的版本）。

### Windows PowerShell 5.1 的 `Start-Process` 没有 `-LiteralPath`；`-FilePath` 会做通配符解析而打开别的文件

- 日期：2026-11-20
- 症状：（M2 先行验证 S4）`Start-Process -LiteralPath $env:PCH_TARGET -Verb …` 报 `A parameter cannot be found that matches parameter name 'LiteralPath'`。改用 `-FilePath` 后，同目录有 `見積[1] 案.xlsx` 与 `見積1 案.xlsx` 时，传前者打开的是后者。
- 原因：5.1 的 `Start-Process` 参数集只有 `FilePath`（`(Get-Command Start-Process).ParameterSets` 可确认），且 `-FilePath` 按 PowerShell 路径规则解析，`[1]` 被当作通配符字符类。
- 解决：`$si = New-Object System.Diagnostics.ProcessStartInfo; $si.FileName = $env:PCH_TARGET; $si.Verb = $env:PCH_VERB; $si.UseShellExecute = $true; [void][System.Diagnostics.Process]::Start($si)`（无通配符语义，已验证打开正确的文件）；或 `-FilePath ([WildcardPattern]::Escape($env:PCH_TARGET))`。
- 预防：PowerShell 中处理用户文件路径时一律避免依赖通配符解析的参数；文件名含 `[` `]` 的用例要进测试。

### Office 的 `OpenAsReadOnly` verb 实际以编辑模式打开；`Open` verb 可能弹出「选择应用」对话框

- 日期：2026-11-20
- 症状：（M2 先行验证 S4，本机即点即用版 Office16）`Start-Process -Verb OpenAsReadOnly` 打开 `.xlsx` / `.docx` 后标题没有「只读」，同目录出现所有者文件 `~$…`；`-Verb Open`（或不带 verb、资源管理器双击、`shell.openPath`）弹出系统的「选择一个应用以打开此 .xlsx 文件」对话框而不是直接启动 Excel / Word。
- 原因：注册表中 `OpenAsReadOnly` 的命令是 `EXCEL.EXE /h "%1"` / `WINWORD.EXE /h /n "%1"`，实测以编辑模式打开（`/h` 的语义未深究；Excel 的只读开关是 `/r`，实测有效；Word 没有对应开关）。「选择应用」对话框：本机 `.xlsx` / `.docx` 下没有 `UserChoice`（只有 `OpenWithList` / `OpenWithProgids`）——推测是系统因此要求用户选择默认应用，未深究。
- 解决：判断打开模式用「是否出现 `~$` 所有者文件」（对照实验：编辑模式出现、只读 / 保护视图不出现）。只读需求改用 `ViewProtected`（保护视图，实测只读）；`New` verb 是「以该文件为蓝本新建」（实测两种文件都成立）。
- 预防：verb 的名字不等于行为，Office 相关的功能要在真机上按「标题 + `~$` 文件」验证；`UserChoiceLatest` 在本机存在（`.html` / `.pdf` / `.txt` 等），`.pdf` 的 `UserChoice`（`ChromePDF`）与 `UserChoiceLatest\ProgId`（`MSEdgePDF`）不一致时，系统实际采用 `UserChoice`（`AssocQueryString(ASSOCSTR_PROGID)` 确认）。

### PowerShell 5.1 执行无 BOM 的 UTF-8 `.ps1`：中文注释吞掉下一行，参数变成 `$null`

- 日期：2026-11-20
- 症状：脚本第一行是中文注释、第二行是 `param(...)`，执行时报 `Cannot bind argument to parameter 'Path' because it is null`，错误行号比文件里少一行。
- 原因：Windows PowerShell 5.1 按系统 ANSI 代码页（cp932）读取没有 BOM 的脚本，UTF-8 的中文字节被误解码，注释行吞掉了换行，`param` 行成了注释的一部分。
- 解决：`.ps1` 只写 ASCII（注释用英文），或保存为带 BOM 的 UTF-8；短命令直接用 `-Command` 传入。
- 预防：由工具（Bash heredoc、Write）生成的 `.ps1` 默认无 BOM，写成 ASCII。

### Windows PowerShell 5.1：`ConvertFrom-Json` 对 JSON 数组整体输出一个对象，`@()` 不会展开

- 日期：2026-11-20
- 症状：（M2 Task 9）启动脚本用 `$list = @(ConvertFrom-Json -InputObject $env:PCH_ARGS)` 再 `ForEach-Object` 给每个参数加引号，结果参数没有被加引号，Excel 把路径在空格处截断（弹出「找不到 …\sample」），而同样逻辑在 `.ps1` 文件中用 `@('/r', '…')` 数组是对的。
- 原因：5.1 的 `ConvertFrom-Json` 把 JSON 数组作为**一个** `Object[]` 写出，`@()` 只包一层，`$list` 变成「只有一个元素（数组）」，`ForEach-Object` 的 `$_` 是整个数组。
- 解决：`foreach ($x in (ConvertFrom-Json …)) { $list += [string]$x }`（`foreach` 会遍历数组本身，5.1 / 7 都适用）。
- 预防：在 PowerShell 中处理 JSON 数组一律用 `foreach` 遍历；脚本逻辑要在真实 PowerShell 上跑一遍（见 `detect-script.test.ts`），不要只看字符串。另：Excel 把**加了引号的开关**（`"/r"`）当作文件名，开关不加引号、路径加引号。
- 再次踩到（2026-11-21，M3 Task 9，资源管理器多标签恢复脚本 `EXPLORER_RESTORE_SCRIPT`）：`$tabs = @(ConvertFrom-Json $env:PCH_TABS)` 后 `$tabs.Count` 为 1、`[string]$tabs[0]` 是用空格连起来的全部路径，资源管理器打不开这个「路径」、回落打开「文档」；单元测试（假 PowerShell）发现不了，实机才发现。另一种写法：`@(ConvertFrom-Json $json | ForEach-Object { $_ })`（管道把 `$_` 输出的数组展开，2026-11-22 实测：两元素数组得到 Count 2，单元素数组得到 Count 1）。凡是经环境变量传 JSON 数组的脚本都按此处理。

### `execFile` 的 `timeout`：子进程已以 0 退出、孙进程持有管道时，超时被当作成功

- 日期：2026-11-20
- 症状（M2 Task 9 审查与最终修复波核对）：PowerShell 脚本用 `ProcessStartInfo`（`UseShellExecute = $false`）启动 Excel 后立即退出，`execFile` 却要等到 15 秒超时才回调，而且回调的 `error` 为 null（启动被当作成功）。复现：`UseShellExecute=$false` 启动睡 6 秒的 `wscript.exe`，`timeout: 2000` → 2123 ms 回调，`error` 为 null。
- 原因：.NET Framework 在 `UseShellExecute = $false` 时以继承句柄创建进程，孙进程继承了 Node 给 powershell 建的 stdout / stderr 管道；`execFile` 等到管道关闭（`close`）才回调。超时时 Node 结束子进程并销毁流，但子进程早已以 0 退出，于是按「退出码 0、无信号」回调成功。
- 解决：启动外部程序的脚本一律 `UseShellExecute = $true`（经 ShellExecute，不继承管道）；`launcher/detect-script.test.ts` 有回归测试（孙进程睡 6 秒，脚本须在 3 秒内返回）。
- 预防：不要把 `execFile` 的超时当作失败的保证；从脚本启动长期运行的程序时确认不继承标准输入输出句柄。

### TS 模板字符串里内嵌的 PowerShell 脚本：正则 `\d` 变成 `d`，采集器静默返回空

- 日期：2026-11-21
- 症状（M3 Task 6）：`collectors/scripts.ts` 中以模板字符串定义的 Explorer / Office 脚本，用 `if ($s -match '^\d+$')` 过滤环境变量传入的 hwnd / pid，实机运行时所有 hwnd / pid 都被丢弃，采集器不报错、返回空数组；单元测试（假 `runPowerShell`）全部通过。
- 原因：JS 的模板字符串（未加标签）会处理反斜杠转义，`\d` 不是合法转义、按字面得到 `d`，PowerShell 收到的是 `'^d+$'`。同理 `\.`、`\s` 等都会丢掉反斜杠，`\n`、`\t` 变成换行 / 制表符。
- 解决：模板字符串里的 PowerShell / 正则反斜杠写成 `\\d`（`scripts.ts` 现为 `'^\\d+$'`）。需要大量反斜杠时可改用 `String.raw` 标签模板。
- 预防：内嵌脚本至少在真实 PowerShell 上跑一次（单元测试的假执行器看不到脚本文本被改了什么）；写完用 `node -e "console.log(require(...).SCRIPT)"` 之类打印实际字符串核对。另见「Bash 工具：命令中的反斜杠被吞」——这里的问题出在 JS 源码本身，与工具无关。

### PowerShell：UI Automation 的类型在程序集加载之前被解析（`Unable to find type [System.Windows.Automation.AutomationElement]`）

- 日期：2026-11-21（2026-11-22 复现核对）
- 症状（M3 Task 1 / Task 6）：脚本里用 `[System.Windows.Automation.AutomationElement]` 等类型字面量，而 `Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes` 写在同一个脚本块里，部分写法报 `TypeNotFound`。2026-11-22 实测：`& { param([System.Windows.Automation.AutomationElement]$e) … }` 在**外层没有先加载程序集**时报 `Unable to find type`；外层先 `Add-Type` 再进入该脚本块则正常。普通语句中（`-Command` 顶层、函数体、`try` 块内）在 `Add-Type` 之后使用类型字面量，本机 5.1 未复现问题。
- 原因：参数的类型约束、特性等在脚本块编译 / 绑定参数时解析，早于脚本块内 `Add-Type` 的执行；普通表达式中的类型字面量在运行到该语句时才解析。哪些位置属于前者不容易一眼看出。
- 解决：`Add-Type -AssemblyName …` 放在脚本的最外层、最前面；采集脚本 `EXPLORER_SCRIPT` 另以 `$AE = [type]::GetType('System.Windows.Automation.AutomationElement, UIAutomationTypes')` 取类型（运行时解析，与写法位置无关）。
- 预防：固定脚本不在 `param()` 中用需要 `Add-Type` 的类型；在真实 PowerShell 的 `-Command` 方式（与 `runPowerShell` 相同）下跑一遍。

### 多标签的资源管理器窗口：`WM_CLOSE` / 逐个 `Quit()` 关不掉，用 UI Automation 的 `CloseButton`

- 日期：2026-11-21
- 症状（M3 Task 1 / 6 / 9 的测试窗口清理）：对含 3 个以上标签的资源管理器窗口，连续 5 轮「对每个标签项 `Shell.Application` 的 `Quit()` + 对 hwnd 发 `WM_CLOSE`」后窗口仍在；另一个测试窗口则在几轮之后被关掉，两次结果不一致，原因未查清。
- 原因：未查清（推测 Windows 11 资源管理器的多标签窗口不按经典方式处理 `WM_CLOSE`）。
- 解决：UI Automation 找 `AutomationId = CloseButton` 并 `Invoke`，循环直到 `IsWindow(hwnd)` 为假（最多 10 轮，每轮间隔约 0.7 秒；参考 `.superpowers/sdd/2026-11-21-32-m3-desktop-snapshot-plan/spikes/explorer-closetabs.ps1`）。观察到的点击效果不一致：Task 1 一次点击关掉了整个窗口，Task 6 / 9 是每次点击关一个标签（2 个标签点 2 次、3 个标签点 3 次），所以必须循环到窗口消失。
- 预防：测试只按「启动前已有 hwnd」之差识别并关闭自己打开的窗口，`finally` 中确认窗口已消失；不要对需求方的资源管理器窗口发任何消息。

### Office 自动化：顶层窗口取不到对象；没有文档时没有 `EXCEL7` 等子窗口；弹着对话框时属性静默为 `$null`

- 日期：2026-11-21
- 症状（M3 Task 1 / Task 6）：① 对 `XLMAIN` / `OpusApp` / `PPTFrameClass` 顶层窗口 `AccessibleObjectFromWindow(OBJID_NATIVEOM)` 返回非零 HRESULT；② 修正为取子窗口后，Excel 开着但没有工作簿时采集器一直报 `busy`（审查判为 Critical：该类永远保留上一次结果）；③ Word 弹着 Copilot 介绍框 / 「另存为」时，`$doc.FullName` 不抛错而返回 `$null`。
- 原因：① Office 的 NativeOM 挂在文档窗口（子窗口：Excel `EXCEL7`、Word `_WwG`、PowerPoint `mdiClass`）上，取到的是 Window 对象，再 `.Application`；这也是逐进程取 Application 的办法（`GetActiveObject` 只拿到一个）。② 没有文档时根本没有这些子窗口，「找不到子窗口」不等于「忙」。③ 模态对话框期间 COM 调用被拒绝（`RPC_E_CALL_REJECTED 0x80010001`），PowerShell 的属性访问把它吞掉返回 `$null`。
- 解决：`OFFICE_SCRIPT`：没有子窗口 → 不算忙、看同 pid 的下一个顶层窗口；找到子窗口但取不到对象 / `FullName` 为空 → 输出 `{"error":"busy"}`（本轮失败、保留上一次结果）。Word 的 `Documents.Item` 要传 `[ref]`；用原生属性访问，不用 `InvokeMember`（`DISP_E_UNKNOWNNAME`）。
- 预防：每个进程只开一个文档、PowerPoint 的「另存为」等情形未实测（台账 `devDoc/2026-11-21-33-m3-ledger.md` Step 1）；改脚本时在真实 Office 上覆盖「无文档」「弹对话框」两种状态。

### VS Code 的 `storage.json`：打开窗口后才写、关闭窗口不写；最小化窗口的矩形在屏幕外

- 日期：2026-11-21
- 症状（M3 Task 1 / Task 7）：用 `%APPDATA%\Code\User\globalStorage\storage.json` 的 `windowsState.openedWindows` 判断「开着哪些文件夹」，关闭窗口后它仍列着已关闭的窗口；新开的窗口要过几秒才出现。另：最小化的 VS Code 窗口 `GetWindowRect` 为 (-21333, -21333, 158x26)。
- 原因：VS Code 在打开窗口后约 4–9 秒写一次「那一刻开着的窗口集合」，关闭窗口不触发写入（关闭后至少 30 秒不变），下一次打开窗口时才刷新。workspace 窗口的字段是 `workspaceIdentifier.configURIPath`（不是 `workspace.configPath`），`folder` 是 `file:///c%3A/...` 的 URI。全局 `state.vscdb` 中没有「最近打开」列表的键（本机版本）。最小化窗口被系统移到屏幕外（经典值 -32000，按显示缩放换算）。
- 解决：以可见 `Code.exe` 窗口的标题（`… - <根名> - Visual Studio Code`，workspace 为 `<名> (Workspace)`）为准，与 `storage.json` 各项的根名匹配，只输出匹配上的项；VS Code 类的采集防抖 10 秒（等写入）；矩形 x、y 均 ≤ -20000 时 bounds 退回该项的 `uiState`（`collectors/vscode.ts`）。
- 预防：`storage.json` 只读打开、读完即关；验证时 `Code.exe -n` 新开窗口会让 VS Code 自己改写需求方的 `storage.json`（台账 Step 3 的副作用登记），只读取已开着的窗口。标题的 `(Workspace)` 按英文界面写，其他界面语言、用户改过 `window.title` 时匹配不到（未验证）。

### 资源管理器 `Shell.Application`：CLSID 位置要加 `shell:`；新标签对象不能用 `ReferenceEquals` 识别

- 日期：2026-11-21
- 症状（M3 Task 1 / Task 9）：① `Navigate2('::{645FF040-…}')` 报 `Value does not fall within the expected range`；② 多标签恢复时按「点 `AddButton` 前已知的项之外的那一个」（`[object]::ReferenceEquals`）找新标签，选错标签、窗口多开；③ 对已处于主文件夹页的新标签再 `Navigate2('shell:::{F874310E-…}')` 也报同一错误。
- 原因：① 采集到的特殊位置路径是 `::{CLSID}`，`Navigate2` 只接受 `shell:::{CLSID}` 或 `shell:RecycleBinFolder` 之类的 shell 名。② 每次枚举 `Windows()` 得到的 COM 包装对象都是新的，引用比较永远不相等。③ 原因未查清。
- 解决：恢复时 CLSID 加 `shell:` 前缀（`explorer.exe shell:::{CLSID}` 开新窗口同理）；新标签按初始路径 `::{F874310E-B6B7-47DC-BC84-B9E6B38F5903}`（主文件夹页）取最后一个，退路取同 hwnd 的最后一项；当前路径已等于目标时跳过 `Navigate2`（`EXPLORER_RESTORE_SCRIPT`）。
- 预防：同一窗口的各标签在 `Windows()` 中各是一项、HWND 相同；UIA 的 `TabItem` 还包含主文件夹页内的「お気に入り」「最近使った」等子标签，按 `Shell.Application` 的项过滤。
- 再次踩到（2026-11-22，M3 合并前审查 I1）：`EXPLORER_RESTORE_SCRIPT` 只给**第一个**标签（`explorer.exe` 的参数）加了 `shell:`，第 2 个及以后的标签直接 `Navigate2('::{CLSID}')`，必定失败：窗口里留下一个停在主文件夹的空标签，其余标签被逐个开成独立窗口。改为每个 `Navigate2` 的目标都加前缀（与当前路径比较仍用原值），实机 `[folder-a, 此电脑, folder-b]` 恢复为 1 个窗口 3 个标签（台账 33「合并前修正波」）。预防：同一种转换（这里是 CLSID → `shell:`）在脚本中出现两处时，实机用例要覆盖「特殊位置不在第一个」的情况。
- 观察（2026-11-22）：脚本整体包在 `try { … } catch {}` 里、异常被吞掉时，`powershell.exe -Command` 的退出码仍为 1（stderr 为空）。`runPowerShell` 因此以拒绝返回（带已输出的 `stdout`），`restore.ts` 按已输出的 `OK` 行数续开——依赖的是 stdout 而不是退出码。原因推测为最后一条语句失败后 `$?` 为假，未查证。

### Claude Code 的 Bash 工具：heredoc 交给 Python 的反斜杠被减半

- 日期：2026-11-22
- 症状：用 `python - <<'EOF'`（引号 heredoc）批量改 TS 测试文件，Python 字符串中写四个反斜杠（期望文件中的 TS 源码为 `'C:\\a'`），结果文件中只有一个，`\a` 被 Python 当作 BEL 控制字符写进文件（路径变成 `C:` + BEL），测试与类型检查不一定报错。同一次会话中出现三次（连写本条目时也是）。
- 原因：未查明（引号 heredoc 本不该处理反斜杠；推测是工具传参时多做了一层转义还原）。
- 解决：含反斜杠的修改用 Edit 工具直接写；必须用脚本时，在脚本中用 `chr(92)` 拼反斜杠，或测试数据改用正斜杠路径；改完用 `grep -c $'\a' <文件>` 查控制字符、`grep -n 'C:\\[A-Za-z]'` 查单个反斜杠的路径。
- 预防：批量修改前先确认要写入的文本里有没有反斜杠；有就不用 heredoc 传给解释器。CLAUDE.md「长 heredoc 易解析失败，批量修改改用脚本文件」同理。

### Git Bash 调用 `wsl.exe`：参数与环境变量中的 `/usr/...` 被改写成 Windows 路径

- 日期：2026-11-22
- 症状：`wsl.exe -d Debian -u root -- /usr/sbin/sshd ...` 报 `/bin/bash: line 1: C:/Program Files/Git/usr/sbin/sshd: No such file or directory`；`READFILE=/opt/x node spike.mjs` 在 node 里拿到的是 `C:/Program Files/Git/opt/x`。
- 原因：MSYS 在调用 Windows 程序时把形如 POSIX 绝对路径的参数和环境变量转换为 Windows 路径。
- 解决：参数用 `MSYS_NO_PATHCONV=1 wsl.exe ...`；环境变量用 `MSYS2_ENV_CONV_EXCL='*'`。或改用 PowerShell 调用。
- 预防：从 Git Bash 向 WSL / Linux 侧传路径时一律加上述变量（`scripts/wsl-sftp/README.md`）。

### `wsl.exe ... -- bash -c '...'`：命令先经 WSL 的 shell 再展开一次

- 日期：2026-11-22
- 症状：`wsl.exe -d AlmaLinux-9 -u root -- bash -c 'for p in $(pgrep sshd-session); do kill -CONT $p; done'` 报 `syntax error near unexpected token '1503'`，`$(...)` 在进入 `bash -c` 之前已被展开。
- 原因：`wsl.exe` 把 `--` 之后的参数拼成一行交给目标用户的默认 shell 执行，引号与 `$` 会被这一层再解析一次。
- 解决：把命令写进脚本文件，`wsl.exe -d <实例> -u root -- bash /mnt/c/.../script.sh`。
- 预防：含 `$`、引号或多条语句的命令一律用脚本文件。

### `pkill -f <模式>` 会匹配到执行它的 shell 自身

- 日期：2026-11-22
- 症状：`wsl.exe ... -- bash -c "pkill -STOP -f 'sshd.*pchuser'; ..."` 一直不返回。
- 原因：`bash -c` 的命令行里也含有字符串 `sshd.*pchuser`，被 `pkill -f` 匹配并冻结（SIGSTOP），后面的命令不再执行。
- 解决：按进程名精确匹配（`pgrep -x` / `pkill -u <用户> <进程名>`），或把模式写成不会匹配自身的形式（如 `'[s]shd.*pchuser'`）。
- 预防：在脚本中慎用 `pkill -f`，尤其是 `-STOP` / `-KILL`。

### `wsl.exe -d <实例> -u root -e <命令>`：PATH 不含 `/usr/local/sbin`

- 日期：2026-11-23
- 症状（M4 Task 14a）：`wsl.exe -d Debian -u root -e pch-scenario all quiet` 找不到命令（`scripts/wsl-sftp/README.md` 中经默认 shell 的写法 `wsl -d Debian -u root -- pch-scenario …` 照常可用）。
- 原因：`-e` 不经 WSL 的默认 shell 直接执行，得到的 PATH 不含 `/usr/local/sbin`（为什么经 shell 时含有，推测是 shell 的初始化补上的，未核实）。
- 解决：`-e` 时用绝对路径（`/usr/local/sbin/pch-scenario`）。`-e` 的好处是参数不再经 shell 二次解析（见上一条），测试中从 Node `spawn('wsl.exe', ['-d', …, '-u', 'root', '-e', …])` 更可靠。
- 预防：经 `-e` 执行的命令一律写绝对路径。

### 从 Claude Code 的工具调用中运行 `scripts/wsl-sftp/start-sshd.ps1`：sshd 在调用结束后不存活

- 日期：2026-11-23（M5 Task 14 发现；Task 17 打包验证直接用后台任务方式启动 Ubuntu 的 sshd，可用，未再试脚本）
- 症状：在代理（Claude Code 的 Bash / PowerShell 工具）里执行 `powershell -File scripts/wsl-sftp/start-sshd.ps1`，输出「Ubuntu -> 127.0.0.1:2201」等，但工具调用结束后端口没有监听，`wsl.test.ts` 的 19 条全部以 `FS_UNAVAILABLE` 失败。在需求方的交互式终端中运行同一脚本正常。
- 原因（推测，未核实）：脚本用 `Start-Process wsl.exe … sshd -D` 以前台方式运行 sshd，sshd 的寿命绑定在这个 `wsl.exe` 上；工具调用结束时其启动的进程（含 `Start-Process` 派生的 `wsl.exe`）随之被结束，sshd 也就停止。
- 解决：在代理中用**后台任务**（工具的 `run_in_background`）直接运行 `wsl.exe -d <实例> -u root -- bash -c "mkdir -p /run/sshd && exec /usr/sbin/sshd -D -e -p <端口> -o PasswordAuthentication=yes -o KbdInteractiveAuthentication=yes -o PermitRootLogin=yes"`（与脚本中的命令相同），后台任务存续期间 sshd 一直监听；结束后 `wsl --terminate <实例>`。
- 预防：代理里需要长时间存活的服务一律用后台任务启动，并在使用前确认端口在监听（`Test-NetConnection 127.0.0.1 -Port <端口>` 或 `ss -ltn`）；不要依赖 `Start-Process` 派生的进程。
