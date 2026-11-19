import { describe, expect, it } from 'vitest'
import { iconFor } from './file-icon-map'

describe('iconFor', () => {
  it.each([
    ['a.txt', 'text'],
    ['readme.md', 'text'],
    ['app.log', 'log'],
    ['main.ts', 'code'],
    ['run.py', 'code'],
    ['index.html', 'code'],
    ['data.json', 'json'],
    ['a.xlsx', 'spreadsheet'],
    ['a.xls', 'spreadsheet'],
    ['a.csv', 'spreadsheet'],
    ['a.docx', 'document'],
    ['a.doc', 'document'],
    ['a.pptx', 'presentation'],
    ['a.ppt', 'presentation'],
    ['a.pdf', 'pdf'],
    ['a.png', 'image'],
    ['a.jpeg', 'image'],
    ['a.mp3', 'audio'],
    ['a.mp4', 'video'],
    ['a.zip', 'archive'],
    ['a.7z', 'archive'],
    ['a.exe', 'executable'],
    ['a.bat', 'executable'],
    ['a.ps1', 'executable'],
    ['a.ini', 'config'],
    ['a.conf', 'config'],
    ['a.yaml', 'config'],
    ['a.yml', 'config'],
    ['a.toml', 'config'],
    ['a.properties', 'config']
  ])('文件 %s → %s', (name, expected) => {
    expect(iconFor(name, 'file')).toBe(expected)
  })

  it('扩展名大小写不敏感', () => {
    expect(iconFor('REPORT.PDF', 'file')).toBe('pdf')
    expect(iconFor('Data.JSON', 'file')).toBe('json')
  })

  it('未知 / 无扩展名 / 隐藏文件 → 兜底', () => {
    expect(iconFor('a.unknownext', 'file')).toBe('file')
    expect(iconFor('Makefile', 'file')).toBe('file')
    expect(iconFor('.gitignore', 'file')).toBe('file')
  })

  it('以最后一个扩展名为准', () => {
    expect(iconFor('a.tar.gz', 'file')).toBe('archive')
    expect(iconFor('a.pdf.txt', 'file')).toBe('text')
  })

  it('目录与链接', () => {
    expect(iconFor('x.pdf', 'directory')).toBe('folder')
    expect(iconFor('x', 'symlink', 'directory')).toBe('folder-link')
    expect(iconFor('x.pdf', 'symlink', 'file')).toBe('file-link')
    expect(iconFor('x', 'symlink', null)).toBe('link-broken')
    expect(iconFor('x', 'symlink')).toBe('link-broken')
  })
})
