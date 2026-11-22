// WSL 实机测试（Task 14）：经真实的 ConnectionPool / connectSsh / sudo-switch / sftp-bridge 连接本机 4 个 WSL 实例。
// 环境见 scripts/wsl-sftp/README.md（sshd 端口 2201–2204、试验用户、pch-scenario）。默认跳过，运行：
//   PCH_WSL_SFTP=1 pnpm vitest run apps/desktop/src/main/modules/connection/wsl.test.ts
// 测试会切换各实例的 sudoers 场景，结束时恢复为 `pch-scenario all quiet`。
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SFTP, type SftpChannelInfo } from 'ssh2/lib/protocol/SFTP.js'
import { AppError, type ConnectionState } from '@pch/shared'
import type { SftpSession } from '../../vfs/providers/sftp.provider'
import { ConnectionPool } from './connection-pool'
import type { ConnectionRecord } from './connection.repo'
import { createHostKeyGate } from './host-key-gate'
import { POLL_INTERVAL_MS, runProbe, SWITCH_TIMEOUT_MS } from './identity-sessions'
import type { SecretBox } from './secret-box'
import { sftpOverChannel } from './sftp-bridge'
import { connectSsh, type ExecChannel, type SshSession } from './ssh-session'
import { openIdentityChannel, type SwitchMode } from './sudo-switch'

const ENABLED = process.env.PCH_WSL_SFTP === '1'
// 真实 SSH / sudo（每次切换约 0.5 秒、wsl.exe 调用约 0.3 秒）：放宽默认的 5 / 10 秒
vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 })

interface Distro {
  name: string
  port: number
  /** Ubuntu 26.04 的 sudo-rs：不支持 logfile / requiretty */
  sudoRs: boolean
  /** sudo 密码（openSUSE 默认 targetpw：root 的密码）；null = 登录密码 */
  sudoSecret: string | null
  /** 默认 sudoers 有 `ALL ALL=(ALL) ALL`（openSUSE）：exact 场景也拒绝不了 app2 */
  allowsEveryone: boolean
}

const DISTROS: Distro[] = [
  { name: 'Ubuntu', port: 2201, sudoRs: true, sudoSecret: null, allowsEveryone: false },
  { name: 'Debian', port: 2202, sudoRs: false, sudoSecret: null, allowsEveryone: false },
  { name: 'AlmaLinux-9', port: 2203, sudoRs: false, sudoSecret: null, allowsEveryone: false },
  {
    name: 'openSUSE-Leap-16.1',
    port: 2204,
    sudoRs: false,
    sudoSecret: 'Root-pass1',
    allowsEveryone: true
  }
]

const LOGIN_PASSWORD = 'Pch-pass1'
const SUDO_LOG = '/var/log/pch-sudo.log'
const BLOB = '/opt/app1/log/pch-blob.bin'

// ---- WSL 操作（直接 spawn wsl.exe，不经 Git Bash，参数不被改写；-e 不经 WSL 的默认 shell 再解析一次） ----

function wsl(distro: string, args: string[]): string {
  const r = spawnSync('wsl.exe', ['-d', distro, '-u', 'root', '-e', ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true
  })
  if (r.error) throw r.error
  if (r.status !== 0) {
    throw new Error(`wsl ${distro} ${args.join(' ')} → ${r.status}: ${r.stdout}${r.stderr}`)
  }
  return r.stdout
}

const sh = (distro: string, script: string): string => wsl(distro, ['sh', '-c', script])

function scenario(distro: string, name: string, profile: 'quiet' | 'noisy' = 'quiet'): void {
  wsl(distro, ['/usr/local/sbin/pch-scenario', name, profile])
}

/** 传统 sudo 的 logfile 内容（sudo-rs 不写，返回空） */
const sudoLog = (distro: string): string => sh(distro, `cat ${SUDO_LOG} 2>/dev/null || true`)

/** journald 中 since（Unix 秒）之后的消息（PAM 的失败记录，sudo / sudo-rs / sshd 共通） */
const journal = (distro: string, since: number): string =>
  sh(distro, `journalctl --since @${since} --no-pager -o cat`)

const count = (text: string, re: RegExp): number => text.match(new RegExp(re, 'g'))?.length ?? 0
const SUDO_AUTH_FAILURE = /pam_unix\(sudo:auth\): authentication failure/
const SSHD_AUTH_FAILURE = /pam_unix\(sshd:auth\): authentication failure/
const INCORRECT_ATTEMPT = /(\d+) incorrect password attempts?/
const SUDO_COMMAND = /COMMAND=/

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** journald 的 --since 以秒为单位：动作之前等到下一秒开始，之后等日志落盘 */
async function nextSecond(): Promise<number> {
  await sleep(1100 - (Date.now() % 1000))
  return Math.floor(Date.now() / 1000)
}

// ---- 连接池（真实依赖；仓库与 SecretBox 为内存 / 直通） ----

const plainSecrets: SecretBox = {
  available: () => true,
  encrypt: (p) => p,
  decrypt: (s) => s
}

function record(d: Distro, over: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return {
    id: `wsl-${d.name}`,
    name: d.name,
    host: '127.0.0.1',
    port: d.port,
    username: 'pchuser',
    auth: 'password',
    keyPath: null,
    secret: LOGIN_PASSWORD,
    sudoSecret: d.sudoSecret,
    identities: ['app1', 'root'],
    hostKey: null,
    sftpServerPath: null,
    authState: 'ok',
    createdAt: 1,
    updatedAt: 1,
    ...over
  }
}

interface Harness {
  pool: ConnectionPool
  rec: ConnectionRecord
  states: ConnectionState[]
  warnings: string[]
  dials: number
}

const pools: ConnectionPool[] = []

function makePool(rec: ConnectionRecord): Harness {
  const records = new Map([[rec.id, rec]])
  const h: Harness = {
    pool: null as unknown as ConnectionPool,
    rec,
    states: [],
    warnings: [],
    dials: 0
  }
  // 真实的确认流程，窗口端自动接受
  const gate = createHostKeyGate({
    describe: async (id) => {
      const r = records.get(id)
      return r && { name: r.name, host: r.host, port: r.port }
    },
    send: (p) => {
      queueMicrotask(() => gate.answer(p.promptId, true))
      return true
    }
  })
  h.pool = new ConnectionPool({
    repo: {
      get: async (id) => {
        const r = records.get(id)
        return r ? structuredClone(r) : undefined
      },
      setAuthState: async (id, s) => {
        const r = records.get(id)
        if (r) r.authState = s
      },
      setHostKey: async (id, k) => {
        const r = records.get(id)
        if (r) r.hostKey = k
      }
    },
    secrets: plainSecrets,
    connect: (cfg) => {
      h.dials++
      return connectSsh(cfg)
    },
    openIdentity: openIdentityChannel,
    bridge: sftpOverChannel,
    readKeyFile: (file) => readFile(file),
    hostKeys: gate,
    settings: () => ({ keepaliveSec: 15, idleDisconnectMin: 5, timeoutSec: 20 }),
    onStatus: (_id, s) => h.states.push(s),
    now: Date.now,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    log: {
      error: (...a: unknown[]) => h.warnings.push(a.map(String).join(' ')),
      warn: (...a: unknown[]) => h.warnings.push(a.map(String).join(' ')),
      info: () => undefined,
      debug: () => undefined
    }
  })
  pools.push(h.pool)
  return h
}

const signal = (): AbortSignal => new AbortController().signal

async function session(h: Harness, identity: string | null): Promise<SftpSession> {
  return h.pool.session(
    { connectionId: h.rec.id, identity },
    { userAction: true, signal: signal() }
  )
}

async function names(s: SftpSession, path: string): Promise<string[]> {
  return (await s.readdir(path, signal())).map((e) => e.filename).sort()
}

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(AppError)
    return e as AppError
  }
  throw new Error('expected rejection')
}

/** 计时（毫秒，写入报告用） */
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now()
  try {
    return await fn()
  } finally {
    timings.push(`${label}: ${Math.round(performance.now() - t0)} ms`)
  }
}
const timings: string[] = []
/** 日志计数等实测值（写入报告用） */
const facts: string[] = []

// ---- 1MB 往返哈希：在切换身份后的通道上读整个文件（本应用不提供 read，用 ssh2 的 SFTP 类直接读） ----

interface ReadableSftp {
  readFile(path: string, cb: (err: Error | undefined, data: Buffer) => void): void
}

/** 同 sftp-bridge.ts 的构造方式，返回可 readFile 的 SFTP（只在测试中用） */
function rawSftpOver(ssh: SshSession, channel: ExecChannel, firstData: Buffer): Promise<SFTP> {
  const proto = (ssh.client as unknown as { _protocol?: { _remoteIdentRaw?: string } })._protocol
  const chanInfo: SftpChannelInfo = {
    type: 'session',
    incoming: { id: 0, window: 2 ** 31, packetSize: 32768, state: 'open' },
    outgoing: { id: 0, window: Number.MAX_SAFE_INTEGER, packetSize: 32768, state: 'open' }
  }
  const sftp = new SFTP(
    {
      _protocol: {
        _remoteIdentRaw: proto?._remoteIdentRaw,
        channelData: (_id, data) => channel.write(data),
        channelClose: () => channel.close()
      }
    },
    chanInfo,
    {}
  )
  return new Promise((resolve, reject) => {
    sftp.once('ready', () => resolve(sftp))
    sftp.on('error', reject)
    channel.stream.on('data', (d: Buffer) => sftp.push(d))
    channel.stream.on('end', () => sftp.push(null))
    sftp._init()
    if (firstData.length) sftp.push(firstData)
  })
}

async function readOverIdentity(
  d: Distro,
  identity: string,
  mode: SwitchMode,
  path: string
): Promise<{ data: Buffer; mode: SwitchMode }> {
  const ssh = await connectSsh({
    host: '127.0.0.1',
    port: d.port,
    username: 'pchuser',
    auth: { kind: 'password', password: LOGIN_PASSWORD },
    keepaliveSec: 15,
    readyTimeoutMs: 20_000,
    verifyHostKey: async () => true
  })
  try {
    const probe = await runProbe(ssh)
    expect(probe.sftpServerPath).not.toBeNull()
    const r = await openIdentityChannel({
      exec: (c, o) => ssh.exec(c, o),
      identity,
      sftpServerPath: probe.sftpServerPath as string,
      password: d.sudoSecret ?? LOGIN_PASSWORD,
      mode,
      pollIntervalMs: POLL_INTERVAL_MS,
      timeoutMs: SWITCH_TIMEOUT_MS
    })
    const sftp = (await rawSftpOver(ssh, r.channel, r.firstData)) as unknown as ReadableSftp
    const data = await new Promise<Buffer>((resolve, reject) =>
      sftp.readFile(path, (err, buf) => (err ? reject(err) : resolve(buf)))
    )
    r.channel.close()
    return { data, mode: r.mode }
  } finally {
    ssh.close()
  }
}

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

/** Windows 路径 → WSL 中的 /mnt/<盘符>/… */
function wslPath(winPath: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(winPath)
  if (!m) throw new Error(`not a drive path: ${winPath}`)
  return `/mnt/${(m[1] as string).toLowerCase()}/${(m[2] as string).replace(/\\/g, '/')}`
}

// ---- 测试 ----

describe.skipIf(!ENABLED)('WSL 实机：SFTP 与身份切换', () => {
  let blobDir: string | undefined
  let blob: Buffer

  beforeAll(async () => {
    // 1MB：先放全部 256 个字节值（含 \r \n ^C ^D ^S ^Q 等终端控制字符），其余随机
    blob = Buffer.concat([
      Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
      randomBytes(2 ** 20 - 256)
    ])
    blobDir = await mkdtemp(join(tmpdir(), 'pch-wsl-'))
    await writeFile(join(blobDir, 'blob.bin'), blob)
  })

  afterAll(async () => {
    await Promise.allSettled(pools.map((p) => p.dispose()))
    for (const d of DISTROS) {
      try {
        scenario(d.name, 'all')
        sh(d.name, `rm -f ${BLOB}`)
      } catch (e) {
        console.error(`restore ${d.name} failed`, e)
      }
    }
    if (blobDir) await rm(blobDir, { recursive: true, force: true })
    console.log(`[wsl] timings\n${timings.join('\n')}\n[wsl] facts\n${facts.join('\n')}`)
  })

  describe.each(DISTROS)('$name（127.0.0.1:$port）', (d) => {
    beforeAll(() => {
      scenario(d.name, 'all')
      // 只看本次的记录（试验实例的日志，可清空）
      if (!d.sudoRs) sh(d.name, `: > ${SUDO_LOG}`)
    })

    afterAll(() => {
      for (const p of pools.splice(0)) void p.dispose()
    })

    it('all quiet：登录用户列 /opt、/opt/app1/log 无权限；app1 与 root 经 sudo 列目录', async () => {
      const h = makePool(record(d))
      const login = await timed(`${d.name} login session`, () => session(h, null))
      expect(await names(login, '/opt')).toContain('app1')
      expect((await errorOf(login.readdir('/opt/app1/log', signal()))).code).toBe(
        'FS_PERMISSION_DENIED'
      )
      // 首次连接经确认框（自动接受）信任并保存了主机密钥
      expect(h.rec.hostKey?.fingerprint).toMatch(/^SHA256:/)
      const app1 = await timed(`${d.name} all/app1 switch`, () => session(h, 'app1'))
      expect(await names(app1, '/opt/app1/log')).toEqual(expect.arrayContaining(['app.log', 'sub']))
      const root = await timed(`${d.name} all/root switch`, () => session(h, 'root'))
      expect(await names(root, '/root/secret')).toContain('r.txt')
      // 登录用户的会话与身份会话共用同一条 SSH 连接
      expect(h.dials).toBe(1)
      expect(h.pool.state(h.rec.id)).toBe('online')

      const t = await timed(`${d.name} all test()`, () => h.pool.test(h.rec.id))
      expect(t.steps.every((s) => s.ok)).toBe(true)
      for (const s of t.steps.filter((x) => x.step === 'identity')) {
        expect(s.ok && s.info).toMatchObject({ mode: 'nopty' })
      }
      if (!d.sudoRs) {
        const log = sudoLog(d.name)
        // session(app1) + session(root) + test() 的 app1 / root
        facts.push(`${d.name} all: sudo log COMMAND lines=${count(log, SUDO_COMMAND)}`)
        expect(count(log, SUDO_COMMAND)).toBe(4)
        expect(count(log, INCORRECT_ATTEMPT)).toBe(0)
      }
    })

    it('exact noisy：精确规则下 app1 / root 成功（登录脚本的输出不污染 SFTP）；未授权的 app2 被拒绝', async () => {
      scenario(d.name, 'exact', 'noisy')
      try {
        const h = makePool(record(d, { identities: ['app1', 'root', 'app2'] }))
        const app1 = await timed(`${d.name} exact-noisy/app1 switch`, () => session(h, 'app1'))
        expect(await names(app1, '/opt/app1/log')).toEqual(
          expect.arrayContaining(['app.log', 'sub'])
        )
        const root = await session(h, 'root')
        expect(await names(root, '/root/secret')).toContain('r.txt')
        if (!d.allowsEveryone) {
          const since = await nextSecond()
          const e = await errorOf(timed(`${d.name} exact/app2 denied`, () => session(h, 'app2')))
          facts.push(`${d.name} exact/app2: ${e.code} (${e.detail ?? ''})`)
          expect(e.code, e.detail).toBe('CONN_SUDO_DENIED')
          // 拒绝不是密码错误：不锁定，其他身份仍可用
          expect(await names(await session(h, 'app1'), '/opt/app1/log')).toContain('app.log')
          await sleep(1000)
          expect(count(journal(d.name, since), SUDO_AUTH_FAILURE)).toBe(0)
        }
      } finally {
        scenario(d.name, 'all')
      }
    })

    it.skipIf(d.sudoRs)(
      'requiretty / exact-requiretty：非终端方式被拒后以终端方式成功；1MB 全字节文件往返哈希一致',
      async () => {
        for (const sc of ['requiretty', 'exact-requiretty']) {
          scenario(d.name, sc)
          try {
            const h = makePool(record(d))
            const app1 = await timed(`${d.name} ${sc}/app1 switch`, () => session(h, 'app1'))
            expect(await names(app1, '/opt/app1/log')).toEqual(
              expect.arrayContaining(['app.log', 'sub'])
            )
            const root = await timed(`${d.name} ${sc}/root switch`, () => session(h, 'root'))
            expect(await names(root, '/root/secret')).toContain('r.txt')
            expect((await root.stat('/root/secret/r.txt', signal())).size).toBeGreaterThan(0)
            // 记住了终端方式：test() 的身份步骤直接以 pty 打开
            const t = await h.pool.test(h.rec.id)
            expect(t.steps.every((s) => s.ok)).toBe(true)
            for (const s of t.steps.filter((x) => x.step === 'identity')) {
              expect(s.ok && s.info).toMatchObject({ mode: 'pty' })
            }
          } finally {
            scenario(d.name, 'all')
          }
        }

        // requiretty 在提示之前报告：改用终端方式不涉及密码错误
        const log = sudoLog(d.name)
        facts.push(
          `${d.name} requiretty: sudo log COMMAND lines=${count(log, SUDO_COMMAND)}, incorrect=${count(log, INCORRECT_ATTEMPT)}`
        )
        expect(count(log, INCORRECT_ATTEMPT)).toBe(0)

        // 终端方式的字节透明性：app1 专属文件经 sudo 切换后的通道读回
        sh(
          d.name,
          `install -o app1 -g app1 -m 600 '${wslPath(join(blobDir as string, 'blob.bin'))}' ${BLOB}`
        )
        scenario(d.name, 'requiretty')
        try {
          const r = await timed(`${d.name} requiretty/app1 read 1MB`, () =>
            readOverIdentity(d, 'app1', 'pty', BLOB)
          )
          expect(r.mode).toBe('pty')
          expect(r.data.length).toBe(blob.length)
          expect(sha256(r.data)).toBe(sha256(blob))
        } finally {
          scenario(d.name, 'all')
        }
        // 非终端方式也读一次（对照）
        const n = await readOverIdentity(d, 'app1', 'nopty', BLOB)
        expect(sha256(n.data)).toBe(sha256(blob))
      }
    )

    it('错误的 sudo 密码：CONN_SUDO_AUTH_FAILED，只记 1 次失败；之后 root 不再执行 sudo', async () => {
      const h = makePool(record(d, { sudoSecret: 'Wrong-pass9' }))
      // 登录用户不受影响
      expect(await names(await session(h, null), '/opt')).toContain('app1')
      const logBefore = d.sudoRs ? '' : sudoLog(d.name)
      const since = await nextSecond()
      const e = await errorOf(timed(`${d.name} wrong sudo password`, () => session(h, 'app1')))
      expect(e.code).toBe('CONN_SUDO_AUTH_FAILED')
      expect(h.rec.authState).toBe('sudo-auth-failed')
      await sleep(1500)
      const j1 = journal(d.name, since)
      facts.push(
        `${d.name} wrong sudo: ${e.code}; journal pam_unix(sudo:auth) failures=${count(j1, SUDO_AUTH_FAILURE)}`
      )
      expect(count(j1, SUDO_AUTH_FAILURE)).toBe(1)
      let logAfter = ''
      if (!d.sudoRs) {
        logAfter = sudoLog(d.name)
        const added = logAfter.slice(logBefore.length)
        const m = INCORRECT_ATTEMPT.exec(added)
        facts.push(
          `${d.name} wrong sudo: sudo log "${m?.[0] ?? '-'}" lines=${count(added, INCORRECT_ATTEMPT)}`
        )
        expect(m?.[1]).toBe('1')
        expect(count(added, INCORRECT_ATTEMPT)).toBe(1)
      }

      // 按连接锁住：root 不执行 sudo，日志不增加
      const e2 = await errorOf(session(h, 'root'))
      expect({ code: e2.code, detail: e2.detail }).toEqual({
        code: 'CONN_SUDO_AUTH_FAILED',
        detail: 'locked'
      })
      await sleep(1500)
      const j2 = journal(d.name, since)
      facts.push(
        `${d.name} wrong sudo then root: ${e2.code}/${e2.detail}; journal failures=${count(j2, SUDO_AUTH_FAILURE)}`
      )
      expect(count(j2, SUDO_AUTH_FAILURE)).toBe(1)
      expect(count(j2, /sudo\[\d+\]|sudo-rs|sudo:/)).toBe(count(j1, /sudo\[\d+\]|sudo-rs|sudo:/))
      if (!d.sudoRs) expect(sudoLog(d.name)).toBe(logAfter)
    })

    it('错误的登录密码：CONN_AUTH_FAILED，只记 1 次失败；之后不再连接', async () => {
      const h = makePool(record(d, { secret: 'Wrong-pass9' }))
      const since = await nextSecond()
      const e = await errorOf(timed(`${d.name} wrong login password`, () => session(h, null)))
      expect(e.code).toBe('CONN_AUTH_FAILED')
      expect(h.pool.state(h.rec.id)).toBe('auth-failed')
      await sleep(1500)
      const j1 = journal(d.name, since)
      facts.push(
        `${d.name} wrong login: ${e.code}; journal pam_unix(sshd:auth) failures=${count(j1, SSHD_AUTH_FAILURE)}`
      )
      expect(count(j1, SSHD_AUTH_FAILURE)).toBe(1)
      const e2 = await errorOf(session(h, null))
      expect({ code: e2.code, detail: e2.detail }).toEqual({
        code: 'CONN_AUTH_FAILED',
        detail: 'locked'
      })
      expect(h.dials).toBe(1)
      await sleep(1500)
      const j2 = journal(d.name, since)
      facts.push(
        `${d.name} wrong login then retry: ${e2.code}/${e2.detail}; dials=${h.dials}; journal failures=${count(j2, SSHD_AUTH_FAILURE)}`
      )
      expect(count(j2, SSHD_AUTH_FAILURE)).toBe(1)
    })
  })
})
