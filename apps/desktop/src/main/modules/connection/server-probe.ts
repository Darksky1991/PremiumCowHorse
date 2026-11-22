import { SFTP_SERVER_PATH_PATTERN } from '@pch/shared'

/**
 * sftp-server 的候选位置（设计 5.4，先行试验在 4 个发行版确认），按序取第一个可执行的：
 * RHEL 系、Debian / Ubuntu、openSUSE Leap 16、其他。
 */
export const SFTP_SERVER_CANDIDATES: readonly string[] = [
  '/usr/libexec/openssh/sftp-server',
  '/usr/lib/openssh/sftp-server',
  '/usr/libexec/ssh/sftp-server',
  '/usr/lib/ssh/sftp-server'
]

/**
 * 每次建立连接后以登录用户执行一次（不经 sudo，不留 sudo 日志）：
 * 找 sftp-server，并确认能在进程表中看到 PID 1（看不到 = /proc 以 hidepid 挂载，无法判定 sudo 成功）。
 */
export function probeCommand(): string {
  return (
    `for p in ${SFTP_SERVER_CANDIDATES.join(' ')}; do [ -x "$p" ] && { echo "SFTP:$p"; break; }; done; ` +
    'ps -o pid= -p 1 >/dev/null 2>&1 && echo PS:ok || echo PS:hidden'
  )
}

export interface ProbeResult {
  sftpServerPath: string | null
  processListVisible: boolean
}

/** 解析探测输出；登录脚本的杂音忽略，不合规的路径（会进入远端命令行）不采用 */
export function parseProbeOutput(stdout: string): ProbeResult {
  let sftpServerPath: string | null = null
  let processListVisible = false
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (sftpServerPath === null && line.startsWith('SFTP:')) {
      const path = line.slice('SFTP:'.length)
      if (SFTP_SERVER_PATH_PATTERN.test(path)) sftpServerPath = path
    } else if (line === 'PS:ok') {
      processListVisible = true
    }
  }
  return { sftpServerPath, processListVisible }
}
