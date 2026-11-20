import path from 'node:path'
import { z } from 'zod'
import { AppError, type LaunchCapabilities, type LaunchOption } from '@pch/shared'

const RawAssociationSchema = z.object({
  ext: z.string(),
  progId: z.string().nullable(),
  defaultVerb: z.string().nullable(),
  verbs: z.array(z.string()),
  appName: z.string().nullable(),
  /** 关联程序的完整路径（检测脚本已确认文件存在）；未知为 null */
  exe: z.string().nullable()
})

/** 检测脚本对一个扩展名的原始输出 */
export type RawAssociation = z.infer<typeof RawAssociationSchema>

export function parseDetectOutput(json: string): RawAssociation[] {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (e) {
    throw new AppError({ code: 'UNKNOWN', detail: `launcher detect: invalid JSON (${String(e)})` })
  }
  const parsed = z.array(RawAssociationSchema).safeParse(value)
  if (!parsed.success) {
    throw new AppError({ code: 'UNKNOWN', detail: `launcher detect: ${parsed.error.message}` })
  }
  return parsed.data
}

/**
 * 原始关联 → 可用的打开方式（只包含检测到的方式；doc 10.3，依据台账 S4 的实测）：
 * - edit：默认 verb（存在于 verbs 时），否则 Open
 * - readOnly：只有关联程序是 EXCEL.EXE 时经官方文档记载的 /r 开关；不从 OpenAsReadOnly 推导（实测以编辑模式打开）
 * - protectedView：ViewProtected（实测只读），无条件显示
 * - newFromFile：New（实测以原文件为蓝本新建）
 * verb 名大小写不敏感，结果沿用注册表中的拼写。
 */
export function toCapabilities(raw: RawAssociation): LaunchCapabilities {
  const options: LaunchOption[] = []
  if (raw.progId) {
    const find = (verb: string): string | undefined =>
      raw.verbs.find((v) => v.toLowerCase() === verb.toLowerCase())
    const edit = (raw.defaultVerb && find(raw.defaultVerb)) || find('Open')
    if (edit) options.push({ mode: 'edit', via: { type: 'verb', verb: edit } })
    if (raw.exe && path.win32.basename(raw.exe).toLowerCase() === 'excel.exe') {
      options.push({ mode: 'readOnly', via: { type: 'switch', exe: raw.exe, args: ['/r'] } })
    }
    const protectedView = find('ViewProtected')
    if (protectedView) {
      options.push({ mode: 'protectedView', via: { type: 'verb', verb: protectedView } })
    }
    const create = find('New')
    if (create) options.push({ mode: 'newFromFile', via: { type: 'verb', verb: create } })
  }
  return { ext: raw.ext, appName: raw.appName, options }
}
