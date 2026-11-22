import { Duplex, Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@pch/shared'
import type { ExecChannel } from './ssh-session'
import {
  classifySudoError,
  hasSuDescendant,
  NeedsTtyError,
  openIdentityChannel,
  pollCommand,
  PTY_PREPARE,
  redact,
  startCommand,
  sudoCommand,
  type SwitchDeps
} from './sudo-switch'

const SFTP_PATH = '/usr/lib/openssh/sftp-server'
const SUDO_PID = 4321
/** 假的 sftp-server 输出：含全部字节值（含 PCHSTART 的字节、\r、\n） */
const SFTP_BYTES = Buffer.concat([
  Buffer.from([0, 0, 0, 5, 2, 0, 0, 0, 3]),
  Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
  Buffer.from('PCHSTART\n')
])

/** 让 nextTick / 微任务排空（Readable 的 readable 事件在 nextTick 发出；假计时器不接管 nextTick） */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => process.nextTick(r))
}

class FakeChannel implements ExecChannel {
  readonly stream = new Duplex({
    read: () => undefined, // 数据由测试 push
    write(_chunk, _enc, cb) {
      cb()
    }
  })
  readonly stderr = new Readable({ read: () => undefined })
  readonly writes: string[] = []
  closed = false
  /** 剧本：按写入内容推进 */
  onWrite: ((data: string) => void) | null = null
  private closers: (() => void)[] = []

  write(data: string | Uint8Array): void {
    const s = typeof data === 'string' ? data : Buffer.from(data).toString('utf8')
    this.writes.push(s)
    this.onWrite?.(s)
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const cb of this.closers.splice(0)) queueMicrotask(cb)
  }
  onClose(cb: () => void): void {
    if (this.closed) queueMicrotask(cb)
    else this.closers.push(cb)
  }
  out(data: string | Buffer): void {
    this.stream.push(data)
  }
  err(data: string | Buffer): void {
    this.stderr.push(data)
  }
}

interface Harness {
  deps: SwitchDeps
  cmd: FakeChannel
  poll: FakeChannel
  commands: { command: string; pty: boolean }[]
  /** 轮询通道的 exec 由测试决定何时完成（默认立即） */
  releasePoll: () => void
}

function harness(over: Partial<SwitchDeps> = {}, opts: { holdPoll?: boolean } = {}): Harness {
  const cmd = new FakeChannel()
  const poll = new FakeChannel()
  const commands: { command: string; pty: boolean }[] = []
  let release: () => void = () => {}
  const pollReady = opts.holdPoll
    ? new Promise<void>((r) => {
        release = r
      })
    : Promise.resolve()
  const deps: SwitchDeps = {
    exec: async (command, o) => {
      commands.push({ command, pty: o.pty })
      if (command.startsWith('while :;')) {
        await pollReady
        return poll
      }
      return cmd
    },
    identity: 'app1',
    sftpServerPath: SFTP_PATH,
    password: 'Pch-pass1',
    mode: 'nopty',
    pollIntervalMs: 150,
    timeoutMs: 15_000,
    ...over
  }
  return { deps, cmd, poll, commands, releasePoll: () => release() }
}

/** ps -eo pid=,ppid=,comm= 的一帧（含 PCHEND） */
function psFrame(withSu: boolean): string {
  const rows = [
    '    1     0 systemd',
    '  500     1 sshd',
    '  600   500 bash',
    // 无关的 su（父进程不是 sudo）
    '  700   600 su',
    ` ${SUDO_PID}   500 sudo`,
    // sudo 1.9 的 use_pty：sudo → sudo（监视进程）→ su
    ` ${SUDO_PID + 1}  ${SUDO_PID} sudo`,
    '  800     1 Web Content'
  ]
  if (withSu) rows.push(` ${SUDO_PID + 2}  ${SUDO_PID + 1} su`)
  return rows.join('\n') + '\nPCHEND\n'
}

async function errorOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('expected rejection')
}

async function appErrorOf(p: Promise<unknown>): Promise<AppError> {
  const e = await errorOf(p)
  expect(e).toBeInstanceOf(AppError)
  return e as AppError
}

/** 让 Promise 的状态可同步观察 */
function track<T>(p: Promise<T>): { done: () => boolean; promise: Promise<T> } {
  let settled = false
  p.then(
    () => (settled = true),
    () => (settled = true)
  )
  return { done: () => settled, promise: p }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('命令字符串', () => {
  it('sudoCommand：密码不进命令行；root 为 su -', () => {
    expect(sudoCommand('app1')).toBe(
      "printf 'PCHPID:%s\\n' $$ >&2; exec env LC_ALL=C sudo -k -S -p 'PCHSUDOPROMPT' su - app1"
    )
    expect(sudoCommand('root')).toBe(
      "printf 'PCHPID:%s\\n' $$ >&2; exec env LC_ALL=C sudo -k -S -p 'PCHSUDOPROMPT' su -"
    )
  })

  it('startCommand：标记用八进制写，回显里没有 PCHSTART 字样', () => {
    const c = startCommand(SFTP_PATH)
    expect(c).toBe("printf '\\120CHSTART\\n'; exec /usr/lib/openssh/sftp-server -R\n")
    expect(c).not.toContain('PCHSTART')
  })

  it('不合规的身份 / 路径直接抛错（防注入的第二道防线）', () => {
    expect(() => sudoCommand('app1; id')).toThrow()
    expect(() => startCommand('/bin/sh; id')).toThrow()
  })

  it('pollCommand：间隔换算成服务器端 sleep 的秒数，PCHEND 分帧不变', () => {
    expect(pollCommand(150)).toBe(
      'while :; do ps -eo pid=,ppid=,comm=; echo PCHEND; sleep 0.15; done'
    )
    expect(pollCommand(1000)).toContain('sleep 1;')
    expect(pollCommand(1500)).toContain('sleep 1.5;')
    expect(pollCommand(0.2)).toContain('sleep 0.001;')
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e22]) {
      expect(() => pollCommand(bad)).toThrow()
    }
  })

  it('openIdentityChannel 用 deps.pollIntervalMs 生成轮询命令；不合规的间隔不执行任何命令', async () => {
    const h = harness({ pollIntervalMs: 300 })
    const p = track(openIdentityChannel(h.deps))
    await flush()
    expect(h.commands[1]).toEqual({ command: pollCommand(300), pty: false })
    h.cmd.close()
    await errorOf(p.promise)

    const h2 = harness({ pollIntervalMs: Number.NaN })
    expect((await appErrorOf(openIdentityChannel(h2.deps))).code).toBe('CONN_SUDO_FAILED')
    expect(h2.commands).toEqual([])
  })
})

describe('hasSuDescendant', () => {
  it('孙进程为 su → true', () => {
    expect(hasSuDescendant(psFrame(true), SUDO_PID)).toBe(true)
  })

  it('只有无关的 su（父进程不同）→ false', () => {
    expect(hasSuDescendant(psFrame(false), SUDO_PID)).toBe(false)
  })

  it('sudo 不 fork、直接 exec 成 su（sudoPid 自身的 comm 为 su）→ true', () => {
    expect(hasSuDescendant('    1     0 systemd\n 10 1 su\n 11 10 bash\n', 10)).toBe(true)
    // 父进程是 su 不算（只看 sudoPid 自身及其子孙）
    expect(hasSuDescendant(' 9 1 su\n 10 9 sudo\n', 10)).toBe(false)
  })

  it('comm 含空格的行、畸形行不影响判定', () => {
    expect(hasSuDescendant(' 10 1 sudo\n 11 10 Web Content\ngarbage\n', 10)).toBe(false)
    expect(hasSuDescendant(' 10 1 sudo\n 11 10 Web Content\n 12 11 su\n', 10)).toBe(true)
    expect(hasSuDescendant(' 10 1 sudo\n 11 10 sudo\n 12 11 su-rs\n', 10)).toBe(false)
  })
})

describe('classifySudoError / redact', () => {
  it('分类 sudo 的错误输出', () => {
    expect(
      classifySudoError(
        "Sorry, user pchuser is not allowed to execute '/usr/bin/su - app1' as root on h."
      )
    ).toBe('denied')
    expect(classifySudoError('pchuser is not in the sudoers file.')).toBe('denied')
    expect(classifySudoError('Sorry, user pchuser may not run sudo on h.')).toBe('denied')
    // sudo-rs 的拒绝措辞
    expect(classifySudoError("I'm sorry pchuser. I'm afraid I can't do that")).toBe('denied')
    expect(classifySudoError('sudo: sorry, you must have a tty to run sudo')).toBe('needs-tty')
    expect(classifySudoError('Sorry, try again.')).toBeNull()
    // 登录横幅里的泛泛之词不算
    expect(classifySudoError('Unauthorized access is not allowed.')).toBeNull()
  })

  it('redact 按字面替换所有出现，忽略空的秘密', () => {
    const pw = 'a\'b"c$d\\ e日本'
    expect(redact(`x${pw}y${pw}`, [pw])).toBe('x***y***')
    expect(redact('abc', [''])).toBe('abc')
    expect(redact('a.c abc', ['a.c'])).toBe('*** abc')
  })
})

describe('openIdentityChannel（非终端方式）', () => {
  it('提示 → 写密码 → 进程表出现 su → 写启动命令 → 跳过标记前的输出', async () => {
    const h = harness()
    h.cmd.onWrite = (s) => {
      if (s === startCommand(SFTP_PATH)) {
        h.cmd.out('Last login: Sat Nov 22 10:00:00 2026\nwelcome\n')
        h.cmd.out(Buffer.concat([Buffer.from('PCHSTART\n'), SFTP_BYTES]))
      }
    }
    const p = openIdentityChannel(h.deps)
    await flush()
    expect(h.commands).toEqual([
      { command: sudoCommand('app1'), pty: false },
      { command: pollCommand(150), pty: false }
    ])
    h.cmd.err(`PCHPID:${SUDO_PID}\n`)
    h.cmd.err('PCHSUDOPROMPT')
    await flush()
    expect(h.cmd.writes).toEqual(['Pch-pass1\n'])
    h.poll.out(psFrame(false))
    await flush()
    expect(h.cmd.writes).toHaveLength(1)
    h.poll.out(psFrame(true))
    const r = await p
    expect(r.channel).toBe(h.cmd)
    expect(r.mode).toBe('nopty')
    expect(r.firstData.equals(SFTP_BYTES)).toBe(true)
    expect(h.cmd.writes).toEqual(['Pch-pass1\n', startCommand(SFTP_PATH)])
    expect(h.poll.closed).toBe(true)
    expect(h.cmd.closed).toBe(false)
  })

  it('任意分片：PID 行、提示、进程表帧、标记都被拆开', async () => {
    const h = harness()
    let pushed: Promise<void> = Promise.resolve()
    h.cmd.onWrite = (s) => {
      if (s !== startCommand(SFTP_PATH)) return
      const all = Buffer.concat([
        Buffer.from('motd PCHSTAR\nPCH'),
        Buffer.from('START\n'),
        SFTP_BYTES
      ])
      // 逐字节推送：标记、换行与 sftp 字节全部分开到达
      pushed = (async () => {
        for (let i = 0; i < all.length; i++) {
          h.cmd.out(all.subarray(i, i + 1))
          if (i % 7 === 0) await flush()
        }
      })()
    }
    const p = openIdentityChannel(h.deps)
    await flush()
    for (const piece of ['PCHP', 'ID:', String(SUDO_PID).slice(0, 2)]) {
      h.cmd.err(piece)
      await flush()
    }
    h.cmd.err(String(SUDO_PID).slice(2) + '\n[sudo: PCHSU')
    await flush()
    expect(h.cmd.writes).toEqual([])
    h.cmd.err('DOPROMPT] Password: ')
    await flush()
    expect(h.cmd.writes).toEqual(['Pch-pass1\n'])
    const frame = psFrame(true)
    for (let i = 0; i < frame.length; i += 5) {
      h.poll.out(frame.slice(i, i + 5))
      await flush()
    }
    const r = await p
    // firstData 与之后经 data 事件到达的字节合起来恰为 sftp 字节，不丢不重
    const later: Buffer[] = []
    r.channel.stream.on('data', (d: Buffer) => later.push(d))
    await pushed
    await flush()
    expect(Buffer.concat([r.firstData, ...later]).equals(SFTP_BYTES)).toBe(true)
    expect(h.cmd.writes).toEqual(['Pch-pass1\n', startCommand(SFTP_PATH)])
  })

  it('交接：标记同一 chunk 之后的字节进 firstData，已缓冲与之后到达的字节交给调用方的 data 监听', async () => {
    const h = harness({ password: null })
    h.cmd.onWrite = (s) => {
      if (s !== startCommand(SFTP_PATH)) return
      // 同一 tick 内连续到达：标记 + A，随后 B
      h.cmd.out(Buffer.from('noise\nPCHSTART\nAAA'))
      h.cmd.out(Buffer.from('BBB'))
    }
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\n`)
    await flush()
    h.poll.out(psFrame(true))
    const r = await p
    h.cmd.out(Buffer.from('CCC'))
    // 调用方稍后才挂 data 监听：期间的数据不能丢
    await new Promise((resolve) => setTimeout(resolve, 5))
    h.cmd.out(Buffer.from('DDD'))
    const later: Buffer[] = []
    r.channel.stream.on('data', (d: Buffer) => later.push(d))
    await flush()
    expect(Buffer.concat([r.firstData, ...later]).toString()).toBe('AAABBBCCCDDD')
    expect(r.firstData.toString().startsWith('AAA')).toBe(true)
  })

  it('NOPASSWD：没有提示，进程表直接出现 su → 成功，未写密码', async () => {
    const h = harness()
    h.cmd.onWrite = (s) => {
      if (s === startCommand(SFTP_PATH)) h.cmd.out('PCHSTART\nX')
    }
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\n`)
    await flush()
    h.poll.out(psFrame(true))
    const r = await p
    expect(r.firstData.toString()).toBe('X')
    expect(h.cmd.writes).toEqual([startCommand(SFTP_PATH)])
  })

  it('PID 未知之前的进程表帧不作判定', async () => {
    const h = harness()
    const p = track(openIdentityChannel(h.deps))
    await flush()
    h.poll.out(psFrame(true))
    await flush()
    expect(h.cmd.writes).toEqual([])
    h.cmd.onWrite = (s) => {
      if (s === startCommand(SFTP_PATH)) h.cmd.out('PCHSTART\n')
    }
    h.cmd.err(`PCHPID:${SUDO_PID}\n`)
    await flush()
    expect(p.done()).toBe(false)
    h.poll.out(psFrame(true))
    await p.promise
    expect(h.cmd.writes).toEqual([startCommand(SFTP_PATH)])
  })

  it('密码错误：第二次提示 → CONN_SUDO_AUTH_FAILED，关闭，不再写任何东西', async () => {
    const h = harness()
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    h.cmd.err('Sorry, try again.\nPCHSUDOPROMPT')
    const e = await appErrorOf(p)
    expect(e.code).toBe('CONN_SUDO_AUTH_FAILED')
    expect(h.cmd.writes).toEqual(['Pch-pass1\n'])
    expect(h.cmd.closed).toBe(true)
    expect(h.poll.closed).toBe(true)
  })

  it('两次提示在同一 chunk 中到达：只算失败，不写密码', async () => {
    const h = harness()
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPTSorry, try again.\nPCHSUDOPROMPT`)
    const e = await appErrorOf(p)
    expect(e.code).toBe('CONN_SUDO_AUTH_FAILED')
    expect(h.cmd.writes).toEqual([])
  })

  it('password 为 null 遇提示 → CONN_SUDO_AUTH_FAILED，写入 0 次', async () => {
    const h = harness({ password: null })
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    const e = await appErrorOf(p)
    expect(e.code).toBe('CONN_SUDO_AUTH_FAILED')
    expect(h.cmd.writes).toEqual([])
    expect(h.cmd.closed).toBe(true)
    expect(h.poll.closed).toBe(true)
  })

  it('轮询通道打开之前不交出密码（否则无法判定成功）', async () => {
    const h = harness({}, { holdPoll: true })
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    expect(h.cmd.writes).toEqual([])
    h.releasePoll()
    await flush()
    expect(h.cmd.writes).toEqual(['Pch-pass1\n'])
    h.cmd.err('PCHSUDOPROMPT')
    expect((await appErrorOf(p)).code).toBe('CONN_SUDO_AUTH_FAILED')
  })

  it('sudoers 不允许 → CONN_SUDO_DENIED', async () => {
    const h = harness()
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    h.cmd.err("Sorry, user pchuser is not allowed to execute '/usr/bin/su - app1' as root on h.\n")
    const e = await appErrorOf(p)
    expect(e.code).toBe('CONN_SUDO_DENIED')
    expect(h.cmd.closed).toBe(true)
    expect(h.poll.closed).toBe(true)
  })

  it('sudo-rs 的拒绝措辞（跨 chunk）→ CONN_SUDO_DENIED', async () => {
    const h = harness()
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    h.cmd.err("I'm sorry pchuser. I'm afr")
    await flush()
    h.cmd.err("aid I can't do that\n")
    const e = await appErrorOf(p)
    expect(e.code).toBe('CONN_SUDO_DENIED')
  })

  it('requiretty → NeedsTtyError', async () => {
    const h = harness()
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nsudo: sorry, you must have a tty to run sudo\n`)
    const e = await errorOf(p)
    expect(e).toBeInstanceOf(NeedsTtyError)
    expect(h.cmd.closed).toBe(true)
    expect(h.poll.closed).toBe(true)
  })

  it('认证成功后、标记之前通道关闭（如 nologin）→ CONN_SUDO_FAILED', async () => {
    const h = harness()
    h.cmd.onWrite = (s) => {
      if (s === startCommand(SFTP_PATH)) {
        h.cmd.out('This account is currently not available.\n')
        h.cmd.close()
      }
    }
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\n`)
    await flush()
    h.poll.out(psFrame(true))
    const e = await appErrorOf(p)
    expect(e.code).toBe('CONN_SUDO_FAILED')
    expect(e.detail).toContain('not available')
  })

  it('没有提示也没有结论，通道关闭 → CONN_SUDO_FAILED', async () => {
    const h = harness()
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err('su: user app1 does not exist\n')
    h.cmd.close()
    const e = await appErrorOf(p)
    expect(e.code).toBe('CONN_SUDO_FAILED')
    expect(h.poll.closed).toBe(true)
  })

  it('交出密码后、判定前通道关闭（无法排除密码错误）→ CONN_SUDO_AUTH_FAILED', async () => {
    const h = harness()
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    h.cmd.err('sudo: 1 incorrect password attempt\n')
    h.cmd.close()
    const e = await appErrorOf(p)
    expect(e.code).toBe('CONN_SUDO_AUTH_FAILED')
    expect(h.cmd.writes).toEqual(['Pch-pass1\n'])
  })

  it('交出密码后 stderr 出现以 su: 开头的行（su 已在运行）再关闭 → CONN_SUDO_FAILED', async () => {
    const h = harness()
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    expect(h.cmd.writes).toEqual(['Pch-pass1\n'])
    // 行首 su: 被拆在两个 chunk 中
    h.cmd.err('s')
    await flush()
    h.cmd.err(
      'u: user app1 does not exist or the user entry does not contain all the required fields\n'
    )
    await flush()
    h.cmd.close()
    const e = await appErrorOf(p)
    expect(e.code).toBe('CONN_SUDO_FAILED')
    expect(h.cmd.writes).toEqual(['Pch-pass1\n'])
  })

  it('交出密码后 stdout 有输出（目标 shell 已在运行）再超时 → CONN_SUDO_FAILED，不写启动命令', async () => {
    vi.useFakeTimers()
    const h = harness()
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    h.cmd.out('welcome\n')
    await flush()
    const caught = errorOf(p)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(((await caught) as AppError).code).toBe('CONN_SUDO_FAILED')
    expect(h.cmd.writes).toEqual(['Pch-pass1\n'])
  })

  it('行中间的 su: 不算迹象：交出密码后关闭仍为 CONN_SUDO_AUTH_FAILED', async () => {
    const h = harness()
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    h.cmd.err('sudo: su: something\n')
    h.cmd.close()
    expect((await appErrorOf(p)).code).toBe('CONN_SUDO_AUTH_FAILED')
  })

  it('提示先于 PID 行到达：先不写密码，PID 到达后写一次', async () => {
    const h = harness()
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err('PCHSUDOPROMPT')
    await flush()
    expect(h.cmd.writes).toEqual([])
    h.cmd.err(`PCHPID:${SUDO_PID}\n`)
    await flush()
    expect(h.cmd.writes).toEqual(['Pch-pass1\n'])
    h.cmd.err('PCHSUDOPROMPT')
    expect((await appErrorOf(p)).code).toBe('CONN_SUDO_AUTH_FAILED')
    expect(h.cmd.writes).toEqual(['Pch-pass1\n'])
  })

  it('PID 始终未知：不写密码，超时为 CONN_SUDO_FAILED', async () => {
    vi.useFakeTimers()
    const h = harness()
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err('PCHSUDOPROMPT')
    await flush()
    const caught = errorOf(p)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(((await caught) as AppError).code).toBe('CONN_SUDO_FAILED')
    expect(h.cmd.writes).toEqual([])
  })

  it('15 秒无结论 → CONN_SUDO_FAILED，两个通道都关闭', async () => {
    vi.useFakeTimers()
    const h = harness()
    const p = track(openIdentityChannel(h.deps))
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\n`)
    await flush()
    h.poll.out(psFrame(false))
    await vi.advanceTimersByTimeAsync(14_999)
    expect(p.done()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const e = await appErrorOf(p.promise)
    expect(e.code).toBe('CONN_SUDO_FAILED')
    expect(h.cmd.closed).toBe(true)
    expect(h.poll.closed).toBe(true)
  })

  it('交出密码后超时 → CONN_SUDO_AUTH_FAILED', async () => {
    vi.useFakeTimers()
    const h = harness()
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    const caught = errorOf(p)
    await vi.advanceTimersByTimeAsync(15_000)
    const e = (await caught) as AppError
    expect(e.code).toBe('CONN_SUDO_AUTH_FAILED')
  })

  it('认证成功后等不到标记也超时 → CONN_SUDO_FAILED', async () => {
    vi.useFakeTimers()
    const h = harness({ timeoutMs: 1000 })
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    h.poll.out(psFrame(true))
    await flush()
    expect(h.cmd.writes).toEqual(['Pch-pass1\n', startCommand(SFTP_PATH)])
    const caught = errorOf(p)
    await vi.advanceTimersByTimeAsync(1000)
    expect(((await caught) as AppError).code).toBe('CONN_SUDO_FAILED')
  })

  it('轮询通道意外关闭 → 失败并关闭命令通道', async () => {
    const h = harness()
    const p = openIdentityChannel(h.deps)
    await flush()
    h.poll.close()
    const e = await appErrorOf(p)
    expect(e.code).toBe('CONN_SUDO_FAILED')
    expect(h.cmd.closed).toBe(true)
  })

  it('signal 中止 → FS_CANCELLED，两个通道都关闭；已中止的 signal 不执行任何命令', async () => {
    const ac = new AbortController()
    const h = harness({ signal: ac.signal })
    const p = openIdentityChannel(h.deps)
    await flush()
    ac.abort()
    expect((await appErrorOf(p)).code).toBe('FS_CANCELLED')
    expect(h.cmd.closed).toBe(true)
    expect(h.poll.closed).toBe(true)

    const h2 = harness({ signal: AbortSignal.abort() })
    expect((await appErrorOf(openIdentityChannel(h2.deps))).code).toBe('FS_CANCELLED')
    expect(h2.commands).toEqual([])
  })

  it('交出密码后、判定成功之前被中止 → CONN_SUDO_AUTH_FAILED（无法排除密码错误，R11）', async () => {
    const ac = new AbortController()
    const h = harness({ signal: ac.signal })
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    expect(h.cmd.writes).toEqual(['Pch-pass1\n'])
    ac.abort()
    const e = await appErrorOf(p)
    expect(e.code).toBe('CONN_SUDO_AUTH_FAILED')
    expect(e.detail ?? '').not.toContain('Pch-pass1')
    expect(h.cmd.closed).toBe(true)
    expect(h.poll.closed).toBe(true)
  })

  it('交出密码后已有认证通过的迹象（stdout 有输出）再被中止 → FS_CANCELLED', async () => {
    const ac = new AbortController()
    const h = harness({ signal: ac.signal })
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    h.cmd.out('welcome\n')
    await flush()
    ac.abort()
    expect((await appErrorOf(p)).code).toBe('FS_CANCELLED')
  })

  it('出现提示但还没交出密码时被中止 → FS_CANCELLED', async () => {
    const ac = new AbortController()
    // 轮询通道未打开时不写密码
    const h = harness({ signal: ac.signal }, { holdPoll: true })
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    expect(h.cmd.writes).toEqual([])
    ac.abort()
    expect((await appErrorOf(p)).code).toBe('FS_CANCELLED')
  })

  it('判定成功之后（start 阶段）被中止 → FS_CANCELLED', async () => {
    const ac = new AbortController()
    const h = harness({ signal: ac.signal })
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    h.poll.out(psFrame(true))
    await flush()
    expect(h.cmd.writes).toEqual(['Pch-pass1\n', startCommand(SFTP_PATH)])
    ac.abort()
    expect((await appErrorOf(p)).code).toBe('FS_CANCELLED')
  })

  it('密码不出现在任何命令中；失败的 detail 中被替换为 ***（即使被拆在两个 chunk 中）', async () => {
    const pw = 'a\'b"c$d\\ e日本'
    const h = harness({ password: pw })
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    expect(h.cmd.writes).toEqual([`${pw}\n`])
    // 设想服务器把密码回显到了 stderr；UTF-8 多字节字符也被拆开
    const echoed = Buffer.from(`echo:${pw}\n`)
    h.cmd.err(echoed.subarray(0, echoed.length - 3))
    await flush()
    h.cmd.err(echoed.subarray(echoed.length - 3))
    h.cmd.err('x'.repeat(2000) + '\nSorry, try again.\nPCHSUDOPROMPT')
    const e = await appErrorOf(p)
    expect(e.code).toBe('CONN_SUDO_AUTH_FAILED')
    for (const c of h.commands) expect(c.command).not.toContain(pw)
    expect(e.detail ?? '').not.toContain(pw)
    expect((e.detail ?? '').length).toBeLessThanOrEqual(500)
  })

  it('detail 中的密码被替换为 ***', async () => {
    const pw = 'a\'b"c$d\\ e日本'
    const h = harness({ password: pw })
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.err(`PCHPID:${SUDO_PID}\nPCHSUDOPROMPT`)
    await flush()
    h.cmd.err(`echo:${pw}\nSorry, try again.\nPCHSUDOPROMPT`)
    const e = await appErrorOf(p)
    expect(e.detail).toContain('echo:***')
    expect(e.detail).not.toContain(pw)
  })

  it('含换行的密码不写入（写入会被当成两次尝试）', async () => {
    const h = harness({ password: 'ab\ncd' })
    const e = await appErrorOf(openIdentityChannel(h.deps))
    expect(e.code).toBe('CONN_SUDO_FAILED')
    expect(h.commands).toEqual([])
  })
})

describe('openIdentityChannel（终端方式）', () => {
  it('提示与 PCHSTART 都从 stdout；成功后先写 PTY_PREPARE 再写 startCommand；回显不算标记', async () => {
    const h = harness({ mode: 'pty' })
    let afterEcho: (() => void) | null = null
    h.cmd.onWrite = (s) => {
      if (s === PTY_PREPARE) h.cmd.out(`${PTY_PREPARE.replace('\n', '\r\n')}app1@h:~$ `)
      if (s === startCommand(SFTP_PATH)) {
        // 回显：printf '\120CHSTART\n'; exec ... -R（stty 生效之前）
        h.cmd.out(s.replace('\n', '\r\n'))
        afterEcho = () =>
          h.cmd.out(Buffer.concat([Buffer.from('app1@h:~$ PCHSTART\n'), SFTP_BYTES]))
      }
    }
    const p = track(openIdentityChannel(h.deps))
    await flush()
    expect(h.commands[0]).toEqual({ command: sudoCommand('app1'), pty: true })
    expect(h.commands[1]).toEqual({ command: pollCommand(150), pty: false })
    // stderr 上的东西在终端方式下不作数
    h.cmd.err('PCHSUDOPROMPT')
    await flush()
    expect(h.cmd.writes).toEqual([])
    h.cmd.out(`PCHPID:${SUDO_PID}\r\n[sudo: PCHSUDOPROMPT] Password: `)
    await flush()
    expect(h.cmd.writes).toEqual(['Pch-pass1\n'])
    h.cmd.out('\r\nLast login: today\r\n')
    h.poll.out(psFrame(true))
    await flush()
    expect(h.cmd.writes).toEqual(['Pch-pass1\n', PTY_PREPARE, startCommand(SFTP_PATH)])
    expect(p.done()).toBe(false)
    expect(afterEcho).not.toBeNull()
    afterEcho!()
    const r = await p.promise
    expect(r.mode).toBe('pty')
    expect(r.firstData.equals(SFTP_BYTES)).toBe(true)
  })

  it('终端方式下第二次提示 → CONN_SUDO_AUTH_FAILED', async () => {
    const h = harness({ mode: 'pty' })
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.out(`PCHPID:${SUDO_PID}\r\nPCHSUDOPROMPT`)
    await flush()
    h.cmd.out('\r\nSorry, try again.\r\nPCHSUDO')
    await flush()
    h.cmd.out('PROMPT')
    const e = await appErrorOf(p)
    expect(e.code).toBe('CONN_SUDO_AUTH_FAILED')
    expect(h.cmd.writes).toEqual(['Pch-pass1\n'])
  })

  it('终端方式下 PCHSTART 后为 \\r\\n 也能识别', async () => {
    const h = harness({ mode: 'pty', password: null })
    h.cmd.onWrite = (s) => {
      if (s === startCommand(SFTP_PATH)) {
        h.cmd.out('PCHSTART\r')
        h.cmd.out('\nZZ')
      }
    }
    const p = openIdentityChannel(h.deps)
    await flush()
    h.cmd.out(`PCHPID:${SUDO_PID}\r\n`)
    await flush()
    h.poll.out(psFrame(true))
    const r = await p
    const later: Buffer[] = []
    r.channel.stream.on('data', (d: Buffer) => later.push(d))
    await flush()
    expect(Buffer.concat([r.firstData, ...later]).toString()).toBe('ZZ')
  })
})
