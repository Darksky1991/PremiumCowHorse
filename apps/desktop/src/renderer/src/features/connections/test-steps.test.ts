import { describe, expect, it } from 'vitest'
import { testRows } from './test-steps'

describe('testRows', () => {
  it('全部成功：按执行顺序列出，身份步骤带身份名', () => {
    const rows = testRows(
      {
        steps: [
          { step: 'connect', ok: true },
          { step: 'hostKey', ok: true },
          { step: 'auth', ok: true },
          { step: 'sftp', ok: true, info: { home: '/home/a' } },
          { step: 'identity', identity: 'app1', ok: true, info: { mode: 'nopty' } }
        ]
      },
      ['app1']
    )
    expect(rows.map((r) => [r.key, r.step?.ok])).toEqual([
      ['connect', true],
      ['hostKey', true],
      ['auth', true],
      ['sftp', true],
      ['identity:app1', true]
    ])
  })

  it('中途失败：之后的步骤（含未测试的身份）显示为未执行', () => {
    const rows = testRows(
      {
        steps: [
          { step: 'connect', ok: true },
          { step: 'hostKey', ok: true },
          { step: 'auth', ok: false, error: { code: 'CONN_AUTH_FAILED' } }
        ]
      },
      ['app1', 'root']
    )
    expect(rows.map((r) => [r.key, r.step === null ? null : r.step.ok])).toEqual([
      ['connect', true],
      ['hostKey', true],
      ['auth', false],
      ['sftp', null],
      ['identity:app1', null],
      ['identity:root', null]
    ])
  })

  it('第一次 sudo 认证失败后停止：其余身份未执行', () => {
    const rows = testRows(
      {
        steps: [
          { step: 'connect', ok: true },
          { step: 'hostKey', ok: true },
          { step: 'auth', ok: true },
          { step: 'sftp', ok: true },
          {
            step: 'identity',
            identity: 'app1',
            ok: false,
            error: { code: 'CONN_SUDO_AUTH_FAILED' }
          }
        ]
      },
      ['app1', 'root']
    )
    expect(rows.slice(-2).map((r) => [r.key, r.identity, r.step?.ok ?? null])).toEqual([
      ['identity:app1', 'app1', false],
      ['identity:root', 'root', null]
    ])
  })
})
