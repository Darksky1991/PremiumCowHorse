import { describe, expect, it } from 'vitest'
import { parseProbeOutput, probeCommand, SFTP_SERVER_CANDIDATES } from './server-probe'

describe('probeCommand', () => {
  it('按序检查 4 个候选路径，并检查能否看到 PID 1', () => {
    expect(SFTP_SERVER_CANDIDATES).toEqual([
      '/usr/libexec/openssh/sftp-server',
      '/usr/lib/openssh/sftp-server',
      '/usr/libexec/ssh/sftp-server',
      '/usr/lib/ssh/sftp-server'
    ])
    expect(probeCommand()).toBe(
      'for p in /usr/libexec/openssh/sftp-server /usr/lib/openssh/sftp-server ' +
        '/usr/libexec/ssh/sftp-server /usr/lib/ssh/sftp-server; ' +
        'do [ -x "$p" ] && { echo "SFTP:$p"; break; }; done; ' +
        'ps -o pid= -p 1 >/dev/null 2>&1 && echo PS:ok || echo PS:hidden'
    )
  })
})

describe('parseProbeOutput', () => {
  it('找到 sftp-server 且能看到进程表', () => {
    expect(parseProbeOutput('SFTP:/usr/lib/openssh/sftp-server\nPS:ok\n')).toEqual({
      sftpServerPath: '/usr/lib/openssh/sftp-server',
      processListVisible: true
    })
  })

  it('只有 PS:hidden → 没有路径、看不到进程表', () => {
    expect(parseProbeOutput('PS:hidden\n')).toEqual({
      sftpServerPath: null,
      processListVisible: false
    })
  })

  it('容忍 CRLF 与登录脚本的杂音；不合规的路径不采用', () => {
    expect(parseProbeOutput('welcome\r\nSFTP:/usr/libexec/ssh/sftp-server\r\nPS:ok\r\n')).toEqual({
      sftpServerPath: '/usr/libexec/ssh/sftp-server',
      processListVisible: true
    })
    expect(parseProbeOutput('SFTP:/bin/x; rm -rf /\nPS:ok')).toEqual({
      sftpServerPath: null,
      processListVisible: true
    })
    expect(parseProbeOutput('')).toEqual({ sftpServerPath: null, processListVisible: false })
  })
})
