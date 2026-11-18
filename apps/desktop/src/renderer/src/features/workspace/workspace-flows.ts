import { AppError, DEFAULT_WORKSPACE_ID } from '@pch/shared'

/** 新建流程的依赖（可注入，便于单元测试步骤编排） */
export interface CreateAndActivateDeps {
  create: (name: string) => Promise<{ id: string }>
  activate: (id: string) => Promise<void>
  /** 创建失败的提示 */
  onCreateError: (e: unknown) => void
  /** 已创建但未能切换的提示 */
  onActivateError: (e: unknown) => void
}

/**
 * 新建并切换。返回 true = 关闭对话框。
 * 创建失败 → false（保持打开可重试）；创建成功后即使切换失败也返回 true，
 * 否则用户再次提交会创建出同名的第二个工作区。
 */
export async function createAndActivate(
  deps: CreateAndActivateDeps,
  name: string
): Promise<boolean> {
  let created: { id: string }
  try {
    created = await deps.create(name)
  } catch (e) {
    deps.onCreateError(e)
    return false
  }
  try {
    await deps.activate(created.id)
  } catch (e) {
    deps.onActivateError(e)
  }
  return true
}

export interface SwitchToDefaultThenRemoveDeps {
  activate: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  onError: (e: unknown) => void
}

/**
 * 删除当前工作区：先切到默认工作区，成功后再删除目标（id 由调用方在开始时锁定）。
 * 先删再切会让主进程按 last_opened_at 落到别的工作区，界面出现错误的中间状态。
 * 返回 true = 关闭对话框；切换失败 → 什么都不删；删除失败 → 已在默认工作区，数据无损。
 */
export async function switchToDefaultThenRemove(
  deps: SwitchToDefaultThenRemoveDeps,
  targetId: string
): Promise<boolean> {
  try {
    await deps.activate(DEFAULT_WORKSPACE_ID)
  } catch (e) {
    deps.onError(e)
    return false
  }
  try {
    await deps.remove(targetId)
  } catch (e) {
    // 已经不存在：删除的目标已达成，静默关闭
    if (e instanceof AppError && e.code === 'WORKSPACE_NOT_FOUND') return true
    deps.onError(e)
    return false
  }
  return true
}
