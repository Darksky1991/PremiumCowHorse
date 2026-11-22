import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostKeyInfo, HostKeyPrompt } from '@pch/shared'
import { createHostKeyGate, type HostKeyGate } from './host-key-gate'

const KEY: HostKeyInfo = { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:aaa' }
const OTHER: HostKeyInfo = { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:bbb' }
const DESC = { name: 'AP1', host: 'ap1.example', port: 22 }

interface GateHarness {
  gate: HostKeyGate
  send: ReturnType<typeof vi.fn>
  describe: ReturnType<typeof vi.fn>
  prompts: HostKeyPrompt[]
}

function setup(
  over: { send?: (p: HostKeyPrompt) => boolean; describe?: () => unknown } = {}
): GateHarness {
  const prompts: HostKeyPrompt[] = []
  const send = vi.fn(
    over.send ??
      ((p: HostKeyPrompt) => {
        prompts.push(p)
        return true
      })
  )
  const describe = vi.fn(over.describe ?? (async () => DESC))
  const gate = createHostKeyGate({
    describe: describe as () => Promise<typeof DESC | undefined>,
    send
  })
  return { gate, send, describe, prompts }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createHostKeyGate', () => {
  it('同一连接并发询问只发一次，回答后全部得到同一结果', async () => {
    const { gate, send, prompts } = setup()
    const a = gate.ask('c1', KEY)
    const b = gate.ask('c1', KEY)
    const c = gate.ask('c1', KEY)
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(prompts[0]).toMatchObject({ connectionId: 'c1', key: KEY, ...DESC })
    gate.answer(prompts[0]!.promptId, true)
    await expect(Promise.all([a, b, c])).resolves.toEqual([true, true, true])
  })

  it('回答之后再次询问会重新发出', async () => {
    const { gate, send, prompts } = setup()
    const a = gate.ask('c1', KEY)
    await flush()
    gate.answer(prompts[0]!.promptId, false)
    await expect(a).resolves.toBe(false)
    const b = gate.ask('c1', KEY)
    await flush()
    expect(send).toHaveBeenCalledTimes(2)
    gate.answer(prompts[1]!.promptId, true)
    await expect(b).resolves.toBe(true)
  })

  it('没有主窗口（send 返回 false）→ false', async () => {
    const { gate } = setup({ send: () => false })
    await expect(gate.ask('c1', KEY)).resolves.toBe(false)
  })

  it('连接不存在（describe 为 undefined）→ false，不发出', async () => {
    const { gate, send } = setup({ describe: async () => undefined })
    await expect(gate.ask('c1', KEY)).resolves.toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('同一连接出示不同的密钥：不沿用前一个回答，等前一个结束后单独询问', async () => {
    const { gate, send, prompts } = setup()
    const a = gate.ask('c1', KEY)
    const b = gate.ask('c1', OTHER)
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    gate.answer(prompts[0]!.promptId, true)
    await expect(a).resolves.toBe(true)
    await flush()
    expect(send).toHaveBeenCalledTimes(2)
    expect(prompts[1]!.key).toEqual(OTHER)
    gate.answer(prompts[1]!.promptId, false)
    await expect(b).resolves.toBe(false)
  })

  it('未知或过期的 promptId 被忽略', async () => {
    const { gate, prompts } = setup()
    const a = gate.ask('c1', KEY)
    await flush()
    gate.answer('nope', true)
    gate.answer(prompts[0]!.promptId, false)
    gate.answer(prompts[0]!.promptId, true)
    await expect(a).resolves.toBe(false)
  })

  it('pending 列出已发出且未回答的询问；回答后移除', async () => {
    const { gate, prompts } = setup()
    expect(gate.pending()).toEqual([])
    const a = gate.ask('c1', KEY)
    const b = gate.ask('c2', OTHER)
    await flush()
    expect(gate.pending()).toEqual(prompts)
    gate.answer(prompts[0]!.promptId, true)
    await expect(a).resolves.toBe(true)
    expect(gate.pending()).toEqual([prompts[1]])
    gate.answer(prompts[1]!.promptId, false)
    await expect(b).resolves.toBe(false)
    expect(gate.pending()).toEqual([])
  })

  it('pending 不含未能发出的询问（连接不存在 / 没有主窗口）', async () => {
    const gone = setup({ describe: async () => undefined })
    await expect(gone.gate.ask('c1', KEY)).resolves.toBe(false)
    expect(gone.gate.pending()).toEqual([])
    const noWindow = setup({ send: () => false })
    await expect(noWindow.gate.ask('c1', KEY)).resolves.toBe(false)
    expect(noWindow.gate.pending()).toEqual([])
  })

  it('pending 不含已超时的询问', async () => {
    vi.useFakeTimers()
    const { gate } = setup()
    const a = gate.ask('c1', KEY)
    await flush()
    expect(gate.pending()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(300_000)
    await expect(a).resolves.toBe(false)
    expect(gate.pending()).toEqual([])
  })

  it('询问结束（回答 / 超时）时通知 closed；未能发出的询问不通知', async () => {
    vi.useFakeTimers()
    const closed = vi.fn()
    const prompts: HostKeyPrompt[] = []
    const gate = createHostKeyGate({
      describe: async (id) => (id === 'gone' ? undefined : DESC),
      send: (p) => {
        prompts.push(p)
        return true
      },
      closed
    })
    const a = gate.ask('c1', KEY)
    const b = gate.ask('c2', KEY)
    await flush()
    expect(closed).not.toHaveBeenCalled()
    gate.answer(prompts[0]!.promptId, true)
    await expect(a).resolves.toBe(true)
    expect(closed).toHaveBeenCalledWith(prompts[0]!.promptId)
    await vi.advanceTimersByTimeAsync(300_000)
    await expect(b).resolves.toBe(false)
    expect(closed).toHaveBeenLastCalledWith(prompts[1]!.promptId)
    expect(closed).toHaveBeenCalledTimes(2)
    await expect(gate.ask('gone', KEY)).resolves.toBe(false)
    expect(closed).toHaveBeenCalledTimes(2)
  })

  it('closed 抛出也不影响结果', async () => {
    const prompts: HostKeyPrompt[] = []
    const gate = createHostKeyGate({
      describe: async () => DESC,
      send: (p) => {
        prompts.push(p)
        return true
      },
      closed: () => {
        throw new Error('window gone')
      }
    })
    const a = gate.ask('c1', KEY)
    await flush()
    gate.answer(prompts[0]!.promptId, true)
    await expect(a).resolves.toBe(true)
    expect(gate.pending()).toEqual([])
  })

  it('一直没有回答：到时以 false 结束，之后的询问重新发出', async () => {
    vi.useFakeTimers()
    const { gate, send } = setup()
    const a = gate.ask('c1', KEY)
    await flush()
    await vi.advanceTimersByTimeAsync(300_000)
    await expect(a).resolves.toBe(false)
    void gate.ask('c1', KEY)
    await flush()
    expect(send).toHaveBeenCalledTimes(2)
  })
})
