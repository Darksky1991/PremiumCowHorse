import { randomUUID } from 'node:crypto'
import type { HostKeyInfo, HostKeyPrompt } from '@pch/shared'

/**
 * 首次连接时的主机密钥确认（设计 5.3）：主进程向主窗口发确认请求，用户的回答经 answer 回来。
 * 未经确认绝不接受（反目标）：没有主窗口、连接不存在、超时都按「拒绝」处理。
 */
export interface HostKeyGate {
  /** 首次连接：询问用户（同一连接同时只有一个询问，其余等待同一结果） */
  ask(connectionId: string, key: HostKeyInfo): Promise<boolean>
  answer(promptId: string, accept: boolean): void
  /** 已发出、尚未回答且未超时的询问（渲染端重新加载后据此恢复确认框） */
  pending(): HostKeyPrompt[]
}

export interface HostKeyGateDeps {
  describe(connectionId: string): Promise<{ name: string; host: string; port: number } | undefined>
  send(prompt: HostKeyPrompt): boolean // 发给主窗口；没有主窗口 → false → ask 返回 false
  /** 等待回答的上限（默认 5 分钟，与连接池首次连接的 readyTimeout 下限一致）；到时按拒绝处理 */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 300_000

interface Pending {
  key: HostKeyInfo
  /** 已发给窗口的询问；发出之前为 null */
  prompt: HostKeyPrompt | null
  result: Promise<boolean>
  settle: (accept: boolean) => void
}

const sameKey = (a: HostKeyInfo, b: HostKeyInfo): boolean =>
  a.algorithm === b.algorithm && a.fingerprint === b.fingerprint

export function createHostKeyGate(deps: HostKeyGateDeps): HostKeyGate {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  /** connectionId → 进行中的询问 */
  const pending = new Map<string, Pending>()

  function start(connectionId: string, key: HostKeyInfo): Promise<boolean> {
    let settle!: (accept: boolean) => void
    const result = new Promise<boolean>((resolve) => (settle = resolve))
    const entry: Pending = { key, prompt: null, result, settle: () => undefined }
    let timer: ReturnType<typeof setTimeout> | undefined
    entry.settle = (accept) => {
      if (pending.get(connectionId) !== entry) return
      pending.delete(connectionId)
      clearTimeout(timer)
      settle(accept)
    }
    pending.set(connectionId, entry)

    void (async () => {
      let desc: Awaited<ReturnType<HostKeyGateDeps['describe']>>
      try {
        desc = await deps.describe(connectionId)
      } catch {
        desc = undefined
      }
      if (!desc) return entry.settle(false)
      const prompt: HostKeyPrompt = { promptId: randomUUID(), connectionId, ...desc, key }
      entry.prompt = prompt
      let sent: boolean
      try {
        sent = deps.send(prompt)
      } catch {
        sent = false
      }
      if (!sent) return entry.settle(false)
      timer = setTimeout(() => entry.settle(false), timeoutMs)
      timer.unref?.()
    })()
    return result
  }

  function ask(connectionId: string, key: HostKeyInfo): Promise<boolean> {
    const cur = pending.get(connectionId)
    if (!cur) return start(connectionId, key)
    if (sameKey(cur.key, key)) return cur.result
    // 同一连接出示了别的密钥：不能沿用对另一个密钥的回答，等它结束后单独询问
    return cur.result.then(() => ask(connectionId, key))
  }

  function answer(promptId: string, accept: boolean): void {
    for (const entry of pending.values()) {
      if (entry.prompt?.promptId === promptId) return entry.settle(accept === true)
    }
  }

  function list(): HostKeyPrompt[] {
    const out: HostKeyPrompt[] = []
    for (const entry of pending.values()) if (entry.prompt) out.push(entry.prompt)
    return out
  }

  return { ask, answer, pending: list }
}
