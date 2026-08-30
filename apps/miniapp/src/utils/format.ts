export const money = (cents?: number | null) => `¥${((cents || 0) / 100).toFixed(2)}`
export const shortDate = (value?: string | Date | null) => value
  ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  : '待定'
export const today = () => {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}
export const idempotencyKey = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
