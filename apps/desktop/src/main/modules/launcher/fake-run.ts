import { DETECT_SCRIPT } from './detect-script'
import type { runPowerShell } from './powershell'
import type { RawAssociation } from './association'

const EXCEL_EXE = 'C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE'

/** 本机实测的 Excel.Sheet.12 / Word.Document.12 形态（台账 S4） */
const SAMPLE: Record<string, RawAssociation> = {
  xlsx: {
    ext: 'xlsx',
    progId: 'Excel.Sheet.12',
    defaultVerb: 'Open',
    verbs: ['Edit', 'New', 'Open', 'OpenAsReadOnly', 'Print', 'Printto', 'ViewProtected'],
    appName: 'Microsoft Excel',
    exe: EXCEL_EXE
  },
  // 空串应用名（检测可能给出）：面板显示通用说法
  docx: {
    ext: 'docx',
    progId: 'Word.Document.12',
    defaultVerb: 'Open',
    verbs: ['Edit', 'New', 'Open', 'Print', 'ViewProtected'],
    appName: '',
    exe: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE'
  }
}

/** 假 run 记录的启动（e2e 经 app.evaluate 读取 globalThis.__pchFakeLaunches） */
export interface FakeLaunch {
  env: Record<string, string>
}

/**
 * 仅 e2e（组合根只在未打包且 PCH_E2E_FAKE_LAUNCHER=1 时注入）：检测返回固定 JSON，启动为空操作（只记录）。
 * 其他扩展名检测不到任何关联（面板退回「既定のアプリで開く」）。
 */
export const fakeRunPowerShell: typeof runPowerShell = async (script, env) => {
  if (script === DETECT_SCRIPT) {
    // e2e 经 app.evaluate 读取：证明重启后没有再检测
    const d = globalThis as unknown as { __pchFakeDetects?: number }
    d.__pchFakeDetects = (d.__pchFakeDetects ?? 0) + 1
    const exts = (env.PCH_EXTS ?? '').split(',').filter(Boolean)
    const out: RawAssociation[] = exts.map(
      (ext) =>
        SAMPLE[ext] ?? { ext, progId: null, defaultVerb: null, verbs: [], appName: null, exe: null }
    )
    return JSON.stringify(out)
  }
  const g = globalThis as unknown as { __pchFakeLaunches?: FakeLaunch[] }
  ;(g.__pchFakeLaunches ??= []).push({ env })
  return ''
}
