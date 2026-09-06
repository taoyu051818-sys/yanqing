import { describe, expect, it } from 'vitest'
import { parseAdminLoginCode } from './admin-login'
describe('admin login QR payload', () => {
  const value = `yanqing-admin:550e8400-e29b-41d4-a716-446655440000:${'a'.repeat(43)}`
  it('accepts only a bounded one-time admin challenge', () => expect(parseAdminLoginCode(value)?.scanSecret).toHaveLength(43))
  it.each(['https://example.com', value+'extra', value.replace('yanqing-admin:', 'Bearer '), value.replace('550e8400', '../admin')])('rejects unrelated or malformed scans', (text) => expect(parseAdminLoginCode(text)).toBeNull())
})
