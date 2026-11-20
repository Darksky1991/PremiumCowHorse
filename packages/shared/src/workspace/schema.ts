import { z } from 'zod'
import { CACHE_STRATEGIES } from '../scanner/types'

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
  // 允许空字符串：仅默认工作区可用来恢复本地化的默认名称（由服务层校验）
  name: z.string().trim().max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  color: z.string().max(32).nullable().optional()
})
export type WorkspaceUpdateInput = z.infer<typeof WorkspaceUpdateInput>

/**
 * folder / file 条目以本地路径（path，由主进程转为 file URI）或 URI（uri，由 VFS 校验）添加，
 * 二者恰好提供一个；label 缺省为目标的显示名称。
 */
const targetFields = {
  workspaceId: id,
  parentId,
  path: z.string().min(1).optional(),
  uri: z.string().min(1).optional(),
  label: label.optional(),
  /** 插在 parentId 下某个同级条目之前 / 之后（该条目必须在同一父节点下）；缺省为追加到末尾 */
  position: z.union([z.strictObject({ before: id }), z.strictObject({ after: id })]).optional(),
  /** 来自系统拖入：路径位于系统临时目录之下时拒绝（ENTRY_TEMPORARY_PATH，例如压缩包内的文件） */
  rejectTemporary: z.boolean().optional()
}
const exactlyOneTarget = (v: { path?: string; uri?: string }): boolean =>
  (v.path === undefined) !== (v.uri === undefined)

export const EntryAddInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('group'), workspaceId: id, parentId, label }),
  z.strictObject({ kind: z.literal('folder'), ...targetFields }).refine(exactlyOneTarget, {
    message: 'exactly one of path and uri is required'
  }),
  z.strictObject({ kind: z.literal('file'), ...targetFields }).refine(exactlyOneTarget, {
    message: 'exactly one of path and uri is required'
  })
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

export const CacheStrategySchema = z.enum(CACHE_STRATEGIES)

export const EntrySetCacheStrategyInput = z.strictObject({
  workspaceId: id,
  entryId: id,
  /** null = 清除条目级设置，沿用全局默认 */
  strategy: CacheStrategySchema.nullable()
})
export type EntrySetCacheStrategyInput = z.infer<typeof EntrySetCacheStrategyInput>

export const IndexSetTargetInput = z.strictObject({
  workspaceId: id,
  uri: z.string().min(1),
  enabled: z.boolean()
})
export type IndexSetTargetInput = z.infer<typeof IndexSetTargetInput>

export const EntryMoveInput = z.strictObject({
  id,
  parentId,
  index: z.number().int().min(0)
})
export type EntryMoveInput = z.infer<typeof EntryMoveInput>
