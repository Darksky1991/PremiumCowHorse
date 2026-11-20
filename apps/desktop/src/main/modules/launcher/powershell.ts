import { execFile } from 'node:child_process'

/**
 * 运行固定脚本，返回 stdout。脚本不拼接任何数据，输入只经 env（与 process.env 合并）。
 * 超时、非零退出码、无法启动都以拒绝返回。
 */
export function runPowerShell(
  script: string,
  env: Record<string, string>,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        windowsHide: true,
        timeout: timeoutMs,
        encoding: 'utf8',
        env: { ...process.env, ...env }
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`${error.message}${stderr ? `\n${stderr}` : ''}`))
        else resolve(stdout)
      }
    )
  })
}
