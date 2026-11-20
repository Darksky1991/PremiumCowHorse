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
