import { describe, expect, it } from 'vitest'
import { iconFor } from './file-icon-map'

describe('iconFor', () => {
  it.each([
    ['a.txt', 'text'],
    ['readme.md', 'markdown'],
    ['app.log', 'log'],
    ['main.ts', 'code'],
    ['run.py', 'code'],
    ['index.html', 'code'],
    ['data.json', 'json'],
    ['a.xlsx', 'spreadsheet'],
    ['a.xls', 'spreadsheet'],
    ['a.csv', 'csv'],
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
    ['a.bat', 'script'],
    ['a.ps1', 'script'],
    ['a.ini', 'config'],
    ['a.conf', 'config'],
    ['a.yaml', 'config'],
    ['a.yml', 'config'],
    ['a.toml', 'config'],
    ['a.properties', 'config'],
    ['report.docx', 'document'],
    ['a.rtf', 'document'],
    ['a.msg', 'mail'],
    ['a.md', 'markdown'],
    ['run.sh', 'script'],
    ['a.sql', 'sql'],
    ['a.dmp', 'database'],
    ['a.pem', 'cert'],
    ['a.jar', 'package'],
    ['a.xml', 'config'],
    ['a.json', 'json'],
    ['a.url', 'executable']
  ])('文件 %s → %s', (name, expected) => {
    expect(iconFor(name, 'file')).toBe(expected)
  })

  it('扩展名大小写不敏感', () => {
    expect(iconFor('REPORT.PDF', 'file')).toBe('pdf')
    expect(iconFor('Data.JSON', 'file')).toBe('json')
  })

  it('未知 / 无扩展名 / 隐藏文件 → 兜底', () => {
    expect(iconFor('a.unknownext', 'file')).toBe('file')
    expect(iconFor('core.48211', 'file')).toBe('file')
    expect(iconFor('LICENSE', 'file')).toBe('file')
  })

  it('无扩展名的常见文件按全名映射', () => {
    expect(iconFor('Dockerfile', 'file')).toBe('config')
    expect(iconFor('dockerfile', 'file')).toBe('config')
    expect(iconFor('Makefile', 'file')).toBe('script')
    expect(iconFor('.gitignore', 'file')).toBe('config')
    expect(iconFor('.env', 'file')).toBe('config')
    expect(iconFor('.env.production', 'file')).toBe('config')
  })

  it.each(['app.log.1', 'app.log.2026-11-01', 'app.log.gz', 'APP.LOG.2', 'catalina.out.3'])(
    '轮转日志 %s → log',
    (name) => {
      expect(iconFor(name, 'file')).toBe('log')
    }
  )

  it('普通压缩包不被轮转日志规则吞掉', () => {
    expect(iconFor('backup.gz', 'file')).toBe('archive')
    expect(iconFor('logs.zip', 'file')).toBe('archive')
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
