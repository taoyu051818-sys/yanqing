import { afterEach, describe, expect, it, vi } from 'vitest'
import { dateTimeRange, shortDate, today, venueDateLabel, venueTimeRange } from './format'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
describe('portable Beijing venue time presentation', () => {
  it('never relies on native locale methods, including WeChat runtimes returning CST', () => {
    for (const method of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as const) {
      vi.spyOn(Date.prototype, method).mockImplementation(() => 'Mon Sep 07 2026 19:00:00 GMT+0800 (CST)')
    }
    expect(shortDate('2026-09-07T11:00:00Z')).toBe('09月07日 19:00')
    expect(venueDateLabel('2026-09-07T11:00:00Z')).toBe('2026年09月07日 周一')
    expect(venueTimeRange('2026-09-07T11:00:00Z', '2026-09-07T13:00:00Z')).toBe('19:00–21:00')
    expect(dateTimeRange('2026-09-07T19:00:00+08:00', '2026-09-07T21:00:00+08:00')).toBe('09月07日 19:00–21:00')
  })
  it('handles midnight, cross-day and cross-year without implying an earlier end', () => {
    expect(shortDate('2026-09-07T16:00:00Z')).toBe('09月08日 00:00')
    expect(venueTimeRange('2026-09-07T15:00:00Z', '2026-09-07T16:00:00Z')).toBe('23:00–09月08日 00:00')
    expect(venueTimeRange('2026-12-31T15:00:00Z', '2026-12-31T17:00:00Z')).toBe('23:00–2027年01月01日 01:00')
  })
  it('uses readable fallbacks and accepts Date and date-only values', () => {
    expect(shortDate(new Date('2026-09-07T11:00:00Z'))).toBe('09月07日 19:00')
    expect(shortDate('2026-09-07')).toBe('09月07日 00:00')
    for (const value of [null, undefined, '', 'invalid']) expect(shortDate(value)).toBe('待定')
    expect(venueTimeRange(null, null)).toBe('时间待定')
    expect(venueTimeRange('2026-09-07T11:00:00Z', null)).toBe('19:00 开始，结束时间待定')
  })
  it('uses the venue calendar day regardless of device timezone', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-07T16:01:00Z'))
    expect(today()).toBe('2026-09-08')
  })
})
