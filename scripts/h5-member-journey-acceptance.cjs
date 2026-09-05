// Run against a local MOCK H5 build only. Each run uses an isolated browser
// context, so it never touches the user's browser storage or live business data.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const base = process.env.JOURNEY_BASE_URL || 'http://127.0.0.1:5184'
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Use a local mock build, not a production URL')
const out = path.resolve(process.env.JOURNEY_OUTPUT || 'artifacts/member-journey')

;(async () => {
  await fs.mkdir(out, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const pageErrors = []
  const checks = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  // Fail closed if the build tries to use a real API instead of local mock data.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== base && /^https?:$/.test(url.protocol)) {
      pageErrors.push('Unexpected external request: ' + url.origin)
      return route.abort()
    }
    return route.continue()
  })
  const click = text => page.getByText(text, { exact: true }).last().click()
  const wait = () => page.waitForTimeout(1500)
  const body = () => page.locator('body').innerText()
  const go = async route => { await page.goto(base + '/#' + route); await wait() }
  async function snapshot(name) {
    const overflow = await page.evaluate(() => {
      const root = [...document.querySelectorAll('uni-page-body')].findLast(node => node.getBoundingClientRect().width > 0)
      if (!root) return ['missing-page']
      const bounds = root.getBoundingClientRect()
      return [...root.querySelectorAll('uni-button, button, input, .card')].filter(node => {
        const rect = node.getBoundingClientRect()
        if (!rect.width || !rect.height || node.closest('.matrix-wrap')) return false
        return rect.right > bounds.right + 2 || rect.left < bounds.left - 2 || node.scrollWidth > node.clientWidth + 3
      }).map(node => node.textContent.trim().slice(0, 70))
    })
    assert.deepEqual(overflow, [], 'overflow on ' + name + ': ' + overflow.join(', '))
    await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true })
    checks.push({ name, result: 'PASS' })
  }
  try {
    await go('/pages/home/index')
    assert(!(await body()).includes('现金本金'))
    await snapshot('01-visitor-home')
    await click('查看场地与价格')
    await wait()
    const court = page.locator('.court:not(.disabled)').first()
    await court.waitFor()
    const courtIndex = await court.evaluate(node => [...document.querySelectorAll('.court')].indexOf(node))
    await court.click()
    const originalSelection = await page.locator('.confirm-title').innerText()
    await click('登录后继续预约')
    await wait()
    await click('开发验收入口')
    await click('会员')
    await wait()
    assert(page.url().includes('/pages/booking/index'))
    assert.equal(await page.locator('.confirm-title').innerText(), originalSelection)
    await snapshot('02-booking-resumed-after-login')
    await click('确认预约，下一步付款')
    await wait()
    assert(page.url().includes('/pages/order/index?id='))
    assert((await body()).includes('取消订单'))
    await snapshot('03-pending-order')
    await go('/pages/booking/index')
    assert.equal(await page.locator('.court').nth(courtIndex).getAttribute('aria-disabled'), 'true')
    await snapshot('03b-pending-order-holds-court')
    await go('/pages/home/index')
    await page.getByText('你有待付款订单', { exact: true }).waitFor()
    await click('去付款 / 取消')
    await wait()
    assert(page.url().includes('/pages/order/index?id='))
    await click('取消订单')
    await click('确认取消')
    await wait()
    assert((await body()).includes('订单已取消，无需付款'))
    await snapshot('04-order-cancelled')
    await go('/pages/booking/index')
    assert.equal(await page.locator('.court').nth(courtIndex).getAttribute('aria-disabled'), 'false')
    await snapshot('04b-cancelled-order-releases-court')

    await go('/pages/profile/index')
    const profileText = await body()
    for (const text of ['现金本金', '成人赛事积分', '青少年成长积分', '推荐关系已生效', '申请注销与匿名化', '进入经营工作台']) assert(!profileText.includes(text), 'unexpected member homepage content: ' + text)
    assert(profileText.includes('我的订单'))
    await snapshot('05-member-profile')
    await click('我的活动')
    await wait()
    assert.equal(await page.locator('.journey-tabs .active').innerText(), '我的报名')
    assert(!(await body()).includes('邀请与报名不要混用'))
    await snapshot('06-my-activities')
    await go('/pages/home/index')
    await click('报名比赛')
    await wait()
    assert((await page.locator('.tab-option.active').innerText()).includes('金羽积分赛'))
    assert.equal(await page.locator('.journey-tabs .active').innerText(), '找活动')
    await snapshot('07-event-entry')
    await go('/pages/training/index?tab=products')
    assert(!(await body()).includes('培训独立经营账'))
    assert(!(await body()).includes('我的青少年学员'))
    await snapshot('08-course-catalog')
    await click('我的课程')
    await wait()
    assert.equal(await page.locator('.training-ledger').count(), 0)
    await snapshot('09-my-courses')

    // Simulate a new member with zero rewards without altering any real account.
    await page.evaluate(() => {
      const id = localStorage.getItem('yanqing_actor_id')
      const types = ['CASH_PRINCIPAL', 'GIFT_BALANCE', 'BADMINTON_COIN', 'EVENT_POINTS', 'GROWTH_POINTS']
      // uni-app H5 persists non-string values in a { type, data } envelope.
      localStorage.setItem('yanqing_mock_member_accounts', JSON.stringify({ type: 'object', data: { [id]: types.map(type => ({ id: type, userId: id, type, balance: 0, frozenBalance: 0 })) } }))
    })
    await go('/pages/wallet/index')
    assert.equal(await page.locator('.balance-row').count(), 2)
    await snapshot('10-wallet-zero-rewards-folded')
    await click('查看全部权益')
    assert.equal(await page.locator('.balance-row').count(), 5)
    await snapshot('11-wallet-all-rights-accessible')
    await go('/pages/coupon/index')
    assert(!(await body()).includes('商户核销台'))
    assert.equal(await page.locator('.claim input').count(), 0)
    await snapshot('12-coupons')
    await go('/pages/settings/index')
    await snapshot('13a-settings')
    await page.locator('input').first().fill('旅程验收昵称')
    await click('保存资料')
    await wait()
    await go('/pages/profile/index')
    assert((await body()).includes('旅程验收昵称'))
    await snapshot('13-profile-updated')
    await go('/pages/invite/index')
    assert.equal(await page.locator('.referral-code').count(), 0)
    await snapshot('14-invite')

    for (const [name, viewport] of [['small', { width: 320, height: 740 }], ['desktop', { width: 1280, height: 900 }], ['landscape', { width: 812, height: 375 }]]) {
      await page.setViewportSize(viewport)
      await go('/pages/home/index')
      await snapshot('15-home-' + name)
      await go('/pages/profile/index')
      await snapshot('16-profile-' + name)
    }
    await page.setViewportSize({ width: 320, height: 740 })
    for (const route of ['booking', 'community', 'training', 'wallet', 'coupon', 'settings', 'invite', 'order']) {
      await go(`/pages/${route}/index`)
      await snapshot('17-small-' + route)
    }
    assert.deepEqual(pageErrors, [])
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ base, checks, pageErrors }, null, 2))
    console.log(JSON.stringify({ checks: checks.length, result: 'PASS', screenshots: out }, null, 2))
  } catch (error) {
    await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {})
    console.error(await page.evaluate(() => ({ rootFont: getComputedStyle(document.documentElement).fontSize, rootStyle: document.documentElement.getAttribute('style'), viewport: innerWidth, pageWidth: document.querySelector('uni-page-body')?.getBoundingClientRect().width })))
    console.error(await body().catch(() => ''))
    throw error
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
