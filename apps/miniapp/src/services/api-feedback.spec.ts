import { describe, expect, it } from 'vitest'
import { apiFeedback } from './api-feedback'

describe('member-facing API feedback', () => {
  it('does not render enum internals, HTML or framework errors', () => {
    expect(apiFeedback(['status must be one of the following values: PENDING, PAID'], 400)).toBe('提交的信息有误，请检查后重试')
    expect(apiFeedback('<html>404 Not Found</html>', 404)).toBe('内容暂时无法访问，请刷新后重试')
    expect(apiFeedback('服务器数据库连接失败: password=secret', 500)).toBe('服务暂时不可用，请稍后重试')
  })
  it('keeps actionable Chinese business errors and returns a string for arrays', () => {
    expect(apiFeedback(['订单状态筛选无效，请重新选择'], 400)).toBe('订单状态筛选无效，请重新选择')
    expect(apiFeedback('该场地时段刚刚被预订', 409)).toBe('该场地时段刚刚被预订')
    expect(apiFeedback(undefined, 403)).toBe('当前账号没有操作权限')
  })
})
