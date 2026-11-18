import { describe, expect, it } from 'vitest'
import { EntryAddInput, EntryMoveInput, WorkspaceCreateInput } from './schema'

describe('WorkspaceCreateInput', () => {
  it('rejects a blank name', () => {
    expect(WorkspaceCreateInput.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('rejects a name longer than 100 characters', () => {
    expect(WorkspaceCreateInput.safeParse({ name: 'あ'.repeat(101) }).success).toBe(false)
  })

  it('accepts a Japanese name and trims it', () => {
    expect(WorkspaceCreateInput.parse({ name: ' 案件A ' })).toEqual({ name: '案件A' })
  })
})

describe('EntryAddInput', () => {
  const base = { workspaceId: 'default', parentId: null }

  it('requires a path for folder entries', () => {
    expect(EntryAddInput.safeParse({ ...base, kind: 'folder' }).success).toBe(false)
  })

  it('accepts a folder entry with a path and optional label', () => {
    expect(EntryAddInput.safeParse({ ...base, kind: 'folder', path: 'C:\\案件A' }).success).toBe(
      true
    )
  })

  it('rejects a path on group entries', () => {
    expect(
      EntryAddInput.safeParse({ ...base, kind: 'group', label: 'ログ', path: 'C:\\x' }).success
    ).toBe(false)
  })

  it('rejects unknown keys', () => {
    expect(
      EntryAddInput.safeParse({ ...base, kind: 'group', label: 'ログ', extra: 1 }).success
    ).toBe(false)
  })
})

describe('EntryMoveInput', () => {
  it('rejects a negative index', () => {
    expect(EntryMoveInput.safeParse({ id: 'e1', parentId: null, index: -1 }).success).toBe(false)
  })
})
