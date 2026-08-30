import { createCipheriv, createVerify, generateKeyPairSync } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { WechatPayService } from './wechat-pay.service.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const values: Record<string, string> = {
  WECHAT_APP_ID: 'wx-test-app', WECHAT_PAY_MCH_ID: '1900000001', WECHAT_PAY_SERIAL_NO: 'SERIAL',
  WECHAT_PAY_PRIVATE_KEY: privatePem, WECHAT_PAY_NOTIFY_URL: 'https://example.com/notify',
  WECHAT_PAY_API_V3_KEY: '12345678901234567890123456789012', WECHAT_PAY_PLATFORM_CERT: publicPem,
}
const service = new WechatPayService({ get: (key: string) => values[key] } as never, {} as never, {} as never)

describe('WechatPayService', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('creates verifiable RSA mini-program payment parameters', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ prepay_id: 'prepay-123' }) }))
    const result = await service.createJsapiPayment({ orderNo: 'O1', description: '订场', amountCents: 6800, openId: 'openid' })
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`wx-test-app\n${result.timeStamp}\n${result.nonceStr}\n${result.package}\n`)
    expect(verifier.verify(publicPem, result.paySign, 'base64')).toBe(true)
    expect(result.package).toBe('prepay_id=prepay-123')
  })

  it('decrypts AES-256-GCM notification resources', () => {
    const notice = JSON.stringify({ out_trade_no: 'O1', transaction_id: 'WX1', trade_state: 'SUCCESS', amount: { total: 6800 } })
    const nonce = '0123456789ab'
    const associatedData = 'transaction'
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(values.WECHAT_PAY_API_V3_KEY), Buffer.from(nonce))
    cipher.setAAD(Buffer.from(associatedData))
    const ciphertext = Buffer.concat([cipher.update(notice), cipher.final(), cipher.getAuthTag()]).toString('base64')
    const decrypted = (service as any).decrypt({ ciphertext, nonce, associated_data: associatedData })
    expect(decrypted).toMatchObject({ out_trade_no: 'O1', transaction_id: 'WX1', trade_state: 'SUCCESS' })
  })

  it('submits signed domestic refund requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ refund_id: 'R1', status: 'PROCESSING' }) })
    vi.stubGlobal('fetch', fetchMock)
    const result = await service.createRefund({ orderNo: 'O1', refundNo: 'RF1', refundCents: 1000, totalCents: 6800, reason: '用户退款' })
    expect(result).toEqual({ refundId: 'R1', status: 'PROCESSING' })
    expect(fetchMock.mock.calls[0][0]).toContain('/v3/refund/domestic/refunds')
  })
})
