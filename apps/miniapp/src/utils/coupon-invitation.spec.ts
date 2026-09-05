import { describe, expect, it } from 'vitest'
import { couponClaimPath, couponCodeFromInput } from './coupon-invitation'
describe('coupon invitation input', () => {
  it('accepts direct card links and codes without exposing account IDs', () => {
    expect(couponCodeFromInput('YQ-COFFEE-2026')).toBe('YQ-COFFEE-2026')
    expect(couponCodeFromInput('https://yutechhn.cn/badminton/#' + couponClaimPath('YQ-TEST'))).toBe('YQ-TEST')
  })
  it.each(['https://evil.test/#/pages/coupon/index?claim=VALID', 'javascript:alert(1)', '<script>', 'x'.repeat(200)])('rejects untrusted input %s', value => {
    expect(couponCodeFromInput(value)).toBe('')
  })
})
