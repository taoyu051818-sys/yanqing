import { describe, expect, it } from 'vitest'

import { validateEnvironment } from './env.validation.js'

describe('environment validation', () => {
  it('applies safe development defaults', () => {
    const result = validateEnvironment({
      DATABASE_URL: 'postgresql://local/test',
      JWT_SECRET: '12345678901234567890123456789012',
    })
    expect(result.PORT).toBe(3200)
    expect(result.API_PREFIX).toBe('api/v1')
  })

  it('rejects missing database and weak JWT secrets', () => {
    expect(() => validateEnvironment({ JWT_SECRET: 'x'.repeat(32) })).toThrow('DATABASE_URL')
    expect(() => validateEnvironment({ DATABASE_URL: 'postgresql://local/test', JWT_SECRET: 'short' })).toThrow('32')
  })

  it('requires the complete certificate set when real WeChat Pay is enabled', () => {
    expect(() => validateEnvironment({
      DATABASE_URL: 'postgresql://local/test', JWT_SECRET: 'x'.repeat(32), PAYMENT_PROVIDER: 'wechat',
    })).toThrow('WECHAT_PAY_MCH_ID')
  })
})
