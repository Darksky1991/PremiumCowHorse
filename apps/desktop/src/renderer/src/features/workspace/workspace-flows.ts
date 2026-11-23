import { AppError, DEFAULT_WORKSPACE_ID, WORKSPACES_URI, type TabsState } from '@pch/shared'

/** 与 workspace.create / update 的校验一致：名称 trim 后最长 100 个字符，说明最长 500 个字符 */
export const MAX_NAME_LENGTH = 100
export const MAX_DESCRIPTION_LENGTH = 500

/** 说明的保存值：trim 后为空即 null */
export function descriptionValue(text: string): string | null {
  const v = text.trim()
  return v === '' ? null : v
}

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

/**
 * 新建时的默认名称（选择器编辑模式的「+」卡片）：base 未被占用就用 base，
 * 否则取「base 2」「base 3」…中最小的空号
 */
export function nextWorkspaceName(names: readonly string[], base: string): string {
  const taken = new Set(names)
  if (!taken.has(base)) return base
  let k = 2
  while (taken.has(`${base} ${k}`)) k += 1
  return `${base} ${k}`
}

export interface RemoveWorkspaceDeps {
  activate: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  onError: (e: unknown) => void
}

/**
 * 删除工作区（targetId 由调用方在开始时锁定）。目标是当前工作区（activeId）时先切到默认工作区，
 * 成功后再删除：先删再切会让主进程按 last_opened_at 落到别的工作区，界面出现错误的中间状态。
 * 当前工作区未知（activeId 为 undefined：查询出错 / 尚无数据）时同样先切到默认工作区——无法排除目标就是当前工作区。
 * 目标不是当前工作区（工作区一览中删除其他工作区）时直接删除、不切换。
 * 返回 true = 关闭对话框；切换失败 → 什么都不删；删除失败 → 数据无损（已在默认工作区或未切换）。
 */
export async function removeWorkspace(
  deps: RemoveWorkspaceDeps,
  targetId: string,
  activeId: string | undefined
): Promise<boolean> {
  if (activeId === undefined || targetId === activeId) {
    try {
      await deps.activate(DEFAULT_WORKSPACE_ID)
    } catch (e) {
      deps.onError(e)
      return false
    }
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

/**
 * 工作区一览卸载之后（React 已提交新的界面），显示它的标签是否应离开一览（后退一步）：
 * 该标签仍存在、仍是其工作区的激活标签、仍在一览，且显示中的工作区（displayedWorkspaceId，
 * 取自 useActiveWorkspace 的查询缓存）已不是该标签所属的工作区——即一览是因为切换工作区而卸载的。
 * 不论从哪里切换（一览中双击 / 新建、地址框的 Layers 菜单、标题栏的切换器）规则都相同；
 * 标签内导航走、关闭标签、切到同一工作区的另一个标签而卸载时不后退。显示中的工作区未知时不后退。
 * 以后切回旧工作区时不停在一览页。后退本身由调用方经 tabs-store 的 backFrom 执行（没有后退历史时不变）
 */
export function listTabToLeave(
  byWorkspace: Readonly<Record<string, TabsState>>,
  tabId: string,
  displayedWorkspaceId: string | undefined
): boolean {
  if (displayedWorkspaceId === undefined) return false
  for (const [workspaceId, state] of Object.entries(byWorkspace)) {
    const tab = state.tabs.find((t) => t.id === tabId)
    if (tab === undefined) continue
    return (
      workspaceId !== displayedWorkspaceId && state.activeId === tabId && tab.uri === WORKSPACES_URI
    )
  }
  return false
}
