import { z } from 'zod'

const id = z.string().min(1)
const name = z.string().trim().min(1).max(100)
const label = z.string().trim().min(1).max(200)
const parentId = id.nullable()

export const WorkspaceCreateInput = z.strictObject({
  name,
  description: z.string().max(500).optional(),
  color: z.string().max(32).optional()
})
export type WorkspaceCreateInput = z.infer<typeof WorkspaceCreateInput>

export const WorkspaceUpdateInput = z.strictObject({
  id,
  name: name.optional(),
  description: z.string().max(500).nullable().optional(),
  color: z.string().max(32).nullable().optional()
})
export type WorkspaceUpdateInput = z.infer<typeof WorkspaceUpdateInput>

/**
 * folder / file 条目以本地路径添加，由主进程转为 URI（pathToFileURL）；
 * label 缺省为路径的最后一段。M4 再扩展为接受远程 URI。
 */
const targetEntry = <K extends 'folder' | 'file'>(kind: K) =>
  z.strictObject({
    kind: z.literal(kind),
    workspaceId: id,
    parentId,
    path: z.string().min(1),
    label: label.optional()
  })

export const EntryAddInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('group'), workspaceId: id, parentId, label }),
  targetEntry('folder'),
  targetEntry('file')
])
export type EntryAddInput = z.infer<typeof EntryAddInput>

export const EntryMetaInput = z.strictObject({
  note: z.string().max(2000).optional(),
  icon: z.string().max(64).optional(),
  color: z.string().max(32).optional()
})

export const EntryUpdateInput = z.strictObject({
  id,
  label: label.optional(),
  meta: EntryMetaInput.nullable().optional()
})
export type EntryUpdateInput = z.infer<typeof EntryUpdateInput>

export const EntryMoveInput = z.strictObject({
  id,
  parentId,
  index: z.number().int().min(0)
})
export type EntryMoveInput = z.infer<typeof EntryMoveInput>
