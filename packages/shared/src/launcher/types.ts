/** Office 等文件的打开方式（doc 第 10 节） */
export type LaunchMode = 'edit' | 'readOnly' | 'protectedView' | 'newFromFile'

export const LAUNCH_MODES = [
  'edit',
  'readOnly',
  'protectedView',
  'newFromFile'
] as const satisfies readonly LaunchMode[]

/** 打开方式的实现手段：shell verb，或 Office 官方文档记载的命令行开关（直接启动 exe，不经 shell 拼接） */
export type LaunchVia =
  { type: 'verb'; verb: string } | { type: 'switch'; exe: string; args: string[] }

export interface LaunchOption {
  mode: LaunchMode
  via: LaunchVia
}

export interface LaunchCapabilities {
  /** 不含点的小写扩展名 */
  ext: string
  /** 关联程序的文件描述（如 Microsoft Excel）；检测不到为 null */
  appName: string | null
  /** 只包含检测到的方式 */
  options: LaunchOption[]
  /** 检测本身失败（PowerShell 受限 / 超时等）：与「没有关联」区分，不缓存，可重试 */
  detectFailed?: true
}

/**
 * 启动面板（Office 插件）处理的扩展名（不含点、小写）。主进程 launcher 只对这些扩展名检测与启动，
 * 其他一律拒绝（渲染端传入的 uri 不能借此启动任意程序）。
 * 插件 manifest（plugins/builtin/src/office/index.ts）因分层不能 import shared，保留同一份清单，
 * 一致性由 apps/desktop/src/renderer/src/app/office-extensions.test.ts 保证。
 */
export const OFFICE_EXTENSIONS = [
  'xlsx',
  'xlsm',
  'xls',
  'xltx',
  'xltm',
  'xlsb',
  'docx',
  'docm',
  'doc',
  'dotx',
  'pptx',
  'pptm',
  'ppt',
  'potx'
] as const
