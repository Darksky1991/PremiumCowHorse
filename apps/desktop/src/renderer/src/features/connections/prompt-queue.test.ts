import { describe, expect, it, vi } from 'vitest'
import type { HostKeyPrompt } from '@pch/shared'
import {
  dequeuePrompt,
  enqueuePrompt,
  startHostKeyPromptSync,
  type HostKeyPromptSyncDeps
} from './prompt-queue'

const prompt = (promptId: string): HostKeyPrompt => ({
  promptId,
  connectionId: 'c1',
  name: 'AP1',
  host: '10.0.0.5',
  port: 22,
  key: { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:x' }
})

const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await Promise.resolve()
}

/** 可手动触发事件与查询结果的依赖 */
function harness(): {
  deps: HostKeyPromptSyncDeps
  emit: (p: HostKeyPrompt) => void
  emitClosed: (promptId: string) => void
  resolve: (list: HostKeyPrompt[]) => void
  order: string[]
  offs: ReturnType<typeof vi.fn>
} {
  const order: string[] = []
  let emit: (p: HostKeyPrompt) => void = () => undefined
  let emitClosed: (promptId: string) => void = () => undefined
  let resolve!: (list: HostKeyPrompt[]) => void
  const offs = vi.fn()
  const deps: HostKeyPromptSyncDeps = {
    subscribe: (listener) => {
      order.push('subscribe')
      emit = listener
      return offs
    },
    subscribeClosed: (listener) => {
      order.push('subscribeClosed')
      emitClosed = listener
      return offs
    },
    fetchPending: () => {
      order.push('fetch')
      return new Promise((r) => (resolve = r))
    },
    add: vi.fn(),
    remove: vi.fn()
  }
  return {
    deps,
    emit: (p) => emit(p),
    emitClosed: (id) => emitClosed(id),
    resolve: (list) => resolve(list),
    order,
    offs
  }
}

const ids = (fn: unknown): string[] =>
  (fn as ReturnType<typeof vi.fn>).mock.calls.map(([p]) => (p as HostKeyPrompt).promptId)

describe('enqueuePrompt / dequeuePrompt', () => {
  it('追加到末尾；同一 promptId 不重复（原样返回）', () => {
    const q1 = enqueuePrompt([], prompt('a'))
    const q2 = enqueuePrompt(q1, prompt('b'))
    expect(q2.map((p) => p.promptId)).toEqual(['a', 'b'])
    expect(enqueuePrompt(q2, prompt('a'))).toBe(q2)
  })

  it('移除；不在队列中时原样返回', () => {
    const q = [prompt('a'), prompt('b')]
    expect(dequeuePrompt(q, 'a').map((p) => p.promptId)).toEqual(['b'])
    expect(dequeuePrompt(q, 'x')).toBe(q)
  })
})

describe('startHostKeyPromptSync', () => {
  it('先订阅再查询：事件与查询结果都加入', async () => {
    const h = harness()
    startHostKeyPromptSync(h.deps)
    expect(h.order).toEqual(['subscribe', 'subscribeClosed', 'fetch'])
    h.emit(prompt('b'))
    h.resolve([prompt('a')])
    await flush()
    expect(ids(h.deps.add)).toEqual(['b', 'a'])
  })

  it('主进程结束询问（超时 / 其他途径回答）→ 移除', () => {
    const h = harness()
    startHostKeyPromptSync(h.deps)
    h.emit(prompt('a'))
    h.emitClosed('a')
    expect(h.deps.remove).toHaveBeenCalledWith('a')
  })

  it('查询结果比「结束」事件旧时，不再加入已结束的询问', async () => {
    const h = harness()
    startHostKeyPromptSync(h.deps)
    h.emitClosed('a')
    h.resolve([prompt('a'), prompt('b')])
    await flush()
    expect(ids(h.deps.add)).toEqual(['b'])
  })

  it('停止后取消订阅，并忽略迟到的查询结果；查询失败不抛出', async () => {
    const h = harness()
    const stop = startHostKeyPromptSync(h.deps)
    stop()
    expect(h.offs).toHaveBeenCalledTimes(2)
    h.resolve([prompt('a')])
    await flush()
    expect(h.deps.add).not.toHaveBeenCalled()

    const add = vi.fn()
    const stop2 = startHostKeyPromptSync({
      ...h.deps,
      fetchPending: () => Promise.reject(new Error('x')),
      add
    })
    await flush()
    stop2()
    expect(add).not.toHaveBeenCalled()
  })
})
