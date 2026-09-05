export const money = (cents?: number | null) => `¥${((cents || 0) / 100).toFixed(2)}`
type DateValue = string | Date | null | undefined
const pad = (value: number) => String(value).padStart(2, '0')
// Venue times always use Beijing time. Some WeChat JS runtimes ignore the
// locale/options of toLocaleString and return an English date with GMT/CST.
function venueDate(value: DateValue) {
  if (!value) return null
  const input = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00+08:00` : value
  const timestamp = new Date(input).getTime()
  return Number.isFinite(timestamp) ? new Date(timestamp + 8 * 3_600_000) : null
}
const datePart = (date: Date) => `${pad(date.getUTCMonth() + 1)}月${pad(date.getUTCDate())}日`
const timePart = (date: Date) => `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
export const shortDate = (value?: DateValue) => {
  const date = venueDate(value)
  return date ? `${datePart(date)} ${timePart(date)}` : '待定'
}
export const venueDateLabel = (value?: DateValue) => {
  const date = venueDate(value)
  return date ? `${date.getUTCFullYear()}年${datePart(date)} 周${'日一二三四五六'[date.getUTCDay()]}` : '日期待定'
}
export const venueTimeRange = (start?: DateValue, end?: DateValue) => {
  const from = venueDate(start), to = venueDate(end)
  if (!from) return '时间待定'
  if (!to) return `${timePart(from)} 开始，结束时间待定`
  const sameDay = from.toISOString().slice(0, 10) === to.toISOString().slice(0, 10)
  const year = from.getUTCFullYear() === to.getUTCFullYear() ? '' : `${to.getUTCFullYear()}年`
  return `${timePart(from)}–${sameDay ? '' : `${year}${datePart(to)} `}${timePart(to)}`
}
export const dateTimeRange = (start?: DateValue, end?: DateValue) => {
  const from = venueDate(start)
  return from ? `${datePart(from)} ${venueTimeRange(start, end)}` : '时间待定'
}
export const today = () => venueDate(new Date())!.toISOString().slice(0, 10)
export const idempotencyKey = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
