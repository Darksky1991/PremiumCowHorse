import { z } from 'zod'
import { ERROR_CODES, type AppErrorPayload } from '../errors/app-error'
import type { SearchQuery } from '../search/types'
import type { Interest, RawEntry, ReachabilityEvent, RootConfig, ScanSettings } from './types'

/**
 * 主进程（ScannerClient）与扫描进程（utilityProcess）之间的消息。两端收到的消息都先用
 * zod 校验（与 IPC 契约同样的做法），无效消息记日志并忽略。
 * 请求–响应型消息带 id（主进程分配），扫描进程以 result { id } 回应；其余消息不回应。
 * 远程目录（sftp:）方向相反：扫描进程发 remoteOp { id }（id 由扫描进程分配，与上面的请求 id 是两个
 * 独立的编号空间），主进程以 remoteResult { id } 回应；扫描进程不再需要时发 remoteCancel { id }。
 */

const uri = z.string().min(1)
/** 请求 id 与窗口（webContents）id */
const id = z.number().int().nonnegative()

const RootConfigSchema = z.strictObject({
  entryId: z.string().min(1),
  workspaceId: z.string().min(1),
  uri,
  strategy: z.enum(['passive', 'default', 'active', 'all']),
  location: z.enum(['local', 'network', 'remote'])
}) satisfies z.ZodType<RootConfig>

const Pair = z.strictObject({ local: z.number().positive(), network: z.number().positive() })

const Triple = z.strictObject({
  local: z.number().positive(),
  network: z.number().positive(),
  remote: z.number().positive()
})

const ScanSettingsSchema = z.strictObject({
  interval: z.strictObject({ focus: Pair, near: Pair, far: Pair }),
  backgroundGapMs: Triple,
  timeoutSec: Triple,
  remoteIndexIntervalSec: z.number().positive(),
  activeDepth: z.number().int().nonnegative()
}) satisfies z.ZodType<ScanSettings>

/** 扫描配置：roots 为参与调度的根，allRootUris 为所有工作区的 folder 条目（缓存只保存其下的目录） */
export const ScannerConfig = z.strictObject({
  roots: z.array(RootConfigSchema),
  allRootUris: z.array(uri),
  indexTargets: z.array(uri),
  settings: ScanSettingsSchema
})
export type ScannerConfig = z.infer<typeof ScannerConfig>

const InterestSchema = z.strictObject({
  focus: uri.nullable(),
  visible: z.array(uri),
  offscreen: z.array(uri),
  tabs: z.array(uri)
}) satisfies z.ZodType<Interest>

const ReachabilitySchema = z.strictObject({
  share: z.string().min(1),
  state: z.enum(['online', 'offline']),
  since: z.number()
}) satisfies z.ZodType<ReachabilityEvent>

const SearchQuerySchema = z.strictObject({
  scopes: z.array(z.strictObject({ uri, entryId: z.string().min(1), label: z.string() })),
  terms: z.array(z.strictObject({ kind: z.enum(['contains', 'glob']), value: z.string().min(1) })),
  kind: z.enum(['all', 'file', 'directory']),
  showHidden: z.boolean(),
  limit: z.number().int().min(1).max(1000)
}) satisfies z.ZodType<SearchQuery>

const AppErrorPayloadSchema = z.strictObject({
  code: z.enum(ERROR_CODES),
  detail: z.string().optional()
}) satisfies z.ZodType<AppErrorPayload>

/** 远程目录的一个子项（RawEntry）：主进程 remoteResult 的 list 结果的元素 */
export const RawEntrySchema = z.strictObject({
  // 子项 URI 由目录 URI 与 name 拼成：. / .. / 含 / 的名称会指向别的目录，不接受
  name: z
    .string()
    .min(1)
    .refine((n) => n !== '.' && n !== '..' && !n.includes('/'), 'not a single path segment'),
  kind: z.enum(['file', 'directory', 'symlink']),
  target: z.enum(['file', 'directory']).nullable().optional(),
  size: z.number().nonnegative(),
  mtime: z.number(),
  hidden: z.boolean(),
  owner: z.string().optional()
}) satisfies z.ZodType<RawEntry>

/** remoteOp stat 的结果（目录自身的修改时间；不是目录时主进程以 FS_NOT_A_DIRECTORY 失败） */
export const RemoteStatValue = z.strictObject({ mtime: z.number() })
/** remoteOp list 的结果 */
export const RemoteListValue = z.array(RawEntrySchema)

/** 主进程 → 扫描进程 */
export const MainToScanner = z.discriminatedUnion('type', [
  /** fork 后的第一条消息：缓存库文件（userData/cache/index.db） */
  z.strictObject({ type: z.literal('init'), cacheFile: z.string().min(1) }),
  z.strictObject({ type: z.literal('configure'), config: ScannerConfig }),
  /** → result { value: DirectoryListing } */
  z.strictObject({ type: z.literal('list'), id, uri }),
  z.strictObject({ type: z.literal('interest'), ownerId: id, ...InterestSchema.shape }),
  z.strictObject({ type: z.literal('windowFocus'), ownerId: id, focused: z.boolean() }),
  z.strictObject({ type: z.literal('releaseOwner'), ownerId: id }),
  z.strictObject({ type: z.literal('refresh'), uris: z.array(uri) }),
  /** → result { value: { bytes } } */
  z.strictObject({ type: z.literal('cacheInfo'), id }),
  /** → result { value: undefined } */
  z.strictObject({ type: z.literal('clearCache'), id }),
  /** → result { value: SearchResult }；只读缓存，同步执行（无法中途打断） */
  z.strictObject({ type: z.literal('search'), id, ...SearchQuerySchema.shape }),
  /** 保留：搜索是同步 SQL，无法中途打断；主进程客户端以丢弃旧结果实现取消，不发送本消息 */
  z.strictObject({ type: z.literal('cancel'), id }),
  z.strictObject({ type: z.literal('shutdown') }),
  /** remoteOp 的结果；value 的结构由扫描进程按 op 校验（RemoteStatValue / RemoteListValue） */
  z.discriminatedUnion('ok', [
    z.strictObject({
      type: z.literal('remoteResult'),
      id,
      ok: z.literal(true),
      value: z.unknown()
    }),
    z.strictObject({
      type: z.literal('remoteResult'),
      id,
      ok: z.literal(false),
      error: AppErrorPayloadSchema
    })
  ])
])
export type MainToScanner = z.infer<typeof MainToScanner>

/** 扫描进程 → 主进程 */
export const ScannerToMain = z.discriminatedUnion('type', [
  /** value 的类型由请求决定（只校验外层结构） */
  z.discriminatedUnion('ok', [
    z.strictObject({ type: z.literal('result'), id, ok: z.literal(true), value: z.unknown() }),
    z.strictObject({
      type: z.literal('result'),
      id,
      ok: z.literal(false),
      error: AppErrorPayloadSchema
    })
  ]),
  /** 目录的缓存内容（列表或状态）有变化 */
  z.strictObject({ type: z.literal('changed'), uri }),
  z.strictObject({ type: z.literal('reachability'), ...ReachabilitySchema.shape }),
  z.strictObject({
    type: z.literal('log'),
    level: z.enum(['info', 'warn', 'error']),
    message: z.string()
  }),
  /** 缓存库已打开、调度器已就绪 */
  z.strictObject({ type: z.literal('ready') }),
  /** 远程目录的读取请求（主进程经 SftpProvider 执行）→ remoteResult { id } */
  z.strictObject({
    type: z.literal('remoteOp'),
    id,
    op: z.enum(['stat', 'list']),
    uri,
    /** 用户操作发起（断线时重连并重试一次）；后台读取为 false */
    userAction: z.boolean()
  }),
  /** 扫描进程已不需要该 remoteOp 的结果（中止 / 超时）：主进程中止它，不再发送结果 */
  z.strictObject({ type: z.literal('remoteCancel'), id })
])
export type ScannerToMain = z.infer<typeof ScannerToMain>
