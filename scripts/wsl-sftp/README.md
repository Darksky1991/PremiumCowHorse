# WSL 上的 SFTP / sudo 试验环境

M4（SFTP 只读，设计见 `devDoc/2026-11-22-37-m4-sftp-design.md`）的先行试验、实施中的真实环境测试与手动验证共用。只用于本机开发，不随应用分发。

## 实例

用 `wsl --install -d <名称> --no-launch` 安装（不经 Microsoft Store）。所有 WSL2 实例共用同一个网络，sshd 各用一个端口：

| 实例                       | 代表                    | sshd 端口 |
| -------------------------- | ----------------------- | --------- |
| `Ubuntu`（26.04，sudo-rs） | Ubuntu                  | 2201      |
| `Debian`（13）             | Debian                  | 2202      |
| `AlmaLinux-9`              | RHEL 9                  | 2203      |
| `openSUSE-Leap-16.1`       | SUSE（默认 `targetpw`） | 2204      |

## 配置（每个实例一次，以 root 执行）

```powershell
wsl -d Debian -u root -- bash /mnt/c/<仓库路径>/scripts/wsl-sftp/setup.sh
```

`setup.sh`：安装 openssh-server / sudo，建试验用户（`pchuser` / `Pch-pass1`、`app1` / `App1-pass1`、`app2`，root 密码 `Root-pass1`），建只有 app1 能读的 `/opt/app1/log` 与只有 root 能读的 `/root/secret`，安装场景切换命令 `pch-scenario`，并输出 sftp-server 位置、sudoers 默认设置与版本。这些是本机试验用的固定密码，不要在其他环境使用。

## sudoers 场景

```powershell
wsl -d Debian -u root -- pch-scenario <all|exact|requiretty|targetpw|exact-requiretty> [noisy|quiet]
```

- `all`：`pchuser ALL=(ALL) ALL`
- `exact`：只允许 `su - app1`、`su - root`、`su -`（现场常见的精确规则）
- `requiretty` / `exact-requiretty`：加 `Defaults:pchuser requiretty`（sudo-rs 不支持此项）
- `targetpw`：sudo 问目标用户（root）的密码
- `noisy`：app1 的 `.bash_profile` 向标准输出打印欢迎信息（检验协议不被污染）

## 启动 sshd

```powershell
powershell -File scripts/wsl-sftp/start-sshd.ps1
```

在 Git Bash 中直接调用 `wsl.exe` 时需加 `MSYS_NO_PATHCONV=1`，否则 `/usr/sbin/sshd` 等参数会被改写为 Windows 路径（`knowledge/windows-and-tooling.md`）。

## reference/

先行试验用过的脚本（用完即弃的质量，只作为实施时的参考，不在项目中运行；依赖 `ssh2`，需在临时目录 `npm install ssh2` 后运行）：

- `sudo-sftp-spike.mjs`：普通 SFTP、经 `sudo su - <目标>` 切换后在命令通道上走 SFTP（非终端 / 终端两种方式、进程表判定认证成功）
- `keepalive-drop.mjs`：保活检测静默断线
