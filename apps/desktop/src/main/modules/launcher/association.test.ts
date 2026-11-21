import { describe, expect, it } from 'vitest'
import { AppError } from '@pch/shared'
import { parseDetectOutput, toCapabilities, type RawAssociation } from './association'

/** 本机实测的 Excel.Sheet.12（台账 S4） */
const EXCEL: RawAssociation = {
  ext: 'xlsx',
  progId: 'Excel.Sheet.12',
  defaultVerb: 'Open',
  verbs: ['Edit', 'New', 'Open', 'OpenAsReadOnly', 'Print', 'Printto', 'ViewProtected'],
  appName: 'Microsoft Excel',
  exe: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE'
}
const WORD: RawAssociation = {
  ...EXCEL,
  ext: 'docx',
  progId: 'Word.Document.12',
  appName: 'Microsoft Word',
  exe: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE'
}
const NONE: RawAssociation = {
  ext: 'xyz',
  progId: null,
  defaultVerb: null,
  verbs: [],
  appName: null,
  exe: null
}

describe('parseDetectOutput', () => {
  it('parses the array output of the detect script', () => {
    expect(parseDetectOutput(JSON.stringify([EXCEL]))).toEqual([EXCEL])
  })

  it('accepts null fields for an extension without association', () => {
    expect(parseDetectOutput(JSON.stringify([NONE]))).toEqual([NONE])
  })

  it('throws AppError UNKNOWN for invalid JSON and for a wrong shape', () => {
    expect(() => parseDetectOutput('not json')).toThrow(AppError)
    expect(() => parseDetectOutput('{"ext":"xlsx"}')).toThrow(AppError)
    expect(() => parseDetectOutput('[{"ext":1}]')).toThrow(/UNKNOWN/)
  })
})

describe('toCapabilities', () => {
  it('Excel: edit / protectedView / newFromFile by verb, readOnly by the /r switch', () => {
    const caps = toCapabilities(EXCEL)
    expect(caps.ext).toBe('xlsx')
    expect(caps.appName).toBe('Microsoft Excel')
    expect(caps.options).toEqual([
      { mode: 'edit', via: { type: 'verb', verb: 'Open' } },
      { mode: 'readOnly', via: { type: 'switch', exe: EXCEL.exe, args: ['/r'] } },
      { mode: 'protectedView', via: { type: 'verb', verb: 'ViewProtected' } },
      { mode: 'newFromFile', via: { type: 'verb', verb: 'New' } }
    ])
  })

  it('never derives readOnly from OpenAsReadOnly (it opens in edit mode on this machine)', () => {
    const caps = toCapabilities(WORD)
    expect(caps.options.map((o) => o.mode)).toEqual(['edit', 'protectedView', 'newFromFile'])
    expect(JSON.stringify(caps)).not.toContain('OpenAsReadOnly')
  })

  it('shows protectedView even though OpenAsReadOnly exists', () => {
    const raw = { ...WORD, verbs: ['Open', 'OpenAsReadOnly', 'ViewProtected'] }
    expect(toCapabilities(raw).options.map((o) => o.mode)).toEqual(['edit', 'protectedView'])
  })

  it('edit uses the default verb when it exists, else Open; verb names are case-insensitive', () => {
    const raw = { ...WORD, defaultVerb: 'edit', verbs: ['EDIT', 'open', 'viewprotected'] }
    expect(toCapabilities(raw).options).toEqual([
      { mode: 'edit', via: { type: 'verb', verb: 'EDIT' } },
      { mode: 'protectedView', via: { type: 'verb', verb: 'viewprotected' } }
    ])
    const noDefault = { ...WORD, defaultVerb: null, verbs: ['open'] }
    expect(toCapabilities(noDefault).options).toEqual([
      { mode: 'edit', via: { type: 'verb', verb: 'open' } }
    ])
  })

  it('an empty app name (no FriendlyAppName) is null', () => {
    expect(toCapabilities({ ...EXCEL, appName: '' }).appName).toBeNull()
    expect(toCapabilities({ ...EXCEL, appName: '  ' }).appName).toBeNull()
  })

  it('has no options without a ProgId', () => {
    expect(toCapabilities(NONE)).toEqual({ ext: 'xyz', appName: null, options: [] })
  })

  it('does not add the /r switch without an exe path or for other programs', () => {
    const modes = (raw: RawAssociation): string[] => toCapabilities(raw).options.map((o) => o.mode)
    expect(modes({ ...EXCEL, exe: null })).not.toContain('readOnly')
    expect(modes({ ...EXCEL, exe: 'C:\\Apps\\other.exe' })).not.toContain('readOnly')
  })
})
