import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDetectOutput } from './association'
import { DETECT_SCRIPT, LAUNCH_SWITCH_SCRIPT, LAUNCH_VERB_SCRIPT } from './detect-script'
import { runPowerShell } from '../../infra/powershell'

describe('fixed PowerShell scripts', () => {
  it.each([
    ['detect', DETECT_SCRIPT],
    ['launch verb', LAUNCH_VERB_SCRIPT],
    ['launch switch', LAUNCH_SWITCH_SCRIPT]
  ])('%s: ASCII only, no double quote, no Start-Process', (_name, script) => {
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7f]*$/.test(script)).toBe(true)
    expect(script).not.toContain('"')
    expect(script).not.toContain('Start-Process')
  })
})

// 真实的 Windows PowerShell（不启动任何程序、不改任何数据）
describe.skipIf(process.platform !== 'win32')('fixed PowerShell scripts on real PowerShell', () => {
  it('detect output of any extensions (also a single one, and an unknown one) passes the zod check', async () => {
    const one = parseDetectOutput(await runPowerShell(DETECT_SCRIPT, { PCH_EXTS: 'txt' }, 20_000))
    expect(one.map((r) => r.ext)).toEqual(['txt'])
    const two = parseDetectOutput(
      await runPowerShell(DETECT_SCRIPT, { PCH_EXTS: 'txt,pchnosuchext' }, 20_000)
    )
    expect(two.find((r) => r.ext === 'pchnosuchext')).toEqual({
      ext: 'pchnosuchext',
      progId: null,
      defaultVerb: null,
      verbs: [],
      appName: null,
      exe: null
    })
  }, 30_000)

  it('the switch script builds arguments: switch unquoted, path quoted (spaces, brackets, Japanese)', async () => {
    // 只把「启动」换成「输出 Arguments」，其余照用真实脚本
    const dry = LAUNCH_SWITCH_SCRIPT.replace(
      '[void][System.Diagnostics.Process]::Start($psi)',
      'Write-Output $psi.Arguments'
    )
    const target = String.raw`C:\a b\見積[1] 案.xlsx`
    const out = await runPowerShell(
      dry,
      { PCH_EXE: 'x.exe', PCH_ARGS: JSON.stringify(['/r', target]) },
      20_000
    )
    expect(out.trim()).toBe(`/r "${target}"`)
  }, 30_000)

  it('the switch script returns without waiting for the launched program (no inherited stdout pipe)', async () => {
    // 孙进程：wscript 运行一个睡 6 秒的 vbs（不启动 Office）；脚本应在 PowerShell 启动时间内返回
    const dir = mkdtempSync(path.join(tmpdir(), 'pch-launch-'))
    try {
      const vbs = path.join(dir, 'sleep.vbs')
      writeFileSync(vbs, 'WScript.Sleep 6000')
      const started = Date.now()
      await runPowerShell(
        LAUNCH_SWITCH_SCRIPT,
        { PCH_EXE: 'wscript.exe', PCH_ARGS: JSON.stringify([vbs]) },
        15_000
      )
      expect(Date.now() - started).toBeLessThan(3000)
    } finally {
      // wscript 会在 6 秒后自行退出；目录可能仍被占用，忽略删除失败
      setTimeout(() => rmSync(dir, { recursive: true, force: true }), 7000).unref()
    }
  }, 30_000)
})
