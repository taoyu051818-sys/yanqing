export function couponCodeFromInput(input: unknown): string {
  const value = String(input || '').trim()
  if (/^[A-Za-z0-9_-]{4,128}$/.test(value)) return value
  // Decode only a coupon claim route, never navigate to scanned arbitrary URLs.
  if (!/^https?:\/\/(yutechhn\.cn|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)\//.test(value)) return ''
  if (!value.includes('#/pages/coupon/index?')) return ''
  try {
    const match = value.match(/[?&]claim=([^&#]+)/)
    const code = match ? decodeURIComponent(match[1]) : ''
    return /^[A-Za-z0-9_-]{4,128}$/.test(code) ? code : ''
  } catch { return '' }
}
export function couponClaimPath(code: string) {
  return '/pages/coupon/index?claim=' + encodeURIComponent(code)
}
