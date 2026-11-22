// 身份切换（sudo su - <身份>）的状态机：设计 devDoc/2026-11-22-37-m4-sftp-design.md 第 5.4 节，
// 流程同先行试验 scripts/wsl-sftp/reference/sudo-sftp-spike.mjs（4 个发行版实测）。
// 核心约束：认证成功之前，除一次密码外不向 sudo 写任何东西——密码后紧接着写命令行时，
// 密码错误会让 sudo 把命令行当成第二次密码，一次输错记 2 次失败（knowledge/libraries.md）。
import { StringDecoder } from 'node:string_decoder'
import { AppError, IDENTITY_PATTERN, SFTP_SERVER_PATH_PATTERN } from '@pch/shared'
import type { ExecChannel } from './ssh-session'

export const SUDO_PROMPT_MARKER = 'PCHSUDOPROMPT'
export const START_MARKER = 'PCHSTART'
export type SwitchMode = 'nopty' | 'pty'

export interface SwitchDeps {
  exec(command: string, opts: { pty: boolean }): Promise<ExecChannel>
  identity: string // 已按 IDENTITY_PATTERN 校验
  sftpServerPath: string // 已按路径正则校验
  password: string | null // null：sudo 要密码即失败
  mode: SwitchMode
  /** 轮询间隔（150）。轮询通道是长寿命的（POLL_COMMAND 在服务器端以 sleep 0.15 循环），本端不另设计时器 */
  pollIntervalMs: number
  timeoutMs: number // 15_000
  signal?: AbortSignal
}

export interface SwitchResult {
  channel: ExecChannel
  /** PCHSTART 行之后已读到的全部字节（含与标记同一 chunk 的部分） */
  firstData: Buffer
  mode: SwitchMode
}

/** 非终端方式遇到 requiretty：调用方改用终端方式重来，并记住该「连接 + 身份」的方式 */
export class NeedsTtyError extends Error {
  constructor(message = 'sudo requires a tty') {
    super(message)
    this.name = 'NeedsTtyError'
  }
}

/** `$$` 即随后被 exec 替换成的 sudo 的 PID；密码绝不进命令行 */
export function sudoCommand(identity: string): string {
  if (!IDENTITY_PATTERN.test(identity)) throw new Error('invalid identity')
  const su = identity === 'root' ? 'su -' : `su - ${identity}`
  return `printf 'PCHPID:%s\\n' $$ >&2; exec sudo -k -S -p '${SUDO_PROMPT_MARKER}' ${su}`
}

/** 标记用八进制写（\120 = P）：终端方式回显出的命令行里没有 PCHSTART 字样 */
export function startCommand(sftpServerPath: string): string {
  if (!SFTP_SERVER_PATH_PATTERN.test(sftpServerPath)) throw new Error('invalid sftp-server path')
  return `printf '\\120CHSTART\\n'; exec ${sftpServerPath} -R\n`
}

/** 终端方式：把终端切成透明模式（不回显、不转换换行、不处理控制字符） */
export const PTY_PREPARE = 'stty raw -echo -ixon -ixoff -isig -icanon -opost min 1 time 0\n'

/** 长寿命的轮询通道（D2）：每约 150ms 输出一帧进程表，以 PCHEND 行分帧 */
export const POLL_COMMAND = 'while :; do ps -eo pid=,ppid=,comm=; echo PCHEND; sleep 0.15; done'
const POLL_FRAME_END = 'PCHEND'

/** 一帧 ps 输出中，sudoPid 的子孙里是否有 comm 为 su 的进程（PAM 认证在 sudo 进程内完成，成功后才 fork） */
export function hasSuDescendant(psFrame: string, sudoPid: number): boolean {
  const children = new Map<number, number[]>()
  const comms = new Map<number, string>()
  for (const line of psFrame.split('\n')) {
    // comm 可能含空格（如 "Web Content"）
    const m = /^\s*(\d+)\s+(\d+)\s+(.*?)\s*$/.exec(line)
    if (!m) continue
    const pid = Number(m[1])
    const ppid = Number(m[2])
    comms.set(pid, m[3] ?? '')
    const list = children.get(ppid)
    if (list) list.push(pid)
    else children.set(ppid, [pid])
  }
  const seen = new Set<number>([sudoPid])
  const queue = [sudoPid]
  while (queue.length > 0) {
    const parent = queue.shift() as number
    for (const child of children.get(parent) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      if (comms.get(child) === 'su') return true
      queue.push(child)
    }
  }
  return false
}

// 只认 sudo 自己的措辞，避免登录横幅里的「... is not allowed」之类误判
const DENIED_PATTERN =
  /is not allowed to (?:execute|run)|is not in the sudoers file|may not run sudo/i
const NEEDS_TTY_PATTERN = /must have a tty/i

export function classifySudoError(text: string): 'denied' | 'needs-tty' | null {
  if (DENIED_PATTERN.test(text)) return 'denied'
  if (NEEDS_TTY_PATTERN.test(text)) return 'needs-tty'
  return null
}

/** 按字面替换所有出现的秘密（空字符串忽略） */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text
  for (const s of secrets) if (s) out = out.split(s).join('***')
  return out
}

const DETAIL_MAX = 500
/** 控制文本 / 诊断文本超过上限时只保留末尾（远大于秘密的最大长度 1024，保证截断处不留半个秘密） */
const TEXT_TRIM_AT = 16 * 1024
const TEXT_KEEP = 8 * 1024
const START_BYTES = Buffer.from(START_MARKER)

type Stage = 'auth' | 'start' | 'done'

/**
 * 打开一个以 deps.identity 身份运行 `sftp-server -R` 的命令通道（设计 5.4）。
 *
 * 状态：
 * - auth：命令通道执行 sudoCommand，轮询通道读进程表。控制文本（非终端方式为 stderr，终端方式为 stdout）中
 *   第一次出现提示 → 等轮询通道打开后写一次「密码\n」（password 为 null → CONN_SUDO_AUTH_FAILED）；
 *   第二次出现提示 → 立即关闭，CONN_SUDO_AUTH_FAILED；sudoers 拒绝 → CONN_SUDO_DENIED；
 *   requiretty → NeedsTtyError（终端方式下为 CONN_SUDO_FAILED）。
 *   进程表中 sudo 的子孙出现 su → 关闭轮询通道，（终端方式先写 PTY_PREPARE）写 startCommand，进入 start。
 * - start：丢弃 PCHSTART 行之前的 stdout，之后的字节为 firstData → 成功。
 * - 通道关闭 / 超时：交出密码之后、判定成功之前 → CONN_SUDO_AUTH_FAILED（无法排除密码错误，按连接锁住、
 *   不重试，以免反复提交错误密码锁号）；其他 → CONN_SUDO_FAILED。signal 中止 → FS_CANCELLED。
 *
 * 成功时交接：stdout 不再有本函数的监听，且处于非流动状态，之后到达的数据留在流的缓冲中，
 * 调用方挂上 data 监听时开始流动（不丢不重）。stderr 保持流动、数据丢弃（ssh2 的 stdout 与 stderr
 * 共用通道窗口，无人读取的 stderr 会让整个通道停住）。
 */
export function openIdentityChannel(deps: SwitchDeps): Promise<SwitchResult> {
  const { password, mode, signal } = deps
  if (signal?.aborted) return Promise.reject(new AppError({ code: 'FS_CANCELLED' }))
  let sudoCmd: string
  let startCmd: string
  try {
    sudoCmd = sudoCommand(deps.identity)
    startCmd = startCommand(deps.sftpServerPath)
  } catch (e) {
    return Promise.reject(
      new AppError({ code: 'CONN_SUDO_FAILED', detail: e instanceof Error ? e.message : String(e) })
    )
  }
  // 含换行的密码写入后会被 sudo 当成两次尝试
  if (password !== null && /[\r\n]/.test(password)) {
    return Promise.reject(
      new AppError({ code: 'CONN_SUDO_FAILED', detail: 'password contains a line break' })
    )
  }
  const secrets = password ? [password] : []

  return new Promise<SwitchResult>((resolve, reject) => {
    let stage: Stage = 'auth'
    let cmd: ExecChannel | null = null
    let poll: ExecChannel | null = null
    let sudoPid: number | null = null
    /** 控制文本中已看到的提示次数，与下一次查找的起点 */
    let prompts = 0
    let promptFrom = 0
    let passwordWritten = false
    /** auth 阶段的控制文本 */
    let ctl = ''
    /** 失败时 detail 用的输出摘要（每次追加后立即脱敏，再截断） */
    let diag = ''
    /** start 阶段尚未确定不含标记的 stdout 末尾 */
    let pending: Buffer = Buffer.alloc(0)
    let pollRest = ''
    let frameLines: string[] = []
    const outDecoder = new StringDecoder('utf8')
    const errDecoder = new StringDecoder('utf8')
    const pollDecoder = new StringDecoder('utf8')

    const detail = (reason: string): string => {
      const out = diag.replace(/\s+/g, ' ').trim()
      const room = DETAIL_MAX - reason.length - 2
      const text = out && room > 0 ? `${reason}: ${out.slice(-room)}` : reason
      return redact(text, secrets).slice(0, DETAIL_MAX)
    }
    const appendDiag = (text: string): void => {
      if (!text) return
      diag = redact(diag + text, secrets)
      if (diag.length > TEXT_TRIM_AT) diag = diag.slice(-TEXT_KEEP)
    }

    const cleanup = (): void => {
      stage = 'done'
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (cmd) {
        cmd.stream.removeListener('readable', onOut)
        cmd.stderr.removeListener('data', onErr)
      }
      if (poll) {
        poll.stream.removeListener('data', onPoll)
        poll.close()
      }
    }
    const fail = (e: Error): void => {
      if (stage === 'done') return
      cleanup()
      cmd?.close()
      reject(e)
    }
    const succeed = (firstData: Buffer): void => {
      if (stage === 'done' || !cmd) return
      const channel = cmd
      cleanup()
      resolve({ channel, firstData, mode })
    }
    /** 没有结论就结束（通道关闭 / 超时） */
    const undetermined = (reason: string): void => {
      const code =
        stage === 'auth' && passwordWritten ? 'CONN_SUDO_AUTH_FAILED' : 'CONN_SUDO_FAILED'
      fail(new AppError({ code, detail: detail(`${reason} (stage=${stage})`) }))
    }

    const answerPrompt = (): void => {
      if (stage !== 'auth' || passwordWritten || prompts !== 1 || !cmd) return
      if (password === null) {
        fail(
          new AppError({
            code: 'CONN_SUDO_AUTH_FAILED',
            detail: detail('sudo requires a password')
          })
        )
        return
      }
      // 轮询通道打开之前不交出密码：否则无法判定成功
      if (!poll) return
      passwordWritten = true
      cmd.write(`${password}\n`)
    }

    const feedCtl = (text: string): void => {
      ctl += text
      if (sudoPid === null) {
        const m = /PCHPID:(\d+)\r?\n/.exec(ctl)
        if (m) sudoPid = Number(m[1])
      }
      const kind = classifySudoError(ctl)
      if (kind === 'denied') {
        fail(new AppError({ code: 'CONN_SUDO_DENIED', detail: detail('sudo denied') }))
        return
      }
      if (kind === 'needs-tty') {
        fail(
          mode === 'nopty'
            ? new NeedsTtyError(detail('sudo requires a tty'))
            : new AppError({ code: 'CONN_SUDO_FAILED', detail: detail('sudo requires a tty') })
        )
        return
      }
      // 先数完本次文本中的全部提示再决定：同时到达的两次提示不写密码
      for (;;) {
        const i = ctl.indexOf(SUDO_PROMPT_MARKER, promptFrom)
        if (i < 0) break
        promptFrom = i + SUDO_PROMPT_MARKER.length
        prompts++
      }
      if (prompts > 1) {
        fail(
          new AppError({ code: 'CONN_SUDO_AUTH_FAILED', detail: detail('sudo password rejected') })
        )
        return
      }
      answerPrompt()
      if (ctl.length > TEXT_TRIM_AT) {
        const cut = ctl.length - TEXT_KEEP
        ctl = ctl.slice(cut)
        promptFrom = Math.max(0, promptFrom - cut)
      }
    }

    /** start 阶段：找 PCHSTART 后接 \n 或 \r\n（回显的命令行是 \120CHSTART，不会命中） */
    const feedStart = (chunk: Buffer): void => {
      const buf = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk
      let from = 0
      for (;;) {
        const i = buf.indexOf(START_BYTES, from)
        if (i < 0) break
        const j = i + START_BYTES.length
        if (j >= buf.length || (buf[j] === 0x0d && j + 1 >= buf.length)) {
          // 标记之后的换行尚未到达
          pending = Buffer.from(buf.subarray(i))
          return
        }
        if (buf[j] === 0x0a) return succeed(Buffer.from(buf.subarray(j + 1)))
        if (buf[j] === 0x0d && buf[j + 1] === 0x0a) return succeed(Buffer.from(buf.subarray(j + 2)))
        from = i + 1
      }
      // 末尾可能是被拆开的标记前缀
      pending = Buffer.from(buf.subarray(Math.max(0, buf.length - START_BYTES.length)))
    }

    const handleOut = (chunk: Buffer): void => {
      const text = outDecoder.write(chunk)
      appendDiag(text)
      if (stage === 'auth') {
        // 终端方式：stdout 即控制文本。非终端方式：认证阶段的 stdout 都在标记之前
        // （标记要在写入 startCommand 之后才输出），只留作诊断
        if (mode === 'pty') feedCtl(text)
        return
      }
      feedStart(chunk)
    }

    const onOut = (): void => {
      if (!cmd) return
      let chunk: unknown
      while (stage !== 'done' && (chunk = cmd.stream.read()) !== null) {
        handleOut(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      }
    }
    const onErr = (d: Buffer): void => {
      if (stage === 'done') return
      const text = errDecoder.write(d)
      appendDiag(text)
      if (stage === 'auth') feedCtl(text)
    }
    const onPoll = (d: Buffer): void => {
      if (stage !== 'auth') return
      const lines = (pollRest + pollDecoder.write(d)).split('\n')
      pollRest = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.replace(/\r$/, '')
        if (line !== POLL_FRAME_END) {
          frameLines.push(line)
          continue
        }
        const frame = frameLines.join('\n')
        frameLines = []
        if (sudoPid !== null && hasSuDescendant(frame, sudoPid)) return authenticated()
      }
    }
    const authenticated = (): void => {
      if (stage !== 'auth' || !cmd) return
      stage = 'start'
      if (poll) {
        poll.stream.removeListener('data', onPoll)
        poll.close()
      }
      if (mode === 'pty') cmd.write(PTY_PREPARE)
      cmd.write(startCmd)
    }

    const onAbort = (): void => fail(new AppError({ code: 'FS_CANCELLED' }))
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => undetermined('timeout'), deps.timeoutMs)

    const passThrough = (e: unknown, what: string): Error =>
      e instanceof AppError
        ? e
        : new AppError({
            code: 'CONN_SUDO_FAILED',
            detail: `${what}: ${e instanceof Error ? e.message : String(e)}`
          })

    deps.exec(sudoCmd, { pty: mode === 'pty' }).then(
      (ch) => {
        if (stage === 'done') {
          ch.close()
          return
        }
        cmd = ch
        ch.stream.on('readable', onOut)
        if (mode === 'nopty') ch.stderr.on('data', onErr)
        else ch.stderr.resume()
        ch.onClose(() => {
          if (stage === 'done') return
          onOut() // 关闭前已缓冲的输出（错误信息、标记）先处理
          // onOut 可能已改变 stage（TS 的收窄看不到闭包内的赋值）
          if ((stage as Stage) !== 'done') undetermined('channel closed')
        })
        // 第 1 步命令发出后立即开始轮询（NOPASSWD 的环境没有提示也能判定成功）
        deps.exec(POLL_COMMAND, { pty: false }).then(
          (p) => {
            if (stage === 'done') {
              p.close()
              return
            }
            poll = p
            p.stream.on('data', onPoll)
            p.stderr.resume()
            p.onClose(() => {
              if (stage === 'auth') undetermined('poll channel closed')
            })
            answerPrompt()
          },
          (e: unknown) => fail(passThrough(e, 'poll channel'))
        )
      },
      (e: unknown) => fail(passThrough(e, 'sudo channel'))
    )
  })
}
