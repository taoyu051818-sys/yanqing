import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { computed, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withPendingCreationKey } from '../../utils/pending-creation-key'
import { money } from '../../utils/format'
import { captureAuthSession, isAuthSessionCurrent } from '../../services/auth-session'
import { createPaymentConfirmation, canCancelFreeVenue } from '../../utils/payment-confirmation'
import { apiFeedback } from '../../services/api-feedback'

const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  transformers: { before: [context => file => ts.visitNode(file, function visit(node): any {
    return ts.isImportDeclaration(node) ? undefined : ts.visitEachChild(node, visit, context)
  }) as ts.SourceFile] },
}).outputText.replace(/^export \{\};?$/gm, '')

function fixture(notifyImmediately = false) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-09T06:00:00Z'))
  const storage = new Map<string, unknown>()
  let serverStatus = 'PENDING'
  const order = () => ({ id: 'venue-order', orderNo: 'VN-test', businessType: 'VENUE', status: serverStatus,
    payableCents: 6000, paidCents: serverStatus === 'PAID' ? 6000 : 0, paymentExpiresAt: '2026-09-09T06:10:00Z' })
  const endpoints = {
    order: vi.fn(async () => order()),
    orders: vi.fn(async () => ({ items: [order()], total: 1 })),
    paymentOptions: vi.fn(async () => ({ payableCents: 6000, options: [{ channel: 'WECHAT', enabled: true, debitAmount: 6000 }] })),
    payOrder: vi.fn(async () => ({ status: 'PROCESSING', wechatPay: { package: 'prepay_id=isolated' } })),
  }
  const session = { isAuthenticated: true, hydrate: vi.fn(async () => true) }
  const requestPayment = vi.fn(async () => { if (notifyImmediately) serverStatus = 'PAID' })
  vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key), requestPayment, showToast: vi.fn(), stopPullDownRefresh: vi.fn() })
  const noop = () => {}
  const deps = { computed, ref, watch, captureAuthSession, isAuthSessionCurrent, createPaymentConfirmation, canCancelFreeVenue, money, endpoints, withPendingCreationKey, apiFeedback, isMockMode: false, useSessionStore: () => session,
    onLoad: noop, onShow: noop, onHide: noop, onUnload: noop, onPullDownRefresh: noop }
  const page = new Function(...Object.keys(deps), js + ';return { load, preparePay, pay, orders, startCountdown, stopCountdown, paymentConfirmation }')(...Object.values(deps))
  return { page, endpoints, session, requestPayment, notify: () => { serverStatus = 'PAID' } }
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('order page payment confirmation regression', () => {
  it('refreshes automatically when notification arrives five seconds after native payment success', async () => {
    const f = fixture()
    await f.page.load()
    f.page.startCountdown()
    const pending = f.page.orders.value[0]
    await f.page.preparePay(pending)
    await f.page.pay(pending)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.requestPayment).toHaveBeenCalledOnce()
    const readsAfterPayment = f.endpoints.orders.mock.calls.length
    expect(f.page.orders.value[0].status).toBe('PENDING')
    await vi.advanceTimersByTimeAsync(5000)
    f.notify()
    await vi.advanceTimersByTimeAsync(25000)
    expect(f.endpoints.orders.mock.calls.length).toBeGreaterThan(readsAfterPayment)
    expect(f.page.paymentConfirmation.value).toBeNull()
    expect(f.page.orders.value[0].status).toBe('PAID')
    f.page.stopCountdown()
  })
  it('shows paid when the provider notification beats the one immediate query (control)', async () => {
    const f = fixture(true)
    await f.page.load()
    const pending = f.page.orders.value[0]
    await f.page.preparePay(pending)
    await f.page.pay(pending)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.page.orders.value[0].status).toBe('PAID')
  })
})
