// SFTP + sudo 切换试验（用完即弃）
// node spike.mjs <port> <case> [args...]
import { Client } from 'ssh2'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { SFTP } = require('ssh2/lib/protocol/SFTP.js')

const [port, testCase, ...args] = process.argv.slice(2)
const SFTP_PATHS = [
  '/usr/libexec/openssh/sftp-server',
  '/usr/lib/openssh/sftp-server',
  '/usr/libexec/ssh/sftp-server',
  '/usr/lib/ssh/sftp-server'
]
const MARK = 'PCHSTART'
const MARK_CMD = "printf '\\120CHSTART\\n'" // 回显的命令行里没有 PCHSTART 字样

function connect(user, password) {
  return new Promise((res, rej) => {
    const c = new Client()
    c.on('ready', () => res(c)).on('error', rej)
    c.connect({
      host: '127.0.0.1',
      port: Number(port),
      username: user,
      password,
      keepaliveInterval: 30_000,
      readyTimeout: 10_000,
      tryKeyboard: true
    })
    c.on('keyboard-interactive', (_n, _i, _l, prompts, finish) =>
      finish(prompts.map(() => password))
    )
  })
}
const execOut = (c, cmd) =>
  new Promise((res, rej) =>
    c.exec(cmd, (e, s) => {
      if (e) return rej(e)
      let out = '',
        err = ''
      s.on('data', (d) => (out += d)).stderr.on('data', (d) => (err += d))
      s.on('close', (code) => res({ code, out, err }))
    })
  )

/** 把任意 duplex 通道包成 ssh2 的 SFTP 客户端（内部 API） */
function sftpOverStream(c, stream, firstData) {
  const fakeClient = {
    _protocol: {
      _remoteIdentRaw: c._protocol._remoteIdentRaw,
      channelData: (_id, d) => stream.write(d),
      channelClose: () => stream.end()
    }
  }
  const chanInfo = {
    type: 'session',
    incoming: { id: 0, window: 2 ** 31, packetSize: 32768, state: 'open' },
    outgoing: { id: 0, window: Number.MAX_SAFE_INTEGER, packetSize: 32768, state: 'open' }
  }
  const sftp = new SFTP(fakeClient, chanInfo, {})
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('sftp init timeout')), 8000)
    sftp.once('ready', () => {
      clearTimeout(t)
      res(sftp)
    })
    sftp.once('error', (e) => {
      clearTimeout(t)
      rej(e)
    })
    stream.on('data', (d) => sftp.push(d))
    stream.on('end', () => sftp.push(null))
    sftp._init()
    if (firstData?.length) sftp.push(firstData)
  })
}

const readdir = (sftp, p) =>
  new Promise((res) =>
    sftp.readdir(p, (e, list) =>
      res(e ? `ERR ${e.code ?? ''} ${e.message}` : list.map((x) => x.longname).join('\n    '))
    )
  )
const tryWrite = (sftp, p) =>
  new Promise((res) =>
    sftp.open(p, 'w', (e, h) => res(e ? `write refused: ${e.message}` : 'WRITE SUCCEEDED (bad)'))
  )

/**
 * 经 sudo su - target 开 SFTP。mode: nopty | pty
 * 步骤：等 sudo 的提示 → 喂密码 → 写「printf 标记; exec sftp-server -R」→ 跳过标记前的数据
 */
async function sudoSftp(c, { target, sudoPass, mode, sftpPath, sendCmdEarly }) {
  const t0 = Date.now()
  const su = target === 'root' ? 'su -' : `su - ${target}`
  const cmd =
    mode === 'pty'
      ? `printf 'PCHPID:%s\\n' $$; exec sudo -k -p 'PCHPW:' ${su}`
      : mode === 'v'
        ? `sudo -k -S -p 'PCHPW:' -v && printf '\\120CHOK\\n' >&2 && sudo -n ${su}`
        : mode === 'ps'
          ? `printf 'PCHPID:%s\\n' $$ >&2; exec sudo -k -S -p 'PCHPW:' ${su}`
          : `sudo -k -S -p 'PCHPW:' ${su}`
  let sudoPid = 0
  // 认证成功的判定：sudo（sudoPid）之下出现 su 进程（PAM 认证在 sudo 进程内完成，成功后才 fork）
  const suStarted = async () => {
    const { out } = await execOut(c, 'ps -eo pid=,ppid=,comm=')
    const rows = out
      .trim()
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
    const kids = new Set([String(sudoPid)])
    let grew = true
    while (grew) {
      grew = false
      for (const [pid, ppid] of rows)
        if (kids.has(ppid) && !kids.has(pid)) {
          kids.add(pid)
          grew = true
        }
    }
    return rows.some(([pid, , comm]) => kids.has(pid) && pid !== String(sudoPid) && comm === 'su')
  }
  const stream = await new Promise((res, rej) =>
    c.exec(cmd, mode === 'pty' ? { pty: { term: 'dumb', modes: {} } } : {}, (e, s) =>
      e ? rej(e) : res(s)
    )
  )
  const log = []
  let buf = Buffer.alloc(0)
  let stage = 'wait-prompt'
  let prompts = 0
  return await new Promise((res, rej) => {
    const timer = setTimeout(() => {
      cleanup()
      rej(new Error(`timeout at stage=${stage}; seen=${JSON.stringify(log.join('').slice(-400))}`))
    }, 15000)
    const cleanup = () => {
      clearTimeout(timer)
      stream.removeListener('data', onData)
      stream.stderr.removeListener('data', onErr)
    }
    const sendCmd = () => {
      // pty：先把终端切成透明模式（不回显、不转换换行、不处理控制字符）
      const pre =
        mode === 'pty' ? 'stty raw -echo -ixon -ixoff -isig -icanon -opost min 1 time 0; ' : ''
      stream.write(`${pre}${MARK_CMD}; exec ${sftpPath} -R\n`)
      stage = 'wait-mark'
    }
    const onPrompt = () => {
      prompts++
      if (prompts > 1) {
        cleanup()
        stream.close()
        return rej(
          new Error(
            `password rejected (prompt #${prompts}) after ${Date.now() - t0}ms; ${JSON.stringify(log.join('').slice(-200))}`
          )
        )
      }
      stream.write(sudoPass + '\n')
      if (mode === 'nopty') {
        if (sendCmdEarly) sendCmd()
        else {
          stage = 'wait-auth'
          setTimeout(
            () => {
              if (stage === 'wait-auth') sendCmd()
            },
            Number(process.env.AUTH_WAIT ?? 0)
          )
        }
      } else stage = 'wait-auth'
      if (mode === 'ps' || mode === 'pty') {
        const poll = async () => {
          if (stage !== 'wait-auth') return
          if (await suStarted().catch(() => false)) {
            if (stage === 'wait-auth') {
              log.push(`[auth ok ${Date.now() - t0}ms]`)
              sendCmd()
            }
          } else setTimeout(poll, 150)
        }
        setTimeout(poll, 100)
      }
    }
    const onErr = (d) => {
      const s = d.toString()
      log.push(`[err]${s}`)
      const m = /PCHPID:(\d+)/.exec(s)
      if (m) sudoPid = Number(m[1])
      if (mode === 'v' && s.includes('PCHOK')) {
        stage = 'auth-ok'
        return sendCmd()
      }
      if (/PCHPW:|[Pp]assword.*:\s*$/.test(s)) {
        if (mode === 'v') {
          prompts++
          if (prompts > 1) {
            cleanup()
            stream.close()
            return rej(new Error(`password rejected after ${Date.now() - t0}ms`))
          }
          stream.write(sudoPass + '\n')
          return
        }
        onPrompt()
      }
      if (
        mode === 'v' &&
        /password is required|a terminal is required|not allowed|may not run/i.test(s)
      ) {
        cleanup()
        stream.close()
        rej(new Error(`sudo -n refused: ${s.trim()}`))
      }
    }
    const onData = (d) => {
      log.push(d.toString('latin1'))
      if (mode === 'pty' && stage !== 'wait-mark') {
        // pty：stdout / stderr 合并在同一终端输出里
        const all = log.join('')
        const m = /PCHPID:(\d+)/.exec(all)
        if (m) sudoPid = Number(m[1])
        const n = (all.match(/PCHPW:/g) ?? []).length
        if (n > prompts) onPrompt()
        return
      }
      if (stage === 'wait-mark') {
        buf = Buffer.concat([buf, d])
        const i = buf.indexOf(MARK + (mode === 'pty' ? '' : '\n'))
        if (i >= 0) {
          let rest = buf.subarray(i + MARK.length)
          // 跳过标记后的换行（pty 下可能是 \r\n 或 \n）
          while (rest.length && (rest[0] === 0x0a || rest[0] === 0x0d)) rest = rest.subarray(1)
          const noise = buf.subarray(0, i).toString('latin1')
          cleanup()
          sftpOverStream(c, stream, rest).then(
            (sftp) => res({ sftp, ms: Date.now() - t0, noise }),
            rej
          )
        }
      }
    }
    stream.on('data', onData)
    stream.stderr.on('data', onErr)
  })
}

async function main() {
  const c = await connect(args[0] ?? 'pchuser', args[1] ?? 'Pch-pass1')
  try {
    if (testCase === 'plain') {
      const sftp = await new Promise((r, j) => c.sftp((e, s) => (e ? j(e) : r(s))))
      console.log('  home:', await readdir(sftp, '/home/pchuser'))
      console.log('  /opt:\n    ' + (await readdir(sftp, '/opt')))
      console.log('  /opt/app1:', await readdir(sftp, '/opt/app1'))
      const probe = await execOut(
        c,
        `for p in ${SFTP_PATHS.join(' ')}; do [ -x "$p" ] && echo "$p"; done; sudo -n -l 2>&1 | head -3`
      )
      console.log('  probe:', JSON.stringify(probe))
      return
    }
    if (testCase === 'sudo') {
      const [, , mode, target, sudoPass, early] = args
      const probe = await execOut(
        c,
        `for p in ${SFTP_PATHS.join(' ')}; do [ -x "$p" ] && { echo "$p"; break; }; done`
      )
      const sftpPath = probe.out.trim()
      const { sftp, ms, noise } = await sudoSftp(c, {
        target,
        sudoPass,
        mode,
        sftpPath,
        sendCmdEarly: early === 'early'
      })
      console.log(
        `  OK ${mode} as ${target} in ${ms}ms; noise=${JSON.stringify(noise.slice(-160))}`
      )
      if (process.env.READFILE) {
        const { createHash } = await import('node:crypto')
        const h = createHash('sha256')
        let n = 0
        await new Promise((r, j) =>
          sftp
            .createReadStream(process.env.READFILE)
            .on('data', (d) => {
              h.update(d)
              n += d.length
            })
            .on('end', r)
            .on('error', j)
        )
        const st = await new Promise((r, j) =>
          sftp.stat(process.env.READFILE, (e, s) => (e ? j(e) : r(s)))
        )
        console.log(`  read ${n} bytes (stat size ${st.size}) sha256=${h.digest('hex')}`)
      }
      const dir = target === 'root' ? '/root/secret' : '/opt/app1/log'
      console.log(`  ${dir}:\n    ` + (await readdir(sftp, dir)))
      console.log('  ' + (await tryWrite(sftp, `${dir}/pch-write-test`)))
      // 同一 SSH 连接上同时有普通 SFTP 通道
      const plain = await new Promise((r, j) => c.sftp((e, s) => (e ? j(e) : r(s))))
      console.log('  parallel plain sftp /opt/app1:', await readdir(plain, '/opt/app1'))
      return
    }
  } finally {
    c.end()
  }
}
main().catch((e) => {
  console.log('  FAIL', e.message)
  process.exit(1)
})
