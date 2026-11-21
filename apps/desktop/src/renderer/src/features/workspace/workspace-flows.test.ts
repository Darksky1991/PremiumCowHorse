import { describe, expect, it, vi } from 'vitest'
import { AppError, DEFAULT_WORKSPACE_ID, type TabState, type TabsState } from '@pch/shared'
import { createAndActivate, listTabToLeave, removeWorkspace } from './workspace-flows'

describe('createAndActivate', () => {
  it('创建成功后切换，并关闭对话框', async () => {
    const calls: string[] = []
    const closed = await createAndActivate(
      {
        create: async (name) => (calls.push(`create:${name}`), { id: 'w1' }),
        activate: async (id) => void calls.push(`activate:${id}`),
        onCreateError: vi.fn(),
        onActivateError: vi.fn()
      },
      '案件A'
    )
    expect(closed).toBe(true)
    expect(calls).toEqual(['create:案件A', 'activate:w1'])
  })

  it('创建失败：不切换、保持打开、提示创建错误', async () => {
    const err = new AppError({ code: 'UNKNOWN' })
    const activate = vi.fn()
    const onCreateError = vi.fn()
    const closed = await createAndActivate(
      {
        create: async () => {
          throw err
        },
        activate,
        onCreateError,
        onActivateError: vi.fn()
      },
      'x'
    )
    expect(closed).toBe(false)
    expect(activate).not.toHaveBeenCalled()
    expect(onCreateError).toHaveBeenCalledWith(err)
  })

  it('创建成功但切换失败：仍关闭对话框（避免再次提交造成重复创建），提示「已创建但未能切换」', async () => {
    const err = new AppError({ code: 'UNKNOWN' })
    const onCreateError = vi.fn()
    const onActivateError = vi.fn()
    const closed = await createAndActivate(
      {
        create: async () => ({ id: 'w1' }),
        activate: async () => {
          throw err
        },
        onCreateError,
        onActivateError
      },
      'x'
    )
    expect(closed).toBe(true)
    expect(onCreateError).not.toHaveBeenCalled()
    expect(onActivateError).toHaveBeenCalledWith(err)
  })
})

describe('removeWorkspace', () => {
  it('删除当前工作区：先切到默认工作区，成功后再删除目标，并关闭', async () => {
    const calls: string[] = []
    const closed = await removeWorkspace(
      {
        activate: async (id) => void calls.push(`activate:${id}`),
        remove: async (id) => void calls.push(`remove:${id}`),
        onError: vi.fn()
      },
      'w1',
      'w1'
    )
    expect(closed).toBe(true)
    expect(calls).toEqual([`activate:${DEFAULT_WORKSPACE_ID}`, 'remove:w1'])
  })

  it('切换失败：什么都不删，保持打开并提示', async () => {
    const err = new AppError({ code: 'UNKNOWN' })
    const remove = vi.fn()
    const onError = vi.fn()
    const closed = await removeWorkspace(
      {
        activate: async () => {
          throw err
        },
        remove,
        onError
      },
      'w1',
      'w1'
    )
    expect(closed).toBe(false)
    expect(remove).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(err)
  })

  it('删除失败：已在默认工作区，保持打开并提示', async () => {
    const err = new AppError({ code: 'UNKNOWN' })
    const onError = vi.fn()
    const closed = await removeWorkspace(
      {
        activate: async () => undefined,
        remove: async () => {
          throw err
        },
        onError
      },
      'w1',
      'w1'
    )
    expect(closed).toBe(false)
    expect(onError).toHaveBeenCalledWith(err)
  })

  it('目标已不存在（WORKSPACE_NOT_FOUND）：静默关闭', async () => {
    const onError = vi.fn()
    const closed = await removeWorkspace(
      {
        activate: async () => undefined,
        remove: async () => {
          throw new AppError({ code: 'WORKSPACE_NOT_FOUND' })
        },
        onError
      },
      'w1',
      'w1'
    )
    expect(closed).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('removeWorkspace（目标不是当前工作区）', () => {
  it('不切换，直接删除并关闭', async () => {
    const calls: string[] = []
    const closed = await removeWorkspace(
      {
        activate: async (id) => void calls.push(`activate:${id}`),
        remove: async (id) => void calls.push(`remove:${id}`),
        onError: vi.fn()
      },
      'w2',
      'w1'
    )
    expect(closed).toBe(true)
    expect(calls).toEqual(['remove:w2'])
  })

  it('删除失败：保持打开并提示', async () => {
    const err = new AppError({ code: 'UNKNOWN' })
    const activate = vi.fn()
    const onError = vi.fn()
    const closed = await removeWorkspace(
      {
        activate,
        remove: async () => {
          throw err
        },
        onError
      },
      'w2',
      'w1'
    )
    expect(closed).toBe(false)
    expect(activate).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(err)
  })
})

describe('removeWorkspace（当前工作区未知）', () => {
  it('activeId 为 undefined：按「是当前工作区」处理，先切到默认工作区再删除', async () => {
    const calls: string[] = []
    const closed = await removeWorkspace(
      {
        activate: async (id) => void calls.push(`activate:${id}`),
        remove: async (id) => void calls.push(`remove:${id}`),
        onError: vi.fn()
      },
      'w1',
      undefined
    )
    expect(closed).toBe(true)
    expect(calls).toEqual([`activate:${DEFAULT_WORKSPACE_ID}`, 'remove:w1'])
  })
})

describe('listTabToLeave', () => {
  const tab = (id: string, uri: string): TabState =>
    ({ id, uri, kind: uri === 'pch-workspaces:' ? 'workspaces' : 'workspace' }) as TabState
  const byWorkspace: Record<string, TabsState> = {
    w1: { tabs: [tab('t1', 'pch-workspaces:'), tab('t2', 'pch-workspaces:')], activeId: 't1' },
    w2: { tabs: [tab('t3', 'pch-workspace:w2')], activeId: 't3' }
  }

  it('标签仍是其工作区的激活标签、仍在一览，且显示中的工作区已换成别的：后退', () => {
    expect(listTabToLeave(byWorkspace, 't1', 'w2')).toBe(true)
  })

  it('显示中的仍是该工作区（标签内导航走 / 重新挂载）或未知：不后退', () => {
    expect(listTabToLeave(byWorkspace, 't1', 'w1')).toBe(false)
    expect(listTabToLeave(byWorkspace, 't1', undefined)).toBe(false)
  })

  it('不是激活标签、已不在一览、已关闭：不后退', () => {
    expect(listTabToLeave(byWorkspace, 't2', 'w2')).toBe(false)
    expect(listTabToLeave(byWorkspace, 't3', 'w1')).toBe(false)
    expect(listTabToLeave(byWorkspace, 'gone', 'w2')).toBe(false)
  })
})
