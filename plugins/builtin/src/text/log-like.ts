/**
 * 日志类文件（设计 3.5、7.3）：打开时在末尾并跟随。
 * `.log` / `.out`、轮转名（`*.log.<数字>`、`*.log.<日期>`）与 sniff 判为文本的无扩展名文件（`messages` 等）
 */
const LOG_NAME = /\.(log|out)$/i
/** 轮转名：.log. 之后是数字（`app.log.1`）或日期（`app.log.2026-11-20`、`app.log.2026_11_20`） */
const ROTATED_LOG_NAME = /\.log\.\d+(?:[-_]\d+)*$/i

export function isLogLike(name: string, sniffedWithoutExtension: boolean): boolean {
  return sniffedWithoutExtension || LOG_NAME.test(name) || ROTATED_LOG_NAME.test(name)
}

/** 名称是否带扩展名：最后一个点之后有字符、且点不在开头（`.gitignore` 视为无扩展名） */
export function hasExtension(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1
}
