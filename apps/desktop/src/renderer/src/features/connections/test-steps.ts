import type { ConnectionTestResult, ConnectionTestStep, ConnectionTestStepKind } from '@pch/shared'

/** 一行：实际执行的步骤，或因前面失败而未执行的步骤（step = null） */
export interface TestRow {
  key: string
  kind: ConnectionTestStepKind
  identity?: string
  step: ConnectionTestStep | null
}

const FIXED: ConnectionTestStepKind[] = ['connect', 'hostKey', 'auth', 'sftp']

/**
 * 测试连接的步骤（设计 5.8）：连接 → 主机密钥 → 认证 → SFTP → 每个身份的切换。
 * 主进程在第一次失败（或第一次 sudo 认证失败）后停止，之后的步骤显示为「未执行」
 */
export function testRows(result: ConnectionTestResult, identities: readonly string[]): TestRow[] {
  const rows: TestRow[] = []
  const ran = new Set<string>()
  const keyOf = (kind: ConnectionTestStepKind, identity?: string): string =>
    kind === 'identity' ? `identity:${identity ?? ''}` : kind
  for (const step of result.steps) {
    const key = keyOf(step.step, step.identity)
    ran.add(key)
    rows.push({ key, kind: step.step, identity: step.identity, step })
  }
  const expected: { kind: ConnectionTestStepKind; identity?: string }[] = [
    ...FIXED.map((kind) => ({ kind })),
    ...identities.map((identity) => ({ kind: 'identity' as const, identity }))
  ]
  for (const e of expected) {
    const key = keyOf(e.kind, e.identity)
    if (!ran.has(key)) rows.push({ key, kind: e.kind, identity: e.identity, step: null })
  }
  return rows
}
