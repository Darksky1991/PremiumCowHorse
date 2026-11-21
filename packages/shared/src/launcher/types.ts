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
}
