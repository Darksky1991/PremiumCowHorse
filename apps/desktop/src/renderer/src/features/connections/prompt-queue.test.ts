import { describe, expect, it, vi } from 'vitest'
import type { HostKeyPrompt } from '@pch/shared'
import { enqueuePrompt, startHostKeyPromptSync } from './prompt-queue'

const prompt = (promptId: string): HostKeyPrompt => ({
  promptId,
  connectionId: 'c1',
  name: 'AP1',
  host: '10.0.0.5',
  port: 22,
  key: { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:x' }
})

describe('enqueuePrompt', () => {
  it('追加到末尾；同一 promptId 不重复（原样返回）', () => {
    const q1 = enqueuePrompt([], prompt('a'))
    const q2 = enqueuePrompt(q1, prompt('b'))
    expect(q2.map((p) => p.promptId)).toEqual(['a', 'b'])
    expect(enqueuePrompt(q2, prompt('a'))).toBe(q2)
  })
})

describe('startHostKeyPromptSync', () => {
  it('先订阅再查询：事件与查询结果都加入', async () => {
    const order: string[] = []
    let emit: (p: HostKeyPrompt) => void = () => undefined
    const add = vi.fn()
    let resolve!: (list: HostKeyPrompt[]) => void
    startHostKeyPromptSync({
      subscribe: (listener) => {
        order.push('subscribe')
        emit = listener
        return () => undefined
      },
      fetchPending: () => {
        order.push('fetch')
        return new Promise((r) => (resolve = r))
      },
      add
    })
    expect(order).toEqual(['subscribe', 'fetch'])
    emit(prompt('b'))
    resolve([prompt('a')])
    await Promise.resolve()
    await Promise.resolve()
    expect(add.mock.calls.map(([p]) => (p as HostKeyPrompt).promptId)).toEqual(['b', 'a'])
  })

  it('停止后取消订阅，并忽略迟到的查询结果；查询失败不抛出', async () => {
    const off = vi.fn()
    const add = vi.fn()
    let resolve!: (list: HostKeyPrompt[]) => void
    const stop = startHostKeyPromptSync({
      subscribe: () => off,
      fetchPending: () => new Promise((r) => (resolve = r)),
      add
    })
    stop()
    expect(off).toHaveBeenCalledTimes(1)
    resolve([prompt('a')])
    await Promise.resolve()
    await Promise.resolve()
    expect(add).not.toHaveBeenCalled()

    const stop2 = startHostKeyPromptSync({
      subscribe: () => () => undefined,
      fetchPending: () => Promise.reject(new Error('x')),
      add
    })
    await Promise.resolve()
    stop2()
    expect(add).not.toHaveBeenCalled()
  })
})
