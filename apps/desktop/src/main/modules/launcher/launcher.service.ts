import { AppError, type LaunchCapabilities, type LaunchMode } from '@pch/shared'
import type { Logger } from '../../infra/logger'
import type { VfsService } from '../../vfs/vfs.service'
import { fileUriToLocalPath } from '../../vfs/local-path'
import { parseDetectOutput, toCapabilities } from './association'
import { DETECT_SCRIPT, LAUNCH_SWITCH_SCRIPT, LAUNCH_VERB_SCRIPT } from './detect-script'
import type { runPowerShell } from './powershell'

/** Office 启动超时（全局约束） */
const LAUNCH_TIMEOUT_MS = 15_000
const DETECT_TIMEOUT_MS = 15_000

interface Deps {
  run: typeof runPowerShell
  vfs: Pick<VfsService, 'stat'>
  logger: Logger
}

/**
 * 文件关联的打开方式检测（按扩展名缓存在内存）与启动（doc 第 10 节）。
 * 路径与 verb 只经环境变量传给固定脚本；不修改文件。
 */
export class LauncherService {
  private readonly cache = new Map<string, LaunchCapabilities>()
  private readonly pending = new Map<string, Promise<LaunchCapabilities>>()
  private generation = 0

  constructor(private readonly deps: Deps) {}

  /** 非 file: URI → FS_UNSUPPORTED_SCHEME。检测失败时返回没有方式的结果（不缓存，下次重试） */
  async capabilities(uri: string): Promise<LaunchCapabilities> {
    return this.capabilitiesOf(extensionOf(fileUriToLocalPath(uri)))
  }

  async open(uri: string, mode: LaunchMode): Promise<void> {
    const target = fileUriToLocalPath(uri)
    await this.deps.vfs.stat(uri)
    const caps = await this.capabilitiesOf(extensionOf(target))
    const option = caps.options.find((o) => o.mode === mode)
    if (!option) throw new AppError({ code: 'LAUNCH_FAILED', detail: `mode ${mode} unavailable` })
    try {
      if (option.via.type === 'verb') {
        await this.deps.run(
          LAUNCH_VERB_SCRIPT,
          { PCH_TARGET: target, PCH_VERB: option.via.verb },
          LAUNCH_TIMEOUT_MS
        )
      } else {
        await this.deps.run(
          LAUNCH_SWITCH_SCRIPT,
          { PCH_EXE: option.via.exe, PCH_ARGS: JSON.stringify([...option.via.args, target]) },
          LAUNCH_TIMEOUT_MS
        )
      }
    } catch (e) {
      this.deps.logger.warn(`[launcher] launch failed (${mode})`, e)
      throw new AppError({
        code: 'LAUNCH_FAILED',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }

  redetect(): void {
    this.generation++
    this.cache.clear()
    this.pending.clear()
  }

  private capabilitiesOf(ext: string): Promise<LaunchCapabilities> {
    if (!ext) return Promise.resolve({ ext, appName: null, options: [] })
    const cached = this.cache.get(ext)
    if (cached) return Promise.resolve(cached)
    let inflight = this.pending.get(ext)
    if (!inflight) {
      inflight = this.detect(ext)
      this.pending.set(ext, inflight)
    }
    return inflight
  }

  private async detect(ext: string): Promise<LaunchCapabilities> {
    const generation = this.generation
    try {
      const out = await this.deps.run(DETECT_SCRIPT, { PCH_EXTS: ext }, DETECT_TIMEOUT_MS)
      const raw = parseDetectOutput(out).find((r) => r.ext.toLowerCase() === ext)
      const caps = raw ? toCapabilities(raw) : { ext, appName: null, options: [] }
      // 检测期间 redetect() 过则丢弃这次结果，不写入缓存
      if (generation === this.generation) this.cache.set(ext, caps)
      return caps
    } catch (e) {
      this.deps.logger.warn(`[launcher] detect failed (${ext})`, e)
      return { ext, appName: null, options: [] }
    } finally {
      if (generation === this.generation) this.pending.delete(ext)
    }
  }
}

/** 不含点的小写扩展名；没有扩展名为空串 */
function extensionOf(localPath: string): string {
  const base = localPath.slice(
    Math.max(localPath.lastIndexOf('\\'), localPath.lastIndexOf('/')) + 1
  )
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}
