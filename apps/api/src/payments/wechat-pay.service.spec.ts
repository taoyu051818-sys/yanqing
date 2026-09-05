import {
  createCipheriv,
  createSign,
  createVerify,
  generateKeyPairSync,
} from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { WechatPayService } from './wechat-pay.service.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const privatePem = privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const wechatKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const wechatPrivatePem = wechatKeys.privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();
const wechatPublicPem = wechatKeys.publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();
const publicKeyId = 'PUB_KEY_ID_TEST';
const values: Record<string, string> = {
  WECHAT_APP_ID: 'wx-test-app',
  WECHAT_PAY_MCH_ID: '1900000001',
  WECHAT_PAY_SERIAL_NO: 'SERIAL',
  WECHAT_PAY_PRIVATE_KEY: privatePem,
  WECHAT_PAY_NOTIFY_URL: 'https://example.com/notify',
  WECHAT_PAY_API_V3_KEY: '12345678901234567890123456789012',
  WECHAT_PAY_PUBLIC_KEY_ID: publicKeyId,
  WECHAT_PAY_PUBLIC_KEY: wechatPublicPem,
};
const service = new WechatPayService(
  { get: (key: string) => values[key] } as never,
  {} as never,
  {} as never,
);

const signedWechatResponse = (
  payload: Record<string, unknown>,
  options: { body?: string; serial?: string; signature?: string } = {},
) => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = 'wechat-response-nonce';
  const body = options.body ?? JSON.stringify(payload);
  const signer = createSign('RSA-SHA256');
  signer.update(`${timestamp}\n${nonce}\n${body}\n`);
  const signature =
    options.signature ?? signer.sign(wechatPrivatePem, 'base64');
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signature,
      'wechatpay-serial': options.serial ?? publicKeyId,
    },
  });
};

describe('WechatPayService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates verifiable RSA mini-program payment parameters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(signedWechatResponse({ prepay_id: 'prepay-123' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await service.createJsapiPayment({
      orderNo: 'O1',
      description: '订场',
      amountCents: 6800,
      openId: 'openid',
    });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(
      `wx-test-app\n${result.timeStamp}\n${result.nonceStr}\n${result.package}\n`,
    );
    expect(verifier.verify(publicPem, result.paySign, 'base64')).toBe(true);
    expect(result.package).toBe('prepay_id=prepay-123');
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const requestHeaders = firstCall?.[1]?.headers as Record<string, string>;
    expect(requestHeaders['Wechatpay-Serial']).toBe(publicKeyId);
  });

  it('rejects a response signed under an unexpected public key id', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          signedWechatResponse(
            { prepay_id: 'prepay-123' },
            { serial: 'PUB_KEY_ID_UNEXPECTED' },
          ),
        ),
    );
    await expect(
      service.createJsapiPayment({
        orderNo: 'O1',
        description: '订场',
        amountCents: 6800,
        openId: 'openid',
      }),
    ).rejects.toThrow('公钥ID不匹配');
  });

  it('rejects a response with an invalid WeChat Pay signature', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          signedWechatResponse(
            { prepay_id: 'prepay-123' },
            { signature: Buffer.from('invalid').toString('base64') },
          ),
        ),
    );
    await expect(
      service.createJsapiPayment({
        orderNo: 'O1',
        description: '订场',
        amountCents: 6800,
        openId: 'openid',
      }),
    ).rejects.toThrow('响应验签失败');
  });

  it('decrypts AES-256-GCM notification resources', () => {
    const notice = JSON.stringify({
      out_trade_no: 'O1',
      transaction_id: 'WX1',
      trade_state: 'SUCCESS',
      amount: { total: 6800 },
    });
    const nonce = '0123456789ab';
    const associatedData = 'transaction';
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(values.WECHAT_PAY_API_V3_KEY),
      Buffer.from(nonce),
    );
    cipher.setAAD(Buffer.from(associatedData));
    const ciphertext = Buffer.concat([
      cipher.update(notice),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64');
    const decrypted = (service as any).decrypt({
      ciphertext,
      nonce,
      associated_data: associatedData,
    });
    expect(decrypted).toMatchObject({
      out_trade_no: 'O1',
      transaction_id: 'WX1',
      trade_state: 'SUCCESS',
    });
  });

  it('submits signed domestic refund requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        signedWechatResponse({ refund_id: 'R1', status: 'PROCESSING' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const result = await service.createRefund({
      orderNo: 'O1',
      refundNo: 'RF1',
      refundCents: 1000,
      totalCents: 6800,
      reason: '用户退款',
    });
    expect(result).toEqual({ refundId: 'R1', status: 'PROCESSING' });
    expect(fetchMock.mock.calls[0][0]).toContain('/v3/refund/domestic/refunds');
  });
});
