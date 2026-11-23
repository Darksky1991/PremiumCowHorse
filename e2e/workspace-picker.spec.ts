import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { data, launch, removeDirs } from './support'

/**
 * 工作区选择器（M5 Task 12）：圆环 / 列表与菜单式。
 * 圆环中「正面卡片」= aria-selected 的 option；侧面卡片带 data-offset（±1 / ±2）。
 */
test.describe('workspace picker', () => {
  let userData: string

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'pch-e2e-'))
  })
  test.afterEach(() => {
    removeDirs(userData)
  })

  /** 日语界面；默认工作区之后建 4 个，当前为「物流WMS」（sortOrder 第 2 个） */
  async function setup(page: Page): Promise<Record<string, string>> {
    await data(page, 'settings.set', { 'general.language': 'ja' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
    const ids: Record<string, string> = {}
    for (const name of ['物流WMS', 'バッチ移行', '経理', '共通']) {
      ids[name] = (await data(page, 'workspace.create', { name })).id
    }
    await data(page, 'workspace.update', { id: ids['共通']!, description: 'バッチ以外の雑務' })
    await data(page, 'workspace.activate', { id: ids['物流WMS']! })
    await expect(titleButton(page)).toHaveText('物流WMS')
    return ids
  }

  const titleButton = (page: Page): Locator =>
    page.getByRole('banner').getByRole('button', { name: 'ワークスペースの切り替え' })
  const addressButton = (page: Page): Locator =>
    page
      .getByRole('navigation', { name: 'アドレスバー' })
      .getByRole('button', { name: 'ワークスペースの切り替え', exact: true })
  const dialog = (page: Page): Locator => page.getByRole('dialog')
  const filter = (page: Page): Locator => dialog(page).getByRole('combobox')
  const front = (page: Page): Locator => dialog(page).getByRole('option', { selected: true })
  const card = (page: Page, offset: number): Locator =>
    dialog(page).locator(`[data-workspace-card][data-offset="${offset}"]`)

  async function openWithAltW(page: Page): Promise<void> {
    await page.keyboard.press('Alt+w')
    await expect(dialog(page)).toBeVisible()
    await expect(filter(page)).toBeFocused()
  }

  test('Alt+W opens with the current workspace in front; a side card only turns; → then Enter switches', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await openWithAltW(page)
      await expect(front(page)).toContainText('物流WMS')
      await expect(front(page)).toContainText('使用中')
      await expect(filter(page)).toHaveAttribute(
        'aria-activedescendant',
        (await front(page).getAttribute('id'))!
      )
      // 5 件：正面 ±2 全部显示；位置圆点 5 个
      await expect(dialog(page).getByRole('option')).toHaveCount(5)
      await expect(dialog(page).locator('[data-slot="picker-indicator"] button')).toHaveCount(5)

      // 侧面卡片：单击只转到正面，不切换（双击也只是转过来）
      await card(page, 1).dblclick()
      await expect(front(page)).toContainText('バッチ移行')
      await expect(dialog(page)).toBeVisible()
      expect((await data(page, 'workspace.active')).name).toBe('物流WMS')
      // 焦点仍在筛选框
      await expect(filter(page)).toBeFocused()

      // → で回転、Enter で切り替え → 面板关闭、标题栏更新、toast
      await page.keyboard.press('ArrowRight')
      await expect(front(page)).toContainText('経理')
      await page.keyboard.press('Enter')
      await expect(dialog(page)).toHaveCount(0)
      await expect(titleButton(page)).toHaveText('経理')
      await expect(page.getByText('「経理」に切り替えました')).toBeVisible()
      expect((await data(page, 'workspace.active')).name).toBe('経理')

      // 正面卡片：过了保护期后单击切换
      await openWithAltW(page)
      await expect(front(page)).toContainText('経理')
      await page.keyboard.press('ArrowLeft')
      await expect(front(page)).toContainText('バッチ移行')
      await page.waitForTimeout(300)
      await front(page).click()
      await expect(dialog(page)).toHaveCount(0)
      await expect(titleButton(page)).toHaveText('バッチ移行')
    } finally {
      await app.close()
    }
  })

  test('typing filters (hiragana matches katakana) and Enter switches to the best match; Alt+2 picks directly; Esc clears then closes', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await openWithAltW(page)
      // 「ばっち」：名称前缀「バッチ移行」> 说明包含「共通」；结果保持原顺序，最佳匹配在正面
      await filter(page).fill('ばっち')
      await expect(dialog(page).getByRole('option')).toHaveCount(2)
      await expect(front(page)).toContainText('バッチ移行')
      await expect(dialog(page).getByText('2 / 5')).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(dialog(page)).toHaveCount(0)
      await expect(titleButton(page)).toHaveText('バッチ移行')

      // 无结果
      await openWithAltW(page)
      await filter(page).fill('xyz')
      await expect(
        dialog(page).getByText('「xyz」に一致するワークスペースはありません')
      ).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(dialog(page)).toBeVisible()
      // Esc 两级：先清空筛选词（面板仍开），再按关闭
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toBeVisible()
      await expect(filter(page)).toHaveValue('')
      await expect(dialog(page).getByRole('option')).toHaveCount(5)
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toHaveCount(0)

      // 单按数字进筛选框；Alt+2 按 sortOrder 直选第 2 个（筛选中也有效）
      await openWithAltW(page)
      await page.keyboard.press('2')
      await expect(filter(page)).toHaveValue('2')
      await page.keyboard.press('Alt+2')
      await expect(dialog(page)).toHaveCount(0)
      await expect(titleButton(page)).toHaveText('物流WMS')

      // 标题栏按钮打开、Esc 关闭后焦点回到按钮；Alt+W 再按一次也关闭
      await titleButton(page).click()
      await expect(dialog(page)).toBeVisible()
      await expect(filter(page)).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toHaveCount(0)
      await expect(titleButton(page)).toBeFocused()
      await openWithAltW(page)
      await page.keyboard.press('Alt+w')
      await expect(dialog(page)).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('with reduced motion the ring moves at once (only opacity fades) and still switches', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await data(page, 'settings.set', { 'appearance.reduceMotion': 'on' })
      await openWithAltW(page)
      await page.keyboard.press('ArrowRight')
      await expect(front(page)).toContainText('バッチ移行')
      // 位移瞬间到位：新的正面卡片没有残留的平移 / 倾斜
      await page.waitForTimeout(40)
      expect(await card(page, 0).evaluate((el) => el.style.transform)).toMatch(/^(none|)$/)
      await page.keyboard.press('Enter')
      await expect(dialog(page)).toHaveCount(0)
      await expect(titleButton(page)).toHaveText('バッチ移行')
    } finally {
      await app.close()
    }
  })

  test('the list view switches on a single click and is remembered; the detail switch shows entries', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await addressButton(page).click()
      await expect(dialog(page)).toBeVisible()
      await dialog(page).getByRole('button', { name: 'リスト' }).click()
      const list = dialog(page).getByRole('listbox')
      await expect(list).toHaveAttribute('aria-orientation', 'vertical')
      await expect(list.getByRole('option')).toHaveCount(5)
      await expect(front(page)).toContainText('物流WMS')
      // ↓ で移動（循環しない）
      await page.keyboard.press('ArrowDown')
      await expect(front(page)).toContainText('バッチ移行')
      await list.getByRole('option', { name: /経理/ }).click()
      await expect(dialog(page)).toHaveCount(0)
      await expect(titleButton(page)).toHaveText('経理')
      await expect
        .poll(
          async () =>
            (await data<Record<string, unknown>>(page, 'settings.getAll'))['workspace.pickerView']
        )
        .toBe('list')

      // 再次打开仍是列表；切回圆环、打开详细
      await openWithAltW(page)
      await expect(dialog(page).getByRole('listbox')).toHaveAttribute(
        'aria-orientation',
        'vertical'
      )
      await dialog(page).getByRole('button', { name: 'リング' }).click()
      await expect(dialog(page).getByRole('listbox')).toHaveAttribute(
        'aria-orientation',
        'horizontal'
      )
      await dialog(page).getByRole('switch').click()
      await expect(front(page)).toContainText('説明なし')
      await expect(front(page)).toContainText('最終使用')
      await expect
        .poll(
          async () =>
            (await data<Record<string, unknown>>(page, 'settings.getAll'))['workspace.pickerDetail']
        )
        .toBe(true)
      // 一覧を開く：面板关闭，打开工作区一览
      await dialog(page).getByRole('button', { name: 'ワークスペース一覧を開く' }).click()
      await expect(dialog(page)).toHaveCount(0)
      await expect(page.getByRole('tab', { name: 'ワークスペース一覧' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('with the menu style both entries open the same menu; Alt+W and Alt+1–9 work in the menu', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await data(page, 'settings.set', { 'workspace.pickerStyle': 'menu' })
      await expect(titleButton(page)).not.toHaveAttribute('aria-haspopup', 'dialog')
      const items = page.getByRole('menuitemradio')
      const names = async (): Promise<string[]> =>
        items.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))
      const expected = ['デフォルト', '物流WMS', 'バッチ移行', '経理', '共通']

      await titleButton(page).click()
      await expect(page.getByRole('menu')).toBeVisible()
      expect(await names()).toEqual(expected)
      await expect(page.getByRole('menuitemradio', { name: '物流WMS' })).toHaveAttribute(
        'aria-checked',
        'true'
      )
      await expect(page.getByRole('menuitem', { name: 'ワークスペースの管理…' })).toBeVisible()
      await expect(page.getByRole('menuitem', { name: '新しいワークスペース…' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)

      // 地址框按钮：同一份菜单，锚定在地址框按钮下
      await addressButton(page).click()
      await expect(page.getByRole('menu')).toBeVisible()
      expect(await names()).toEqual(expected)
      const menuBox = (await page.getByRole('menu').boundingBox())!
      const buttonBox = (await addressButton(page).boundingBox())!
      expect(Math.abs(menuBox.x - buttonBox.x)).toBeLessThan(24)
      expect(menuBox.y).toBeGreaterThan(buttonBox.y)
      await page.getByRole('menuitemradio', { name: 'バッチ移行' }).click()
      await expect(titleButton(page)).toHaveText('バッチ移行')
      await expect(page.getByText('「バッチ移行」に切り替えました')).toBeVisible()

      // Alt+W 打开（标题栏按钮下），Alt+4 直选，Alt+W 再按关闭
      await page.keyboard.press('Alt+w')
      await expect(page.getByRole('menu')).toBeVisible()
      await page.keyboard.press('Alt+4')
      await expect(page.getByRole('menu')).toHaveCount(0)
      await expect(titleButton(page)).toHaveText('経理')
      await page.keyboard.press('Alt+w')
      await expect(page.getByRole('menu')).toBeVisible()
      await page.keyboard.press('Alt+w')
      await expect(page.getByRole('menu')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('the menu style shows a filter box with more than 8 workspaces', async () => {
    const { app, page } = await launch(userData)
    try {
      await data(page, 'settings.set', {
        'general.language': 'ja',
        'workspace.pickerStyle': 'menu'
      })
      await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
      for (let i = 1; i <= 8; i++) await data(page, 'workspace.create', { name: `案件${i}` })
      await data(page, 'workspace.create', { name: 'バッチ監視' })
      await titleButton(page).click()
      const box = page
        .getByRole('menu')
        .getByRole('textbox', { name: 'ワークスペースを名前で絞り込み' })
      await expect(box).toBeFocused()
      // 字符键进筛选框（不被菜单的首字母跳转拿走）
      await page.keyboard.type('ばっち')
      await expect(box).toHaveValue('ばっち')
      await expect(page.getByRole('menuitemradio')).toHaveCount(1)
      await page.keyboard.press('Enter')
      await expect(page.getByRole('menu')).toHaveCount(0)
      await expect(titleButton(page)).toHaveText('バッチ監視')
    } finally {
      await app.close()
    }
  })
})
