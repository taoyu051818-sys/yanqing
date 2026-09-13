import type { WechatPaymentParameters } from '@yanqing/shared';
import {
  createDecipheriv,
  createSign,
  createVerify,
  randomBytes,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { OrderFinalizerService } from './order-finalizer.service.js';
import {
  NotificationResource,
  WechatNotification,
  TransactionNotice,
  RefundNotice,
} from './wechat/wechat-notice-types.js';
import { finalizeWechatPayment } from './wechat/payment-notification.js';
import { finalizeRefund } from './wechat/refund-notification.js';

@Injectable()
export class WechatPayService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly finalizer: OrderFinalizerService,
  ) {}

  async createJsapiPayment(input: {
    orderNo: string;
    description: string;
    amountCents: number;
    openId: string;
  }): Promise<WechatPaymentParameters> {
    const appId = this.required('WECHAT_APP_ID');
    const mchId = this.required('WECHAT_PAY_MCH_ID');
    const serialNo = this.required('WECHAT_PAY_SERIAL_NO');
    const privateKey = this.privateKey();
    const notifyUrl = this.required('WECHAT_PAY_NOTIFY_URL');
    const body = JSON.stringify({
      appid: appId,
      mchid: mchId,
      description: input.description.slice(0, 127),
      out_trade_no: input.orderNo,
      notify_url: notifyUrl,
      amount: { total: input.amountCents, currency: 'CNY' },
      payer: { openid: input.openId },
    });
    const path = '/v3/pay/transactions/jsapi';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    const signature = this.rsaSign(
      `POST\n${path}\n${timestamp}\n${nonce}\n${body}\n`,
      privateKey,
    );
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`;
    const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
      method: 'POST',
      headers: {
        authorization,
        accept: 'application/json',
        'accept-encoding': 'identity',
        'content-type': 'application/json',
        'user-agent': 'yanqing-badminton/1.0',
        ...this.wechatpaySerialHeader(),
      },
      body,
    });
    const result = await this.readWechatJson<{
      prepay_id?: string;
      message?: string;
    }>(response);
    if (!response.ok || !result.prepay_id)
      throw new BadGatewayException(result.message || '微信支付下单失败');
    const payTimestamp = Math.floor(Date.now() / 1000).toString();
    const payNonce = randomBytes(16).toString('hex');
    const packageValue = `prepay_id=${result.prepay_id}`;
    return {
      timeStamp: payTimestamp,
      nonceStr: payNonce,
      package: packageValue,
      signType: 'RSA',
      paySign: this.rsaSign(
        `${appId}\n${payTimestamp}\n${payNonce}\n${packageValue}\n`,
        privateKey,
      ),
    };
  }

  async createRefund(input: {
    orderNo: string;
    refundNo: string;
    refundCents: number;
    totalCents: number;
    reason: string;
  }) {
    const notifyUrl =
      this.config.get<string>('WECHAT_PAY_REFUND_NOTIFY_URL') ||
      this.required('WECHAT_PAY_NOTIFY_URL');
    const path = '/v3/refund/domestic/refunds';
    const body = JSON.stringify({
      out_trade_no: input.orderNo,
      out_refund_no: input.refundNo,
      reason: input.reason.slice(0, 80),
      notify_url: notifyUrl,
      amount: {
        refund: input.refundCents,
        total: input.totalCents,
        currency: 'CNY',
      },
    });
    const response = await this.signedRequest('POST', path, body);
    const result = await this.readWechatJson<{
      refund_id?: string;
      status?: string;
      message?: string;
    }>(response);
    if (!response.ok || !result.refund_id)
      throw new BadGatewayException(result.message || '微信退款申请失败');
    return {
      refundId: result.refund_id,
      status: result.status || 'PROCESSING',
    };
  }

  async closeOrder(orderNo: string) {
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}/close`;
    const body = JSON.stringify({ mchid: this.required('WECHAT_PAY_MCH_ID') });
    const response = await this.signedRequest('POST', path, body);
    const result = await this.readWechatJson<{
      code?: string;
      message?: string;
    }>(response);
    if (!response.ok) {
      if (result.code === 'ORDERPAID') {
        throw new ConflictException(
          '微信支付已经完成，正在同步支付结果，请稍后刷新',
        );
      }
      throw new BadGatewayException(result.message || '微信支付订单关闭失败');
    }
    return { closed: true };
  }

  async queryRefund(
    refundNo: string,
    expected: { orderNo: string; refundCents: number; totalCents: number },
  ) {
    const response = await this.signedRequest(
      'GET',
      `/v3/refund/domestic/refunds/${encodeURIComponent(refundNo)}`,
      '',
    );
    const result = await this.readWechatJson<{
      refund_id?: string;
      out_refund_no?: string;
      out_trade_no?: string;
      status?: string;
      amount?: { refund: number; total: number };
      code?: string;
      message?: string;
    }>(response);
    if (response.status === 404 && result.code === 'RESOURCE_NOT_EXISTS')
      return null;
    if (!response.ok || !result.refund_id || !result.status)
      throw new BadGatewayException(result.message || '微信退款查询失败');
    if (
      result.out_refund_no !== refundNo ||
      result.out_trade_no !== expected.orderNo ||
      result.amount?.refund !== expected.refundCents ||
      result.amount?.total !== expected.totalCents
    )
      throw new BadGatewayException('微信退款查询结果与本地订单不一致');
    return { refundId: result.refund_id, status: result.status };
  }

  async handleNotification(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const timestamp = this.header(headers, 'wechatpay-timestamp');
    const nonce = this.header(headers, 'wechatpay-nonce');
    const signature = this.header(headers, 'wechatpay-signature');
    const serial = this.header(headers, 'wechatpay-serial');
    const timestampSeconds = Number(timestamp);
    if (
      !Number.isFinite(timestampSeconds) ||
      Math.abs(Date.now() / 1000 - timestampSeconds) > 300
    )
      throw new UnauthorizedException('微信支付通知已过期');
    this.verifyWechatSignature(
      rawBody.toString('utf8'),
      timestamp,
      nonce,
      signature,
      serial,
      '微信支付通知验签失败',
    );
    const notification = JSON.parse(
      rawBody.toString('utf8'),
    ) as WechatNotification;
    if (notification.event_type === 'REFUND.SUCCESS') {
      const notice = this.decrypt<RefundNotice>(notification.resource);
      if (notice.refund_status !== 'SUCCESS')
        return { accepted: true, ignored: true };
      return finalizeRefund(this.prisma, this.finalizer, notice);
    }
    const notice = this.decrypt<TransactionNotice>(notification.resource);
    if (
      notification.event_type !== 'TRANSACTION.SUCCESS' ||
      notice.trade_state !== 'SUCCESS'
    )
      return { accepted: true, ignored: true };
    return finalizeWechatPayment(this.prisma, this.finalizer, notice);
  }

  /**
   * Reverses as much of the principal/gift split as is currently available
   * after the provider has confirmed the refund. Account balances have a DB
   * non-negative constraint, so spent or frozen value becomes an explicit
   * recovery shortfall instead of rolling the external refund terminal state
   * back. Each actual debit has a refund-scoped idempotency key.
   */

  private decrypt<T>(resource: NotificationResource): T {
    const key = Buffer.from(this.required('WECHAT_PAY_API_V3_KEY'), 'utf8');
    if (key.length !== 32)
      throw new BadRequestException('WECHAT_PAY_API_V3_KEY 必须为32字节');
    const encrypted = Buffer.from(resource.ciphertext, 'base64');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(resource.nonce, 'utf8'),
    );
    decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'));
    decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
    const clear = Buffer.concat([
      decipher.update(encrypted.subarray(0, -16)),
      decipher.final(),
    ]);
    return JSON.parse(clear.toString('utf8')) as T;
  }

  private async signedRequest(method: string, path: string, body: string) {
    const mchId = this.required('WECHAT_PAY_MCH_ID');
    const serialNo = this.required('WECHAT_PAY_SERIAL_NO');
    const privateKey = this.privateKey();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    const signature = this.rsaSign(
      `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`,
      privateKey,
    );
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`;
    return fetch(`https://api.mch.weixin.qq.com${path}`, {
      method,
      headers: {
        authorization,
        accept: 'application/json',
        'accept-encoding': 'identity',
        'content-type': 'application/json',
        'user-agent': 'yanqing-badminton/1.0',
        ...this.wechatpaySerialHeader(),
      },
      body: method === 'GET' ? undefined : body,
      signal: AbortSignal.timeout(10_000),
    });
  }

  private async readWechatJson<T>(response: Response): Promise<T> {
    const rawBody = await response.text();
    if (response.ok) {
      this.verifyWechatSignature(
        rawBody,
        this.responseHeader(response.headers, 'wechatpay-timestamp'),
        this.responseHeader(response.headers, 'wechatpay-nonce'),
        this.responseHeader(response.headers, 'wechatpay-signature'),
        this.responseHeader(response.headers, 'wechatpay-serial'),
        '微信支付响应验签失败',
      );
    }
    if (!rawBody) return {} as T;
    try {
      return JSON.parse(rawBody) as T;
    } catch {
      throw new BadGatewayException('微信支付返回了无效响应');
    }
  }

  private verifyWechatSignature(
    rawBody: string,
    timestamp: string,
    nonce: string,
    signature: string,
    serial: string,
    failureMessage: string,
  ) {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
    if (
      !verifier.verify(this.wechatVerificationKey(serial), signature, 'base64')
    )
      throw new UnauthorizedException(failureMessage);
  }

  private wechatVerificationKey(serial: string): string {
    const publicKeyId = this.config.get<string>('WECHAT_PAY_PUBLIC_KEY_ID');
    const publicKey = this.optionalPem(
      'WECHAT_PAY_PUBLIC_KEY',
      'WECHAT_PAY_PUBLIC_KEY_PATH',
    );
    if (publicKeyId || publicKey) {
      if (!publicKeyId || !publicKey)
        throw new BadGatewayException('微信支付公钥配置不完整');
      if (serial !== publicKeyId)
        throw new UnauthorizedException('微信支付签名公钥ID不匹配');
      return publicKey;
    }
    return this.pem(
      'WECHAT_PAY_PLATFORM_CERT',
      'WECHAT_PAY_PLATFORM_CERT_PATH',
    );
  }

  private wechatpaySerialHeader(): Record<string, string> {
    const publicKeyId = this.config.get<string>('WECHAT_PAY_PUBLIC_KEY_ID');
    return publicKeyId ? { 'Wechatpay-Serial': publicKeyId } : {};
  }

  private privateKey(): string {
    return this.pem('WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_PRIVATE_KEY_PATH');
  }

  private optionalPem(valueKey: string, pathKey: string): string | undefined {
    const inlineValue = this.config.get<string>(valueKey);
    if (inlineValue) return inlineValue.replace(/\\n/g, '\n');
    const path = this.config.get<string>(pathKey);
    if (!path) return undefined;
    try {
      return readFileSync(path, 'utf8');
    } catch {
      throw new BadGatewayException(`${pathKey} 无法读取`);
    }
  }

  private pem(valueKey: string, pathKey: string): string {
    const value = this.optionalPem(valueKey, pathKey);
    if (!value)
      throw new BadGatewayException(`${valueKey} 或 ${pathKey} 尚未配置`);
    return value;
  }

  private rsaSign(message: string, privateKey: string) {
    const signer = createSign('RSA-SHA256');
    signer.update(message);
    return signer.sign(privateKey, 'base64');
  }

  private header(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ) {
    const value = headers[name];
    const normalized = Array.isArray(value) ? value[0] : value;
    if (!normalized) throw new UnauthorizedException(`缺少 ${name}`);
    return normalized;
  }

  private responseHeader(headers: Headers, name: string) {
    const value = headers.get(name);
    if (!value) throw new UnauthorizedException(`微信支付响应缺少 ${name}`);
    return value;
  }

  private required(key: string) {
    const value = this.config.get<string>(key);
    if (!value) throw new BadGatewayException(`${key} 尚未配置`);
    return value;
  }
}
