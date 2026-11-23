import type { RecentItem } from '@pch/shared'
import type { EventBus } from '../../core/event-bus'
import type { MainEvents } from '../../core/events'
import type { RecentRepo } from './recent.repo'

/** 最近使用：按工作区记录明确打开的文件 / 目录（设计 devDoc/2026-11-23-42 第 5.D 节） */
export class RecentService {
  constructor(
    private readonly repo: RecentRepo,
    private readonly bus: EventBus<MainEvents>,
    private readonly now: () => number = Date.now
  ) {}

  list(workspaceId: string, limit: number): Promise<RecentItem[]> {
    return this.repo.list(workspaceId, limit)
  }

  async record(input: {
    workspaceId: string
    uri: string
    kind: 'file' | 'directory'
    title: string
  }): Promise<void> {
    const { workspaceId, ...item } = input
    await this.repo.record(workspaceId, item, this.now())
    this.bus.emit('recent.changed', { workspaceId })
  }

  /** 省略 workspaceId = 清除全部 */
  async clear(opts?: { workspaceId?: string }): Promise<void> {
    await this.repo.clear(opts?.workspaceId)
    this.bus.emit('recent.changed', { workspaceId: opts?.workspaceId ?? null })
  }
}
