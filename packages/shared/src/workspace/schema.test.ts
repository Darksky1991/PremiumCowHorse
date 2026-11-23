import { describe, expect, it } from 'vitest'
import {
  EntryAddInput,
  EntryMoveInput,
  WorkspaceCreateInput,
  WorkspaceReorderInput,
  WorkspaceUpdateInput
} from './schema'

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

  it('accepts a folder entry with a uri instead of a path', () => {
    expect(EntryAddInput.safeParse({ ...base, kind: 'folder', uri: 'file:///C:/x' }).success).toBe(
      true
    )
  })

  it('rejects a folder entry with both path and uri', () => {
    expect(
      EntryAddInput.safeParse({ ...base, kind: 'folder', path: 'C:\\x', uri: 'file:///C:/x' })
        .success
    ).toBe(false)
  })

  it('rejects a folder entry with neither path nor uri', () => {
    expect(EntryAddInput.safeParse({ ...base, kind: 'file', label: 'x' }).success).toBe(false)
  })

  it('rejects a path on group entries', () => {
    expect(
      EntryAddInput.safeParse({ ...base, kind: 'group', label: 'ログ', path: 'C:\\x' }).success
    ).toBe(false)
  })

  it('accepts position and rejectTemporary on folder / file entries', () => {
    const r = EntryAddInput.safeParse({
      ...base,
      kind: 'file',
      path: 'C:\\x.txt',
      position: { after: 'e1' },
      rejectTemporary: true
    })
    expect(r.success).toBe(true)
    const folder = { ...base, kind: 'folder', uri: 'file:///C:/x', position: { before: 'e1' } }
    expect(EntryAddInput.safeParse(folder).success).toBe(true)
  })

  it('rejects a position with both before and after, an empty id, or no key', () => {
    const f = { ...base, kind: 'folder', path: 'C:\\x' }
    const both = { ...f, position: { before: 'a', after: 'b' } }
    expect(EntryAddInput.safeParse(both).success).toBe(false)
    expect(EntryAddInput.safeParse({ ...f, position: { before: '' } }).success).toBe(false)
    expect(EntryAddInput.safeParse({ ...f, position: {} }).success).toBe(false)
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

describe('WorkspaceUpdateInput', () => {
  it('allows an empty name (validated against the workspace by the service)', () => {
    expect(WorkspaceUpdateInput.parse({ id: 'default', name: '  ' }).name).toBe('')
  })

  it('rejects a name longer than 100 characters', () => {
    expect(WorkspaceUpdateInput.safeParse({ id: 'w', name: 'あ'.repeat(101) }).success).toBe(false)
  })
})

describe('workspace colour keys', () => {
  it('accepts a colour key and null, rejects free-form colours', () => {
    expect(WorkspaceUpdateInput.safeParse({ id: 'w', color: 'blue' }).success).toBe(true)
    expect(WorkspaceUpdateInput.safeParse({ id: 'w', color: null }).success).toBe(true)
    expect(WorkspaceUpdateInput.safeParse({ id: 'w', color: '#ff0000' }).success).toBe(false)
    expect(WorkspaceCreateInput.safeParse({ name: 'a', color: '#ff0000' }).success).toBe(false)
  })
})

describe('WorkspaceReorderInput', () => {
  it('requires a non-empty list of ids', () => {
    expect(WorkspaceReorderInput.safeParse({ ids: ['a', 'b'] }).success).toBe(true)
    expect(WorkspaceReorderInput.safeParse({ ids: [] }).success).toBe(false)
    expect(WorkspaceReorderInput.safeParse({ ids: [''] }).success).toBe(false)
  })
})
