import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf-8')

/** 取出以 selector 开头的规则块的文本（不含嵌套；CSS 变量块没有嵌套） */
function block(selector: string): string | null {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) return null
  const end = css.indexOf('}', start)
  return css.slice(start, end)
}
const varNames = (text: string): string[] =>
  [...text.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1] as string)

const EXTENSION = /^--(log|ws|fi|logo)-/
const shadcnVars = varNames(block(':root') ?? '').filter(
  (n) => n !== '--radius' && !EXTENSION.test(n)
)
const NEW_THEMES = ['aitetsu', 'washi', 'matsuba']

describe('globals.css themes', () => {
  it('has 31 shadcn variables in :root', () => {
    expect(shadcnVars).toHaveLength(31)
  })

  it.each(NEW_THEMES)('defines every shadcn variable for %s (light and dark)', (name) => {
    for (const selector of [`[data-theme='${name}']`, `[data-theme='${name}'].dark`]) {
      const b = block(selector)
      expect(b, selector).not.toBeNull()
      const defined = new Set(varNames(b ?? ''))
      expect(
        shadcnVars.filter((v) => !defined.has(v)),
        selector
      ).toEqual([])
    }
  })

  it('defines log and logo tokens for every theme, light and dark', () => {
    const selectors = [':root', '.dark']
    for (const name of NEW_THEMES) {
      selectors.push(`[data-theme='${name}']`, `[data-theme='${name}'].dark`)
    }
    for (const selector of selectors) {
      const defined = new Set(varNames(block(selector) ?? ''))
      for (const token of ['--log-error', '--log-warn', '--log-info', '--log-time']) {
        expect(defined.has(token), `${selector} ${token}`).toBe(true)
      }
      for (const token of ['--logo-base', '--logo-base-2', '--logo-mid', '--logo-accent']) {
        expect(defined.has(token), `${selector} ${token}`).toBe(true)
      }
    }
  })

  it('defines the nine workspace colors in both modes', () => {
    for (const selector of [':root', '.dark']) {
      const defined = new Set(varNames(block(selector) ?? ''))
      for (const key of [
        'blue',
        'teal',
        'green',
        'amber',
        'orange',
        'red',
        'pink',
        'violet',
        'slate'
      ]) {
        expect(defined.has(`--ws-${key}`), `${selector} --ws-${key}`).toBe(true)
      }
    }
  })

  it('maps extension tokens to Tailwind colors', () => {
    for (const token of ['--color-ws-blue', '--color-log-error', '--color-fi-word']) {
      expect(css).toContain(`${token}:`)
    }
  })

  it('places accent rules as :root[data-accent] after the last theme rule', () => {
    expect(css).not.toMatch(/^\[data-accent=/m)
    const accents = [...css.matchAll(/:root\[data-accent='(\w+)'\]/g)]
    expect(accents.map((m) => m[1])).toEqual(['blue', 'green', 'violet', 'orange'])
    const lastTheme = css.lastIndexOf('[data-theme')
    expect(accents[0]?.index).toBeGreaterThan(lastTheme)
  })
})
