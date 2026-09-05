import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { accountAmount, relevantAccounts } from './member-wallet'
import { consumeBookingIntent, consumeCommunityIntent, consumeLoginReturn, finishMemberLogin, openMemberPage, openMemberRecord, rememberLoginReturn, safeMemberRoute } from './member-navigation'
import { saveAuthSession } from '../services/auth-session'

const storage = new Map<string, any>()
const navigateTo = vi.fn()
const switchTab = vi.fn()
const navigateBack = vi.fn()
const redirectTo = vi.fn()
const pages = vi.fn((): any[] => [])
vi.stubGlobal('uni', {
  getStorageSync: (key: string) => storage.get(key) ?? '',
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
  navigateTo, switchTab, navigateBack, redirectTo,
})
vi.stubGlobal('getCurrentPages', pages)

describe('member journey navigation', () => {
  beforeEach(() => { storage.clear(); vi.clearAllMocks(); pages.mockReturnValue([]); setActivePinia(createPinia()) })
  it('lets a visitor browse booking without login', () => {
    openMemberPage('/pages/booking/index')
    expect(switchTab).toHaveBeenCalledWith({ url: '/pages/booking/index' })
    expect(navigateTo).not.toHaveBeenCalled()
  })
  it('lets a visitor open a specific shared game and returns there after explicit login', () => {
    const route = '/pages/game-detail/index?id=game-weekend&from=share'
    openMemberPage(route)
    expect(navigateTo).toHaveBeenCalledWith({ url: route })
    rememberLoginReturn(route)
    saveAuthSession('token', 'member')
    finishMemberLogin()
    expect(redirectTo).toHaveBeenCalledWith({ url: route })
  })
  it('remembers an exact protected destination instead of returning to the homepage', () => {
    openMemberPage('/pages/training/index?tab=mine')
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/login/index' })
    saveAuthSession('token', 'member')
    finishMemberLogin()
    expect(redirectTo).toHaveBeenCalledWith({ url: '/pages/training/index?tab=mine' })
    expect(consumeLoginReturn()).toBeNull()
  })
  it('returns to the existing booking page so its selection survives', () => {
    rememberLoginReturn('/pages/booking/index')
    saveAuthSession('token', 'member')
    pages.mockReturnValue([{ route: 'pages/booking/index' }, { route: 'pages/login/index' }])
    finishMemberLogin()
    expect(navigateBack).toHaveBeenCalledOnce()
    expect(switchTab).not.toHaveBeenCalled()
  })
  it('carries tab parameters across switchTab exactly once', () => {
    saveAuthSession('token', 'member')
    openMemberPage('/pages/community/index?tab=events&eventId=event-1&view=mine')
    expect(switchTab).toHaveBeenCalledWith({ url: '/pages/community/index' })
    expect(consumeCommunityIntent()).toEqual({ tab: 'events', eventId: 'event-1', view: 'mine' })
    expect(consumeCommunityIntent()).toBeNull()
  })
  it('carries a selected coupon by record reference, not a coupon secret, without losing it to other tabs', () => {
    openMemberPage('/pages/booking/index?couponId=owned-coupon&code=never-pass-this')
    expect(consumeCommunityIntent()).toBeNull()
    expect(consumeBookingIntent()).toEqual({ couponId: 'owned-coupon' })
    expect(consumeBookingIntent()).toBeNull()
  })
  it('discards expired booking selection intents', () => {
    storage.set('yanqing_member_tab_intent', { url: '/pages/booking/index?couponId=old', at: Date.now() - 16 * 60_000 })
    expect(consumeBookingIntent()).toBeNull()
  })
  it('reuses the previous detail only for the same game, never another game', () => {
    pages.mockReturnValue([{ route: 'pages/game-detail/index', options: { id: 'game-1' } }, { route: 'pages/order/index', options: { id: 'order-1' } }])
    openMemberRecord('/pages/game-detail/index?id=game-1')
    expect(navigateBack).toHaveBeenCalledOnce()
    openMemberRecord('/pages/game-detail/index?id=game-2')
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/game-detail/index?id=game-2' })
    expect(navigateBack).toHaveBeenCalledOnce()
  })
  it('does not send a login for game B back to a cached game A', () => {
    pages.mockReturnValue([{ route: 'pages/game-detail/index', options: { id: 'game-a' } }, { route: 'pages/login/index' }])
    rememberLoginReturn('/pages/game-detail/index?id=game-b&from=share')
    finishMemberLogin()
    expect(navigateBack).not.toHaveBeenCalled()
    expect(redirectTo).toHaveBeenCalledWith({ url: '/pages/game-detail/index?id=game-b&from=share' })
  })
  it('rejects external, unregistered and administrative return destinations', () => {
    for (const path of ['https://example.com', '//example.com', '/packages/ops/pages/finance/index', '/pages/missing/index']) expect(safeMemberRoute(path)).toBeNull()
  })
  it('expires stale return intents', () => {
    storage.set('yanqing_member_login_return', { url: '/pages/wallet/index', at: Date.now() - 16 * 60_000 })
    expect(consumeLoginReturn()).toBeNull()
  })
})

describe('wallet progressive disclosure', () => {
  const account = (type: string, balance = 0, frozenBalance = 0) => ({ id: type, type, balance, frozenBalance })
  it('does not mix monetary balances with reward units', () => {
    expect(accountAmount('CASH_PRINCIPAL', 1200)).toBe('¥12.00')
    expect(accountAmount('GIFT_BALANCE', 200)).toBe('¥2.00')
    expect(accountAmount('BADMINTON_COIN', 20)).toBe('20 币')
    expect(accountAmount('EVENT_POINTS', 20)).toBe('20 分')
  })
  it('folds unused zero reward accounts, but preserves balances, frozen amounts and history', () => {
    const list = [account('CASH_PRINCIPAL'), account('GIFT_BALANCE'), account('BADMINTON_COIN'), account('EVENT_POINTS', 0, 10), account('GROWTH_POINTS')]
    expect(relevantAccounts(list, [{ account: { type: 'GROWTH_POINTS' } }]).map(item => item.type)).toEqual(['CASH_PRINCIPAL', 'GIFT_BALANCE', 'EVENT_POINTS', 'GROWTH_POINTS'])
    expect(relevantAccounts(list, [], true)).toHaveLength(5)
  })
})
