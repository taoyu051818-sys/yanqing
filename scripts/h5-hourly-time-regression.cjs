// Local H5 remote build, isolated HTTP fixtures only. No live accounts or orders.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const base = 'http://127.0.0.1:5191'
const output = path.resolve(process.env.HOURLY_UI_OUTPUT || 'artifacts/hourly-time')
;(async () => {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce', timezoneId: 'America/Los_Angeles' })
  await context.addInitScript(() => {
    localStorage.setItem('yanqing_access_token', 'isolated-hourly-fixture')
    localStorage.setItem('yanqing_actor_id', 'ui-member')
    // Emulate native runtimes whose locale formatting ignores options.
    for (const method of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) Date.prototype[method] = () => 'Mon Sep 07 2026 19:00:00 GMT+0800 (CST)'
  })
  const game = { id: 'ui-game', title: '周末进阶双打局', level: 'INTERMEDIATE', status: 'OPEN', startsAt: '2090-09-07T11:00:00Z', endsAt: '2090-09-07T13:00:00Z', capacity: 6, feeCents: 6800, newcomerOnly: false, description: '请提前到场热身，自带球拍和运动鞋。', host: { displayName: '主理人阿凯', avatarUrl: null }, courtNames: ['1号场', '2号场'], occupiedCount: 2, confirmedCount: 2, pendingCount: 0, waitlistCount: 0 }
  const user = { id: 'ui-member', displayName: '验收球友', roles: ['MEMBER'], accounts: [], memberProfile: null }
  const errors = [], checks = []
  let created, calendarDate
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === base || !/^https?:$/.test(url.protocol)) return route.continue()
    if (url.origin !== 'https://api.yutechhn.cn') { errors.push('Unexpected origin'); return route.abort() }
    const headers = { 'access-control-allow-origin': base, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const reply = data => route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ code: 0, data, message: 'ok' }) })
    const resource = url.pathname.replace('/api/v1', '')
    if (resource === '/auth/me') return reply(user)
    if (resource === '/games/ui-game') return reply(game)
    if (resource === '/games/ui-game/participants') return reply({ participants: [{ displayName: '球友小林', avatarUrl: null, isMe: false }, { displayName: '球友阿宁', avatarUrl: null, isMe: false }], myRegistration: null })
    if (resource === '/venues/availability') {
      calendarDate = url.searchParams.get('date')
      return reply({ date: calendarDate, courts: [1, 2, 3].map(n => ({ id: 'court-' + n, name: n + '号场', enabled: true, usage: 'RETAIL' })),
        slots: Array.from({ length: 17 }, (_, i) => { const hour = 7 + i; return { id: 'hourly-slot-H' + String(hour).padStart(2, '0'), label: hour + ':00–' + (hour + 1) + ':00', startMinutes: hour * 60, endMinutes: (hour + 1) * 60, enabled: true, period: 'PRIME', price: { priceCents: hour < 19 ? 3000 : 6000 } } }),
        bookings: [{ courtId: 'court-2', startsAt: calendarDate + 'T19:00:00+08:00', endsAt: calendarDate + 'T21:00:00+08:00', status: 'CONFIRMED', usage: 'RETAIL' }], closures: [] })
    }
    if (resource === '/venues/bookings' && request.method() === 'POST') {
      const data = request.postDataJSON()
      assert.equal(data.slotId, 'hourly-slot-H19')
      assert.equal(data.courtId, 'court-1')
      created = { id: 'hourly-order', orderNo: 'UI-HOURLY-001', title: '1号场 · 19:00–20:00', status: 'PENDING', businessType: 'VENUE', payableCents: 6000, paidCents: 0, createdAt: new Date().toISOString(), bookings: [{ status: 'HELD', court: { id: 'court-1', name: '1号场' }, startsAt: data.date + 'T19:00:00+08:00', endsAt: data.date + 'T20:00:00+08:00' }], payments: [], refunds: [] }
      return reply(created)
    }
    if (resource === '/orders/hourly-order') return reply(created)
    errors.push('Unexpected API ' + resource); return route.abort()
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const go = async route => { await page.goto(base + '/#' + route); await page.waitForTimeout(500) }
  async function snapshot(name) {
    await page.waitForTimeout(200)
    const overflow = await page.evaluate(() => [...document.querySelectorAll('.card, .game-title, .fact-value, .fact-caption, .confirm, .notice')].filter(node => {
      const box = node.getBoundingClientRect(); return box.width && box.height && (box.left < -2 || box.right > innerWidth + 2 || node.scrollWidth > node.clientWidth + 3)
    }).map(node => node.className))
    assert.deepEqual(overflow, [])
    if (await page.locator('.confirm').count()) {
      const clearance = await page.evaluate(() => {
        const button = document.querySelector('.confirm .primary').getBoundingClientRect()
        const tab = document.querySelector('uni-tabbar.uni-tabbar-bottom')?.getBoundingClientRect()
        return { buttonBottom: button.bottom, buttonTop: button.top, limit: innerHeight,
          overlapsTab: Boolean(tab?.height && button.bottom > tab.top && button.top < tab.bottom && button.right > tab.left && button.left < tab.right) }
      })
      assert(clearance.buttonTop >= 0 && clearance.buttonBottom <= clearance.limit && !clearance.overlapsTab, JSON.stringify(clearance))
    }
    assert(!/CST|GMT|Invalid Date/.test(await page.locator('body').innerText()))
    await page.screenshot({ path: path.join(output, name + '.png') })
    checks.push(name)
  }
  try {
    await go('/pages/game-detail/index?id=ui-game&from=share')
    assert((await page.locator('.game-facts').innerText()).includes('2090年09月07日'))
    assert((await page.locator('.game-facts').innerText()).includes('19:00–21:00'))
    await snapshot('01-game-time-375')
    await page.setViewportSize({ width: 320, height: 720 }); await snapshot('02-game-time-320')
    await page.setViewportSize({ width: 812, height: 375 }); await snapshot('03-game-time-landscape')
    await page.setViewportSize({ width: 375, height: 812 })
    game.endsAt = '2090-09-07T17:00:00Z'
    await page.reload(); await page.waitForTimeout(500)
    assert((await page.locator('.game-facts').innerText()).includes('09月08日 01:00'))
    checks.push('cross-day-ending-visible')
    await go('/pages/booking/index')
    assert.equal(await page.locator('.slot-label').count(), 17)
    const selected = page.locator('.court[aria-label^="1号场，19:00"]')
    await selected.click()
    assert.equal(await selected.getAttribute('aria-pressed'), 'true')
    assert((await page.locator('.confirm').innerText()).includes('共 1 小时'))
    assert((await page.locator('.confirm').innerText()).includes('¥60.00'))
    for (const hour of [19, 20]) assert.equal(await page.locator(`.court[aria-label^="2号场，${hour}:00"]`).getAttribute('aria-disabled'), 'true')
    assert((await selected.boundingBox()).height >= 44)
    await snapshot('04-hourly-booking-selection')
    await page.setViewportSize({ width: 320, height: 720 }); await snapshot('05-hourly-booking-320')
    await page.setViewportSize({ width: 812, height: 375 }); await snapshot('06-hourly-booking-landscape')
    await page.setViewportSize({ width: 375, height: 812 })
    await page.addStyleTag({ content: '.game-detail-page .fact-value,.game-detail-page .fact-caption,.confirm text { font-size: 20px !important; }' })
    await snapshot('07-booking-large-text')
    await page.getByText('确认预约，下一步付款', { exact: true }).click()
    await page.locator('.order').waitFor()
    assert(created)
    assert((await page.locator('.order').innerText()).includes('19:00–20:00'))
    assert((await page.locator('.order-meta').boundingBox()).height < 120)
    await page.waitForTimeout(1700)
    await snapshot('08-hourly-order-time')
    assert.deepEqual(errors, [])
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'PASS', count: checks.length, checks }, null, 2))
    console.log(JSON.stringify({ status: 'PASS', count: checks.length, output }))
  } catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }); throw error }
  finally { await browser.close() }
})().catch(error => { console.error(error); process.exit(1) })
