export const validateEnvironment = (
  input: Record<string, unknown>,
): Record<string, unknown> => {
  const environment = { ...input };
  environment.NODE_ENV = String(input.NODE_ENV ?? 'development');
  const devLoginEnabled = String(input.DEV_LOGIN_ENABLED ?? 'false');
  if (!['true', 'false'].includes(devLoginEnabled))
    throw new Error('DEV_LOGIN_ENABLED must be true or false');
  if (devLoginEnabled === 'true' && !['development', 'test', 'staging'].includes(String(environment.NODE_ENV)))
    throw new Error('DEV_LOGIN_ENABLED is forbidden outside development/test/staging');
  environment.DEV_LOGIN_ENABLED = devLoginEnabled;
  const adminOrigin = String(input.ADMIN_CONSOLE_ORIGIN ?? '');
  if (adminOrigin) {
    let parsed: URL;
    try { parsed = new URL(adminOrigin); } catch { throw new Error('ADMIN_CONSOLE_ORIGIN must be an origin URL'); }
    const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.origin !== adminOrigin || (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:' && ['development', 'test'].includes(String(environment.NODE_ENV)))))
      throw new Error('ADMIN_CONSOLE_ORIGIN requires HTTPS, or local HTTP in development/test');
  }
  environment.ADMIN_CONSOLE_ORIGIN = adminOrigin;
  environment.PORT = Number(input.PORT ?? 3200);
  environment.HOST = String(input.HOST ?? '0.0.0.0');
  environment.API_PREFIX = String(input.API_PREFIX ?? 'api/v1');

  if (!input.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const jwtSecret = String(input.JWT_SECRET ?? '');
  if (jwtSecret.length < 32)
    throw new Error('JWT_SECRET must contain at least 32 characters');
  environment.JWT_SECRET = jwtSecret;
  environment.JWT_EXPIRES_IN = String(input.JWT_EXPIRES_IN ?? '7d');
  environment.PAYMENT_PROVIDER = String(input.PAYMENT_PROVIDER ?? 'mock');
  if (environment.PAYMENT_PROVIDER === 'wechat') {
    const required = [
      'WECHAT_APP_ID',
      'WECHAT_APP_SECRET',
      'WECHAT_PAY_MCH_ID',
      'WECHAT_PAY_SERIAL_NO',
      'WECHAT_PAY_API_V3_KEY',
      'WECHAT_PAY_NOTIFY_URL',
    ];
    const missing = required.filter((key) => !input[key]);
    if (!input.WECHAT_PAY_PRIVATE_KEY && !input.WECHAT_PAY_PRIVATE_KEY_PATH) {
      missing.push('WECHAT_PAY_PRIVATE_KEY or WECHAT_PAY_PRIVATE_KEY_PATH');
    }
    const hasPublicKeyMode = Boolean(
      input.WECHAT_PAY_PUBLIC_KEY_ID &&
      (input.WECHAT_PAY_PUBLIC_KEY || input.WECHAT_PAY_PUBLIC_KEY_PATH),
    );
    const hasPlatformCertificate = Boolean(
      input.WECHAT_PAY_PLATFORM_CERT || input.WECHAT_PAY_PLATFORM_CERT_PATH,
    );
    if (!hasPublicKeyMode && !hasPlatformCertificate) {
      missing.push('WeChat Pay public key pair or platform certificate');
    }
    if (missing.length)
      throw new Error(
        `WeChat payment configuration missing: ${missing.join(', ')}`,
      );
  }
  const monitorEnabled = String(input.BOSS_MONITOR_ENABLED ?? 'true');
  if (!['true','false'].includes(monitorEnabled)) throw new Error('BOSS_MONITOR_ENABLED must be true or false');
  environment.BOSS_MONITOR_ENABLED = monitorEnabled;
  if (input.BOSS_LLM_API_KEY) {
    const base = String(input.BOSS_LLM_BASE_URL ?? 'https://vip.aipro.love/v1');
    let parsed: URL;
    try { parsed = new URL(base); } catch { throw new Error('BOSS_LLM_BASE_URL must be a valid HTTPS URL'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('BOSS_LLM_BASE_URL must be a credential-free HTTPS URL');
    environment.BOSS_LLM_BASE_URL = base;
    environment.BOSS_LLM_MODEL = String(input.BOSS_LLM_MODEL ?? 'gpt-5.6-sol');
  }
  for (const key of ['LARGE_ORDER_CENTS','LARGE_RECHARGE_CENTS','FREQUENT_REFUND_COUNT','PAYMENT_STUCK_MINUTES','OVERDUE_ORDER_MINUTES','LOW_UTILIZATION_PERCENT','NEAR_FULL_PERCENT','LOW_SIGNUP_PERCENT','SIGNUP_LEAD_HOURS']) {
    const value = input['BOSS_' + key];
    if (value !== undefined && value !== '' && (!Number.isSafeInteger(Number(value)) || Number(value) <= 0 || (key.endsWith('PERCENT') && Number(value) > 100))) throw new Error('BOSS_' + key + ' must be a positive integer in range');
  }
  return environment;
};
