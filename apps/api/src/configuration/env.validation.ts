export const validateEnvironment = (input: Record<string, unknown>): Record<string, unknown> => {
  const environment = { ...input }
  environment.NODE_ENV = String(input.NODE_ENV ?? 'development')
  environment.PORT = Number(input.PORT ?? 3200)
  environment.API_PREFIX = String(input.API_PREFIX ?? 'api/v1')

  if (!input.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const jwtSecret = String(input.JWT_SECRET ?? '')
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters')
  environment.JWT_SECRET = jwtSecret
  environment.JWT_EXPIRES_IN = String(input.JWT_EXPIRES_IN ?? '7d')
  environment.PAYMENT_PROVIDER = String(input.PAYMENT_PROVIDER ?? 'mock')
  if (environment.PAYMENT_PROVIDER === 'wechat') {
    const required = [
      'WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'WECHAT_PAY_MCH_ID', 'WECHAT_PAY_SERIAL_NO',
      'WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_API_V3_KEY', 'WECHAT_PAY_PLATFORM_CERT', 'WECHAT_PAY_NOTIFY_URL',
    ]
    const missing = required.filter((key) => !input[key])
    if (missing.length) throw new Error(`WeChat payment configuration missing: ${missing.join(', ')}`)
  }
  return environment
}
