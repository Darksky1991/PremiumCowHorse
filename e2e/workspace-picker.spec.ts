import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { data, delayInvoke, launch, removeDirs } from './support'

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
  /** 正面卡片：退场动画中的旧卡片（绕环跳转时换了键，保留旧的 aria-selected）带 pointer-events: none，排除 */
  const front = (page: Page): Locator =>
    dialog(page)
      .getByRole('option', { selected: true })
      .and(dialog(page).locator(':not([style*="pointer-events: none"])'))
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

  test('a fast double click on a side card turns only that card to the front', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await openWithAltW(page)
      await page.waitForTimeout(400)
      const target = card(page, 1)
      await expect(target).toContainText('バッチ移行')
      const box = (await target.boundingBox())!
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      // 同一坐标点两次（间隔约 150ms）：第二次时原 +2 卡正滑入光标下，不能再转一格
      await page.mouse.click(x, y)
      await page.waitForTimeout(150)
      await page.mouse.click(x, y)
      await page.waitForTimeout(400)
      await expect(front(page)).toContainText('バッチ移行')
      expect((await data(page, 'workspace.active')).name).toBe('物流WMS')
    } finally {
      await app.close()
    }
  })

  test('Esc during the press feedback cancels the switch; Esc after "no results" restores the front card', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await openWithAltW(page)
      await page.keyboard.press('ArrowRight')
      await expect(front(page)).toContainText('バッチ移行')
      // Enter 后 140ms 的按压反馈期间按 Esc：取消切换，面板仍开
      await page.keyboard.press('Enter')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      expect((await data(page, 'workspace.active')).name).toBe('物流WMS')
      await expect(dialog(page)).toBeVisible()
      await expect(front(page)).toContainText('バッチ移行')

      // 无结果 → Esc：正面回到筛选前的那张（不是第 1 张）
      await filter(page).fill('xyz')
      await expect(dialog(page).getByRole('option')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(filter(page)).toHaveValue('')
      await expect(front(page)).toContainText('バッチ移行')
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toHaveCount(0)
      expect((await data(page, 'workspace.active')).name).toBe('物流WMS')
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
      await expect
        .poll(() => card(page, 0).evaluate((el) => el.style.transform))
        .toMatch(/^(none|)$/)
      await page.keyboard.press('Enter')
      await expect(dialog(page)).toHaveCount(0)
      await expect(titleButton(page)).toHaveText('バッチ移行')

      // 删除确认不翻转，只换可见的一面
      await openWithAltW(page)
      await dialog(page).getByRole('switch', { name: '編集', exact: true }).click()
      await front(page).getByRole('button', { name: '削除…' }).click()
      const back = front(page).getByRole('group', { name: '「バッチ移行」を削除しますか？' })
      await expect(back.getByRole('button', { name: 'キャンセル' })).toBeFocused()
      await expect(back).toBeVisible()
      await expect(front(page).getByRole('textbox', { name: '名前' })).toBeHidden()
      expect(
        await back.evaluate((el) => (el.parentElement as HTMLElement).style.transform)
      ).toMatch(/^(none|)$/)
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
      await dialog(page).getByRole('switch', { name: '詳細' }).click()
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

  /**
   * 绕环跳转（Home / End）后等退场中的旧正面卡片消失：它在退场动画的头一帧还没有 pointer-events: none，
   * `front` 的排除条件可能还不生效（strict mode violation 不重试）
   */
  const settle = async (page: Page): Promise<void> => {
    await expect(dialog(page).getByRole('option', { selected: true })).toHaveCount(1)
  }
  const editSwitch = (page: Page): Locator =>
    dialog(page).getByRole('switch', { name: '編集', exact: true })
  const nameField = (page: Page): Locator => front(page).getByRole('textbox', { name: '名前' })
  /** 模态打开时标题栏在无障碍树外（getByRole 找不到），按 DOM 取标题栏的工作区按钮 */
  const titleButtonBehind = (page: Page): Locator =>
    page.locator('header [aria-label="ワークスペースの切り替え"]')
  const listNames = async (page: Page): Promise<string[]> =>
    (await data<Array<{ name: string }>>(page, 'workspace.list')).map((w) => w.name)

  test('edit mode: the front card is a form saved at once (title bar follows); clicks and Enter do not switch', async () => {
    const { app, page } = await launch(userData)
    try {
      const ids = await setup(page)
      await openWithAltW(page)
      await editSwitch(page).click()
      await expect(editSwitch(page)).toHaveAttribute('aria-checked', 'true')
      await expect(
        dialog(page).getByText('編集中：クリックや Enter では切り替わりません')
      ).toBeVisible()
      // 编辑中不显示编号；正面是表单
      await expect(nameField(page)).toHaveValue('物流WMS')

      // 名称框 Enter：保存，焦点回到筛选框；标题栏随之更新
      await nameField(page).fill('物流WMS 本番')
      await page.keyboard.press('Enter')
      await expect(filter(page)).toBeFocused()
      await expect(titleButtonBehind(page)).toHaveText('物流WMS 本番')
      // 颜色：点击即保存，标题栏的圆点随之变化
      const dot = titleButtonBehind(page).locator('[data-workspace-color]')
      await expect(dot).toHaveAttribute('data-workspace-color', 'none')
      await front(page).getByRole('radio', { name: '青', exact: true }).click()
      await expect(dot).toHaveAttribute('data-workspace-color', 'blue')
      await expect(front(page).getByRole('radio', { name: '青', exact: true })).toHaveAttribute(
        'aria-checked',
        'true'
      )
      // 说明：失焦即保存
      await front(page).getByRole('textbox', { name: '説明' }).fill('出荷系の障害対応')
      await nameField(page).focus()
      await expect
        .poll(
          async () =>
            (
              await data<Array<{ id: string; description: string | null }>>(page, 'workspace.list')
            ).find((w) => w.id === ids['物流WMS'])?.description
        )
        .toBe('出荷系の障害対応')

      // 输入框中的 ←→ / 数字 / Enter 不转动、不切换；Esc 只撤销该字段，焦点回到筛选框（面板仍开）
      await nameField(page).fill('一時的な名前2')
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('2')
      await expect(nameField(page)).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(filter(page)).toBeFocused()
      await expect(dialog(page)).toBeVisible()
      await expect(nameField(page)).toHaveValue('物流WMS 本番')
      // 非默认工作区名称清空后失焦：还原
      await nameField(page).fill('')
      await filter(page).focus()
      await expect(nameField(page)).toHaveValue('物流WMS 本番')

      // Enter（筛选框中）不切换，只把焦点移到名称框
      await page.keyboard.press('ArrowRight')
      await expect(front(page)).toHaveAttribute('aria-label', /バッチ移行/)
      await page.keyboard.press('Enter')
      await expect(nameField(page)).toBeFocused()
      await expect(nameField(page)).toHaveValue('バッチ移行')
      // 点击正面卡片（表单）也不切换
      await page.waitForTimeout(300)
      await front(page).getByText('変更は自動で保存されます').click()
      await expect(dialog(page)).toBeVisible()
      // 直选不生效
      await filter(page).focus()
      await page.keyboard.press('Alt+3')
      await expect(dialog(page)).toBeVisible()
      expect((await data(page, 'workspace.active')).name).toBe('物流WMS 本番')
      // 正面换走时未保存的输入也保存
      await nameField(page).fill('バッチ移行 2026')
      await card(page, 1).click()
      await expect.poll(() => listNames(page)).toContain('バッチ移行 2026')

      // 编辑开关不记忆：关闭后再打开为浏览模式
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toHaveCount(0)
      await openWithAltW(page)
      await expect(editSwitch(page)).toHaveAttribute('aria-checked', 'false')
      await expect(front(page).getByRole('textbox')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('edit mode: the "+" card creates, the flipped card confirms deletion, Alt+→ reorders and the order is kept', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await openWithAltW(page)
      await editSwitch(page).click()
      await filter(page).focus()

      // End：转到最后的「+」卡片；Enter 新建，不切换，新卡片在正面、名称全选
      await page.keyboard.press('End')
      await settle(page)
      await expect(front(page)).toHaveAttribute('aria-label', '新しいワークスペースを作成')
      await page.keyboard.press('Enter')
      await expect(nameField(page)).toBeFocused()
      await expect(nameField(page)).toHaveValue('新しいワークスペース')
      await page.keyboard.type('調査用')
      await page.keyboard.press('Enter')
      await expect.poll(() => listNames(page)).toContain('調査用')
      expect((await data(page, 'workspace.active')).name).toBe('物流WMS')

      // 删除：卡片翻到背面，默认焦点在「キャンセル」；Esc 翻回（面板不关）
      await front(page).getByRole('button', { name: '削除…' }).click()
      const back = front(page).getByRole('group', { name: '「調査用」を削除しますか？' })
      await expect(back).toBeVisible()
      await expect(back.getByRole('button', { name: 'キャンセル' })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toBeVisible()
      await expect(front(page).getByRole('button', { name: '削除…' })).toBeFocused()
      await front(page).getByRole('button', { name: '削除…' }).click()
      await back.getByRole('button', { name: '削除', exact: true }).click()
      await expect(page.getByText('「調査用」を削除しました')).toBeVisible()
      await expect.poll(() => listNames(page)).not.toContain('調査用')
      await expect(dialog(page)).toBeVisible()
      await expect(filter(page)).toBeFocused()

      // 同一次打开中继续删除第二个：同样成功（互斥在第一次完成时已解除）
      await page.keyboard.press('End')
      await settle(page)
      await expect(front(page)).toHaveAttribute('aria-label', '新しいワークスペースを作成')
      await page.keyboard.press('Enter')
      await expect(nameField(page)).toBeFocused()
      await expect(nameField(page)).toHaveValue('新しいワークスペース')
      await expect.poll(() => listNames(page)).toContain('新しいワークスペース')
      await page.keyboard.press('Enter')
      await front(page).getByRole('button', { name: '削除…' }).click()
      const back2 = front(page).getByRole('group', {
        name: '「新しいワークスペース」を削除しますか？'
      })
      await expect(back2.getByRole('button', { name: 'キャンセル' })).toBeFocused()
      await back2.getByRole('button', { name: '削除', exact: true }).click()
      await expect(page.getByText('「新しいワークスペース」を削除しました')).toBeVisible()
      await expect.poll(() => listNames(page)).not.toContain('新しいワークスペース')
      await expect(dialog(page)).toBeVisible()
      await expect(filter(page)).toBeFocused()

      // 默认工作区没有「削除…」
      await page.keyboard.press('Home')
      await settle(page)
      await expect(nameField(page)).toHaveAttribute('placeholder', 'デフォルト')
      await expect(front(page).getByRole('button', { name: '削除…' })).toHaveCount(0)

      // Alt+→：把「物流WMS」与右边的「バッチ移行」交换；筛选中无效
      await page.keyboard.press('ArrowRight')
      await expect(nameField(page)).toHaveValue('物流WMS')
      await page.keyboard.press('Alt+ArrowRight')
      await expect(nameField(page)).toHaveValue('物流WMS')
      await expect
        .poll(() => listNames(page))
        .toEqual(['', 'バッチ移行', '物流WMS', '経理', '共通'])
      await filter(page).fill('経理')
      await page.keyboard.press('Alt+ArrowRight')
      await page.waitForTimeout(300)
      expect(await listNames(page)).toEqual(['', 'バッチ移行', '物流WMS', '経理', '共通'])

      // 重开：顺序保持（位置圆点的顺序与编号）
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toHaveCount(0)
      await openWithAltW(page)
      const dots = dialog(page).locator('[data-slot="picker-indicator"] button')
      expect(await dots.evaluateAll((els) => els.map((el) => el.getAttribute('title')))).toEqual([
        'デフォルト',
        'バッチ移行',
        '物流WMS',
        '経理',
        '共通'
      ])
      await expect(front(page)).toHaveAttribute('aria-label', /^3\. 物流WMS/)
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
      const ids: string[] = []
      for (let i = 1; i <= 8; i++) {
        ids.push((await data(page, 'workspace.create', { name: `案件${i}` })).id)
      }
      await data(page, 'workspace.create', { name: 'バッチ監視' })
      await data(page, 'workspace.activate', { id: ids[2]! })
      await expect(titleButton(page)).toHaveText('案件3')
      const box = page
        .getByRole('menu')
        .getByRole('textbox', { name: 'ワークスペースを名前で絞り込み' })
      // 筛选框为空（或只有空白）时 Enter 不切换，只关闭（与圆环的「选当前 = 只关闭」一致）
      for (const typed of ['', '  ']) {
        await titleButton(page).click()
        await expect(box).toBeFocused()
        if (typed !== '') await page.keyboard.type(typed)
        await page.keyboard.press('Enter')
        await expect(page.getByRole('menu')).toHaveCount(0)
        await expect(titleButton(page)).toHaveText('案件3')
      }
      // 有筛选词时 Esc 两级：先清空，再按关闭
      await titleButton(page).click()
      await expect(box).toBeFocused()
      await page.keyboard.type('案件')
      await expect(page.getByRole('menuitemradio')).toHaveCount(8)
      await page.keyboard.press('Escape')
      await expect(box).toHaveValue('')
      await expect(page.getByRole('menuitemradio')).toHaveCount(10)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)

      await titleButton(page).click()
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

  test('typing right after Alt+W (without waiting for focus) keeps every character', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      // 确定性的探针：输入框刚插入 DOM（同一次提交）时焦点是否已经在它身上
      await page.evaluate((selector) => {
        const w = window as unknown as { __focusAtInsert?: boolean }
        const observer = new MutationObserver(() => {
          const el = document.querySelector(selector)
          if (el === null) return
          w.__focusAtInsert = document.activeElement === el
          observer.disconnect()
        })
        observer.observe(document.body, { childList: true, subtree: true })
      }, '[role="dialog"] [role="combobox"]')
      await page.keyboard.press('Alt+w')
      // 对话框的挂载本身需要几十毫秒（此前的按键只能落在原焦点上，无法补救）；挂载后立即输入，不等待焦点
      await filter(page).waitFor({ state: 'attached' })
      await page.keyboard.type('xyz')
      await expect(filter(page)).toHaveValue('xyz')
      expect(
        await page.evaluate(
          () => (window as unknown as { __focusAtInsert?: boolean }).__focusAtInsert
        )
      ).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('while a deletion is in progress Esc does not flip the confirmation back', async () => {
    const { app, page } = await launch(userData)
    try {
      await setup(page)
      await data(page, 'workspace.create', { name: '調査用' })
      await delayInvoke(app, 'workspace.delete', 1500)
      await openWithAltW(page)
      await editSwitch(page).click()
      await filter(page).focus()
      await page.keyboard.press('End')
      await settle(page)
      await page.keyboard.press('ArrowLeft')
      await settle(page)
      await front(page).getByRole('button', { name: '削除…' }).click()
      const back = front(page).getByRole('group', { name: '「調査用」を削除しますか？' })
      await expect(back).toBeVisible()
      await back.getByRole('button', { name: '削除', exact: true }).click()
      await expect(back.getByRole('button', { name: 'キャンセル' })).toBeDisabled()
      await page.keyboard.press('Escape')
      await expect(back).toBeVisible()
      await expect(dialog(page)).toBeVisible()
      // 删除完成后才恢复：工作区消失
      await expect.poll(() => listNames(page)).not.toContain('調査用')
    } finally {
      await app.close()
    }
  })
})
