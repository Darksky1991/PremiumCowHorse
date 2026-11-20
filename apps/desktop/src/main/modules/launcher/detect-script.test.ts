import { describe, expect, it } from 'vitest'
import { parseDetectOutput } from './association'
import { DETECT_SCRIPT, LAUNCH_SWITCH_SCRIPT, LAUNCH_VERB_SCRIPT } from './detect-script'
import { runPowerShell } from './powershell'

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
})
