export const validateEnvironment = (
  input: Record<string, unknown>,
): Record<string, unknown> => {
  const environment = { ...input };
  environment.NODE_ENV = String(input.NODE_ENV ?? 'development');
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
  return environment;
};
