import { describe, expect, it } from 'vitest';

import { validateEnvironment } from './env.validation.js';

describe('environment validation', () => {
  it('applies safe development defaults', () => {
    const result = validateEnvironment({
      DATABASE_URL: 'postgresql://local/test',
      JWT_SECRET: '12345678901234567890123456789012',
    });
    expect(result.PORT).toBe(3200);
    expect(result.API_PREFIX).toBe('api/v1');
  });

  it('rejects missing database and weak JWT secrets', () => {
    expect(() => validateEnvironment({ JWT_SECRET: 'x'.repeat(32) })).toThrow(
      'DATABASE_URL',
    );
    expect(() =>
      validateEnvironment({
        DATABASE_URL: 'postgresql://local/test',
        JWT_SECRET: 'short',
      }),
    ).toThrow('32');
  });

  it('requires the complete certificate set when real WeChat Pay is enabled', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: 'postgresql://local/test',
        JWT_SECRET: 'x'.repeat(32),
        PAYMENT_PROVIDER: 'wechat',
      }),
    ).toThrow('WECHAT_PAY_MCH_ID');
  });

  it('accepts file-backed merchant keys and WeChat Pay public-key mode', () => {
    expect(
      validateEnvironment({
        DATABASE_URL: 'postgresql://local/test',
        JWT_SECRET: 'x'.repeat(32),
        PAYMENT_PROVIDER: 'wechat',
        WECHAT_APP_ID: 'wx-app',
        WECHAT_APP_SECRET: 'secret',
        WECHAT_PAY_MCH_ID: '1900000001',
        WECHAT_PAY_SERIAL_NO: 'SERIAL',
        WECHAT_PAY_PRIVATE_KEY_PATH: '/run/secrets/apiclient_key.pem',
        WECHAT_PAY_API_V3_KEY: 'y'.repeat(32),
        WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_TEST',
        WECHAT_PAY_PUBLIC_KEY_PATH: '/run/secrets/wechatpay_public_key.pem',
        WECHAT_PAY_NOTIFY_URL: 'https://api.example.com/payments/wechat/notify',
      }).PAYMENT_PROVIDER,
    ).toBe('wechat');
  });

  it('rejects an incomplete WeChat Pay public-key pair', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: 'postgresql://local/test',
        JWT_SECRET: 'x'.repeat(32),
        PAYMENT_PROVIDER: 'wechat',
        WECHAT_APP_ID: 'wx-app',
        WECHAT_APP_SECRET: 'secret',
        WECHAT_PAY_MCH_ID: '1900000001',
        WECHAT_PAY_SERIAL_NO: 'SERIAL',
        WECHAT_PAY_PRIVATE_KEY_PATH: '/run/secrets/apiclient_key.pem',
        WECHAT_PAY_API_V3_KEY: 'y'.repeat(32),
        WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_TEST',
        WECHAT_PAY_NOTIFY_URL: 'https://api.example.com/payments/wechat/notify',
      }),
    ).toThrow('public key pair');
  });
});
