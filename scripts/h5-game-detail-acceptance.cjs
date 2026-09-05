// Local MOCK UI acceptance only: isolated browser storage and no remote calls.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const base = process.env.GAME_BASE_URL || 'http://127.0.0.1:5184'
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Use a local mock server')
const out = path.resolve(process.env.GAME_OUTPUT || 'artifacts/game-detail')

;(async () => {
  await fs.mkdir(out, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  const errors = [], checks = []
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (/^https?:$/.test(url.protocol) && url.origin !== base) { errors.push('Unexpected remote request ' + url.origin); return route.abort() }
    return route.continue()
  })
  const wait = () => page.waitForTimeout(1200)
  const go = async route => { await page.goto(base + '/#' + route); await wait() }
  const click = text => page.getByText(text, { exact: true }).last().click()
  const body = () => page.locator('body').innerText()
  async function snapshot(name) {
    await page.waitForTimeout(500)
    const overflow = await page.evaluate(() => {
      const root = [...document.querySelectorAll('uni-page-body')].findLast(node => node.getBoundingClientRect().width > 0)
      if (!root) return ['missing-page']
      const bounds = root.getBoundingClientRect()
      return [...root.querySelectorAll('uni-button, button, .card, .member-name, .game-title, .detail-actions')].filter(node => {
        const rect = node.getBoundingClientRect()
        return rect.width && rect.height && (rect.right > bounds.right + 2 || rect.left < bounds.left - 2 || node.scrollWidth > node.clientWidth + 3)
      }).map(node => node.textContent.trim().slice(0, 80))
    })
    assert.deepEqual(overflow, [], 'Overflow: ' + name)
    // Viewport captures preserve the actual mobile paint and fixed action bar;
    // Chrome's beyond-viewport capture can omit uni-text glyphs under reduced motion.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: path.join(out, name + '.png') })
    const roster = page.locator('.roster-card')
    if (await roster.count()) {
      await roster.evaluate(node => node.scrollIntoView({ block: 'center' }))
      await page.waitForTimeout(100)
      await page.screenshot({ path: path.join(out, name + '-roster.png') })
    }
    checks.push({ name, result: 'PASS' })
  }
  try {
    await go('/pages/game-detail/index?id=game-weekend&from=share')
    assert((await body()).includes('周末进阶双打局'))
    assert((await body()).includes('4 人已确认'))
    assert(!(await body()).includes('球友1'))
    await snapshot('01-guest-invitation')
    await click('邀请球友')
    await wait()
    const link = await page.evaluate(() => navigator.clipboard.readText())
    assert.equal(link, base + '/#/pages/game-detail/index?id=game-weekend&from=share')
    checks.push({ name: '02-h5-copy-exact-invitation', result: 'PASS' })
    await click('登录查看球友')
    await wait()
    await click('开发验收入口')
    await click('会员')
    await wait()
    assert(page.url().includes('/pages/game-detail/index?id=game-weekend'))
    assert.equal(await page.locator('.member-item').count(), 4)
    assert.equal(await page.locator('.main-action').innerText(), '报名这场球局')
    await snapshot('03-login-returns-to-shared-game')
    await click('报名这场球局')
    await click('确认报名')
    await wait()
    assert(page.url().includes('/pages/order/index?id='))
    const firstOrderUrl = page.url()
    assert((await body()).includes('取消订单'))
    await snapshot('04-exact-pending-order')
    await click('查看球局安排')
    await wait()
    assert((await body()).includes('含 1 人待支付'))
    assert.equal(await page.locator('.member-item').count(), 4)
    await snapshot('05-pending-seat-not-confirmed-roster')
    await click('去支付 / 取消订单')
    await wait()
    assert.equal(page.url(), firstOrderUrl)
    await click('取消订单')
    await click('确认取消')
    await wait()
    assert((await body()).includes('订单已取消，无需付款'))
    await click('查看球局安排')
    await wait()
    assert((await body()).includes('4 / 6 个名额已占用'))
    assert.equal(await page.locator('.main-action').innerText(), '报名这场球局')
    await snapshot('06-cancel-releases-game-seat')
    await click('报名这场球局')
    await click('确认报名')
    await wait()
    assert.notEqual(page.url(), firstOrderUrl)
    await click('立即支付')
    await click('充值余额')
    await wait()
    await click('查看球局安排')
    await wait()
    assert((await body()).includes('5 人已确认'))
    assert.equal(await page.locator('.member-item').count(), 5)
    assert.equal(await page.locator('.me-label').innerText(), '我')
    assert((await body()).includes('我的报名 · 报名已确认'))
    assert.equal(await page.locator('.main-action').innerText(), '查看我的订单')
    await snapshot('07-payment-updates-roster')

    await click('查看其他球局')
    await wait()
    await click('查看球局详情')
    await wait()
    assert(page.url().includes('/pages/game-detail/index?id=game-weekend'))
    await snapshot('08-list-opens-independent-detail')
    await go('/pages/community/index?tab=games&gameId=game-weekend')
    assert(page.url().includes('/pages/game-detail/index?id=game-weekend&from=share'))
    await click('查看其他球局')
    await wait()
    assert(page.url().includes('/pages/community/index'))
    await snapshot('09-legacy-invitation-no-back-loop')

    // Edge fixtures are local mock storage only, never a live database.
    await page.evaluate(() => {
      const seed = JSON.parse(localStorage.getItem('yanqing_mock_games')).data[0]
      const future = new Date(Date.now() + 86400000).toISOString()
      const seats = [1, 2, 3, 4].map(i => ({ id: 'edge-reg-' + i, userId: 'edge-member-' + i, displayName: i === 1 ? '球友昵称很长也应完整换行ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '球友' + i, status: 'PAID', avatarUrl: i === 1 ? location.origin + '/not-a-real-avatar.jpg' : null }))
      localStorage.setItem('yanqing_mock_games', JSON.stringify({ type: 'object', data: [seed,
        { ...seed, id: 'edge-full', title: '满员候补验收球局', capacity: 4, status: 'FULL', startsAt: future, endsAt: new Date(Date.now() + 86400000 + 7200000).toISOString(), registrations: seats },
        { ...seed, id: 'edge-cancelled', title: '已取消验收球局', status: 'CANCELLED', registrations: [] },
        { ...seed, id: 'edge-draft', title: '不公开的草稿', status: 'DRAFT', registrations: [] },
      ] }))
    })
    await go('/pages/game-detail/index?id=edge-full&from=share')
    assert.equal(await page.locator('.main-action').innerText(), '加入候补')
    await snapshot('10-full-game-and-avatar-fallback')
    await click('加入候补')
    await click('确认候补')
    await wait()
    assert((await body()).includes('当前候补第 1 位'))
    assert(await page.locator('.main-action').isDisabled())
    await snapshot('11-waitlisted-without-payment')
    for (const width of [320, 414, 1440]) {
      await page.setViewportSize({ width, height: 812 })
      await snapshot('12-layout-' + width)
    }
    await page.setViewportSize({ width: 375, height: 812 })
    await go('/pages/game-detail/index?id=edge-cancelled')
    assert((await body()).includes('这场球局已取消'))
    assert(await page.locator('.main-action').isDisabled())
    await snapshot('13-cancelled-terminal-state')
    for (const id of ['not-existing', 'edge-draft', 'bad%2Fid']) {
      await go('/pages/game-detail/index?id=' + id)
      assert((await body()).includes('暂时无法查看这场球局'))
      assert(!(await body()).includes('不公开的草稿'))
      assert.equal(await page.locator('.main-action').count(), 0)
      await snapshot('14-invalid-' + id.replace('%2F', '-'))
    }
    assert.deepEqual(errors, [])
    await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({ base, checks, errors }, null, 2))
    console.log(JSON.stringify({ passed: checks.length, errors, output: out }, null, 2))
  } catch (error) {
    await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true })
    console.error(await body())
    console.error(error)
    process.exitCode = 1
  } finally { await browser.close() }
})()
