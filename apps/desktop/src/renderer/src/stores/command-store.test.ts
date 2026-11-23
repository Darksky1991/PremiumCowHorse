import { afterEach, describe, expect, it } from 'vitest'
import { useCommandStore, type Command } from './command-store'

const cmd = (id: string, run = (): void => undefined): Command => ({
  id,
  titleKey: `commands:${id}`,
  group: 'general',
  run
})

const ids = (): string[] =>
  useCommandStore
    .getState()
    .commands()
    .map((c) => c.id)

afterEach(() => useCommandStore.setState({ entries: [] }))

describe('command store', () => {
  it('registered commands are listed and removed on unregister', () => {
    const off = useCommandStore.getState().register([cmd('a'), cmd('b')])
    expect(ids()).toEqual(['a', 'b'])
    off()
    expect(ids()).toEqual([])
  })

  it('a later registration with the same id overrides; unregistering restores the previous one', () => {
    const first = (): void => undefined
    const second = (): void => undefined
    const offFirst = useCommandStore.getState().register([cmd('a', first)])
    const offSecond = useCommandStore.getState().register([cmd('a', second)])
    expect(ids()).toEqual(['a'])
    expect(useCommandStore.getState().commands()[0]?.run).toBe(second)
    offSecond()
    expect(useCommandStore.getState().commands()[0]?.run).toBe(first)
    offFirst()
    expect(ids()).toEqual([])
  })

  it('unregistering twice is harmless', () => {
    const off = useCommandStore.getState().register([cmd('a')])
    off()
    off()
    expect(ids()).toEqual([])
  })
})
