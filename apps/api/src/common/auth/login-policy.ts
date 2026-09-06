import type { ConfigService } from '@nestjs/config'

export type LoginMethod = 'wechat' | 'development'

// A deployment label such as staging must never implicitly enable impersonation.
export const developmentLoginEnabled = (config: ConfigService): boolean =>
  ['development', 'test', 'staging'].includes(config.get<string>('NODE_ENV', 'development'))
  && config.get<string>('DEV_LOGIN_ENABLED', 'false') === 'true'

export const loginMethodAllowed = (method: unknown, config: ConfigService): boolean => {
  if (method === 'wechat') return true
  // Legacy tokens did not record their login method. Closing development login
  // invalidates those tokens too, since their provenance cannot be established.
  return (method === 'development' || method === undefined) && developmentLoginEnabled(config)
}
