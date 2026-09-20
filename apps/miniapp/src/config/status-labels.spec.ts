import { describe, expect, it } from 'vitest'
import { statusLabel } from './status-labels'

describe('业务状态在各自上下文准确呈现', () => {
  it('待办与风险的 OPEN 不显示为活动报名中', () => {
    expect(statusLabel('OPEN')).toBe('报名中')
    expect(statusLabel('OPEN', 'work')).toBe('待处理')
    expect(statusLabel('OPEN', 'risk')).toBe('待处理')
  })
  it('批准退款与通道退款成功不能混为一谈', () => {
    expect(statusLabel('APPROVED', 'refund')).toBe('已批准')
    expect(statusLabel('PROCESSING', 'refund')).toBe('退款处理中')
    expect(statusLabel('SUCCEEDED', 'refund')).toBe('退款成功')
    expect(statusLabel('FAILED', 'refund')).toBe('退款失败')
  })
  it('培训和线索提供中文状态，未知值不会伪装成成功', () => {
    expect(statusLabel('SCHEDULED', 'training')).toBe('未开始')
    expect(statusLabel('CONTACTING', 'work')).toBe('跟进中')
    expect(statusLabel('FUTURE_STATE')).toBe('状态待确认')
  })
})
