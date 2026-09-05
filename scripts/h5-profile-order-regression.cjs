// Test a local REMOTE H5 build with intercepted HTTP fixtures. No production
// requests, real account sessions, uploads, orders or payments are performed.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const base = process.env.PROFILE_ORDER_BASE || 'http://127.0.0.1:5190'
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw new Error('Local build required')
const output = path.resolve(process.env.PROFILE_ORDER_OUTPUT || 'artifacts/profile-order')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9l0AAAAASUVORK5CYII=', 'base64')

;(async () => {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' })
  await context.addInitScript(() => {
    localStorage.setItem('yanqing_access_token', 'isolated-ui-fixture-token')
    localStorage.setItem('yanqing_actor_id', 'ui-member')
  })
  const errors = [], requests = [], checks = []
  let failOrders = false
  const user = { id: 'ui-member', displayName: '验收球友', avatarUrl: '/uploads/avatars/test.png', roles: ['MEMBER'], accounts: [], memberProfile: null }
  const orders = ['PENDING', 'PAID', 'REFUND_PENDING'].map((status, index) => ({ id: 'fixture-' + index, orderNo: 'UI-000' + index, title: '验收场地订单 ' + (index + 1), businessType: 'VENUE', status, payableCents: 8800, paidCents: status === 'PENDING' ? 0 : 8800, createdAt: '2026-09-05T00:00:00Z', bookings: [], refunds: [] }))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === base || !/^https?:$/.test(url.protocol)) return route.continue()
    if (url.origin !== 'https://api.yutechhn.cn') { errors.push('Unexpected external origin'); return route.abort() }
    const headers = { 'access-control-allow-origin': base, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const reply = (data, status = 200, message = 'ok') => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify({ code: status < 300 ? 0 : status, data, message, requestId: 'ui-fixture' }) })
    if (url.pathname.startsWith('/uploads/avatars/')) return route.fulfill({ status: 200, headers, contentType: 'image/png', body: png })
    if (url.pathname === '/api/v1/auth/me') return reply(user)
    if (url.pathname === '/api/v1/orders') {
      requests.push(url.search)
      assert(!url.search.includes('undefined') && !url.search.includes('null'))
      if (failOrders) return reply(null, 400, ['status must be one of the following values: PENDING, PAID, CHECKED_IN, COMPLETED, REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED, CANCELLED'])
      const status = url.searchParams.get('status')
      const items = orders.filter(order => !status || order.status === status)
      return reply({ items, total: items.length })
    }
    errors.push('Unexpected API ' + url.pathname)
    return route.abort()
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const go = async route => { await page.goto(base + '/#' + route); await page.waitForTimeout(600) }
  const click = text => page.getByText(text, { exact: true }).last().click()
  async function snapshot(name) {
    await page.waitForTimeout(400)
    const overflow = await page.evaluate(() => {
      const root = [...document.querySelectorAll('uni-page-body')].findLast(node => node.getBoundingClientRect().width > 0)
      const rect = root.getBoundingClientRect()
      return [...root.querySelectorAll('.card, uni-button, input')].filter(node => {
        const box = node.getBoundingClientRect()
        return box.width && box.height && (box.left < rect.left - 2 || box.right > rect.right + 2 || node.scrollWidth > node.clientWidth + 3)
      }).map(node => node.textContent.trim())
    })
    assert.deepEqual(overflow, [])
    await page.screenshot({ path: path.join(output, name + '.png') })
    checks.push({ name, result: 'PASS' })
  }
  try {
    await go('/pages/order/index')
    await page.locator('.order').first().waitFor()
    assert.equal(await page.locator('.order').count(), 3)
    assert(!new URLSearchParams(requests.at(-1)).has('status'))
    await snapshot('01-all-orders')
    for (const [label, status] of [['待付款', 'PENDING'], ['待使用', 'PAID'], ['售后中', 'REFUND_PENDING']]) {
      await page.locator('.order-filters').getByText(label, { exact: true }).click(); await page.waitForTimeout(250)
      assert.equal(await page.locator('.order').count(), 1)
      assert.equal(new URLSearchParams(requests.at(-1)).get('status'), status)
      checks.push({ name: 'filter-' + status, result: 'PASS' })
    }
    failOrders = true
    await page.locator('.order-filters').getByText('全部', { exact: true }).click()
    await page.locator('.load-error').waitFor()
    assert(!(await page.locator('body').innerText()).includes('status must'))
    assert((await page.locator('.load-error').innerText()).includes('订单筛选未成功，请重试'))
    assert.equal(await page.getByText('加载更多订单', { exact: true }).count(), 0)
    assert((await page.locator('.retry').boundingBox()).height >= 44)
    await snapshot('02-readable-error-375')
    await page.setViewportSize({ width: 320, height: 720 })
    await snapshot('03-readable-error-320')
    await page.setViewportSize({ width: 812, height: 375 })
    await snapshot('04-readable-error-landscape')
    failOrders = false
    await click('重试'); await page.waitForTimeout(250)
    assert.equal(await page.locator('.load-error').count(), 0)
    assert.equal(await page.locator('.order').count(), 3)
    checks.push({ name: 'retry-recovers-order-list', result: 'PASS' })
    await page.setViewportSize({ width: 375, height: 812 })
    await go('/pages/profile/index')
    await page.waitForFunction(() => { const image = document.querySelector('.profile-card .avatar img'); return image?.complete && image.naturalWidth > 0 })
    await snapshot('05-profile-avatar-loaded')
    await go('/pages/settings/index')
    await page.waitForFunction(() => { const image = document.querySelector('.editor-avatar img'); return image?.complete && image.naturalWidth > 0 })
    await snapshot('06-settings-avatar-loaded')
    assert.deepEqual(errors, [])
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'PASS', checks, requests }, null, 2))
    console.log(JSON.stringify({ status: 'PASS', count: checks.length, output }))
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') })
    throw error
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exit(1) })
