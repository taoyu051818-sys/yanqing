import { createDecipheriv, createSign, createVerify, randomBytes } from 'node:crypto'

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { PrismaService } from '../database/prisma.service.js'
import {
  AccountTxnKind,
  AccountType,
  AppRole,
  BookingStatus,
  BusinessType,
  InventoryTxnType,
  MembershipStatus,
  OrderStatus,
  PaymentChannel,
  PaymentStatus,
  Prisma,
  RefundStatus,
  RewardStatus,
} from '../generated/prisma/client.js'
import { applyInventoryDelta } from '../inventory/inventory-balance.js'
import { OrderFinalizerService } from './order-finalizer.service.js'
import { promoteNextGameWaitlist } from '../games/games.service.js'

interface NotificationResource { ciphertext: string; nonce: string; associated_data?: string }
interface WechatNotification { event_type: string; resource: NotificationResource }
interface TransactionNotice { out_trade_no: string; transaction_id: string; trade_state: string; amount: { total: number } }
interface RefundNotice { out_refund_no: string; refund_id: string; refund_status: string; amount: { refund: number; total: number } }

@Injectable()
export class WechatPayService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly finalizer: OrderFinalizerService,
  ) {}

  async createJsapiPayment(input: { orderNo: string; description: string; amountCents: number; openId: string }) {
    const appId = this.required('WECHAT_APP_ID')
    const mchId = this.required('WECHAT_PAY_MCH_ID')
    const serialNo = this.required('WECHAT_PAY_SERIAL_NO')
    const privateKey = this.required('WECHAT_PAY_PRIVATE_KEY').replace(/\\n/g, '\n')
    const notifyUrl = this.required('WECHAT_PAY_NOTIFY_URL')
    const body = JSON.stringify({
      appid: appId, mchid: mchId, description: input.description.slice(0, 127),
      out_trade_no: input.orderNo, notify_url: notifyUrl,
      amount: { total: input.amountCents, currency: 'CNY' }, payer: { openid: input.openId },
    })
    const path = '/v3/pay/transactions/jsapi'
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonce = randomBytes(16).toString('hex')
    const signature = this.rsaSign(`POST\n${path}\n${timestamp}\n${nonce}\n${body}\n`, privateKey)
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`
    const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
      method: 'POST', headers: { authorization, accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'yanqing-badminton/1.0' }, body,
    })
    const result = await response.json() as { prepay_id?: string; message?: string }
    if (!response.ok || !result.prepay_id) throw new BadGatewayException(result.message || '微信支付下单失败')
    const payTimestamp = Math.floor(Date.now() / 1000).toString()
    const payNonce = randomBytes(16).toString('hex')
    const packageValue = `prepay_id=${result.prepay_id}`
    return {
      timeStamp: payTimestamp, nonceStr: payNonce, package: packageValue, signType: 'RSA',
      paySign: this.rsaSign(`${appId}\n${payTimestamp}\n${payNonce}\n${packageValue}\n`, privateKey),
    }
  }

  async createRefund(input: { orderNo: string; refundNo: string; refundCents: number; totalCents: number; reason: string }) {
    const notifyUrl = this.config.get<string>('WECHAT_PAY_REFUND_NOTIFY_URL') || this.required('WECHAT_PAY_NOTIFY_URL')
    const path = '/v3/refund/domestic/refunds'
    const body = JSON.stringify({
      out_trade_no: input.orderNo,
      out_refund_no: input.refundNo,
      reason: input.reason.slice(0, 80),
      notify_url: notifyUrl,
      amount: { refund: input.refundCents, total: input.totalCents, currency: 'CNY' },
    })
    const response = await this.signedRequest('POST', path, body)
    const result = await response.json() as { refund_id?: string; status?: string; message?: string }
    if (!response.ok || !result.refund_id) throw new BadGatewayException(result.message || '微信退款申请失败')
    return { refundId: result.refund_id, status: result.status || 'PROCESSING' }
  }

  async handleNotification(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const timestamp = this.header(headers, 'wechatpay-timestamp')
    const nonce = this.header(headers, 'wechatpay-nonce')
    const signature = this.header(headers, 'wechatpay-signature')
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new UnauthorizedException('微信支付通知已过期')
    const publicCert = this.required('WECHAT_PAY_PLATFORM_CERT').replace(/\\n/g, '\n')
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${timestamp}\n${nonce}\n${rawBody.toString('utf8')}\n`)
    if (!verifier.verify(publicCert, signature, 'base64')) throw new UnauthorizedException('微信支付通知验签失败')
    const notification = JSON.parse(rawBody.toString('utf8')) as WechatNotification
    if (notification.event_type === 'REFUND.SUCCESS') {
      const notice = this.decrypt<RefundNotice>(notification.resource)
      if (notice.refund_status !== 'SUCCESS') return { accepted: true, ignored: true }
      return this.finalizeRefund(notice)
    }
    const notice = this.decrypt<TransactionNotice>(notification.resource)
    if (notification.event_type !== 'TRANSACTION.SUCCESS' || notice.trade_state !== 'SUCCESS') return { accepted: true, ignored: true }
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNo: notice.out_trade_no },
        include: { items: true, membership: { include: { product: true } }, member: { select: { openId: true } }, payments: { where: { channel: PaymentChannel.WECHAT }, orderBy: { createdAt: 'desc' } } },
      })
      if (!order) throw new BadRequestException('微信支付订单不存在')
      if (notice.amount.total !== order.payableCents) throw new BadRequestException('微信支付通知金额不一致')
      const payment = order.payments[0]
      if (!payment) throw new BadRequestException('微信支付记录不存在')
      if (payment.status === PaymentStatus.SUCCEEDED && order.status !== OrderStatus.PENDING) return { accepted: true, idempotent: true }
      const succeeded = await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.SUCCEEDED, providerTradeNo: notice.transaction_id, paidAt: new Date(), providerPayload: { provider: 'wechat', transactionId: notice.transaction_id } },
      })
      await this.finalizer.finalize(
        tx,
        order,
        { ...succeeded, amountCents: succeeded.amountCents },
        order.memberId,
        AppRole.MEMBER,
      )
      return { accepted: true }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  }

  private async finalizeRefund(notice: RefundNotice) {
    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { refundNo: notice.out_refund_no },
        include: {
          order: {
            include: {
              trainingEnrollment: true,
              membership: { include: { product: true } },
              items: true,
              gameRegistration: true,
              payments: { where: { status: PaymentStatus.SUCCEEDED }, orderBy: { createdAt: 'asc' } },
            },
          },
        },
      })
      if (!refund) throw new BadRequestException('微信退款记录不存在')
      if (refund.amountCents !== notice.amount.refund || refund.order.paidCents !== notice.amount.total) {
        throw new BadRequestException('微信退款通知金额不一致')
      }
      if (refund.status === RefundStatus.SUCCEEDED) return { accepted: true, idempotent: true }
      const refundedCents = refund.order.refundedCents + refund.amountCents
      const fullyRefunded = refundedCents >= refund.order.paidCents
      const now = new Date()
      await tx.refund.update({
        where: { id: refund.id },
        data: { status: RefundStatus.SUCCEEDED, providerRefundNo: notice.refund_id, completedAt: now },
      })
      await tx.order.update({
        where: { id: refund.orderId },
        data: { refundedCents, status: fullyRefunded ? OrderStatus.REFUNDED : OrderStatus.PARTIALLY_REFUNDED },
      })
      if (refund.order.trainingEnrollment) {
        const enrollment = refund.order.trainingEnrollment
        const enrollmentRefunded = Math.min(enrollment.totalAmountCents, enrollment.refundedCents + refund.amountCents)
        await tx.trainingEnrollment.update({
          where: { id: enrollment.id },
          data: {
            refundedCents: enrollmentRefunded,
            prepaidBalanceCents: Math.max(0, enrollment.totalAmountCents - enrollment.confirmedRevenueCents - enrollmentRefunded),
            status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
          },
        })
      }
      if (refund.order.businessType === BusinessType.RECHARGE) {
        const payment = refund.order.payments[0]
        if (!payment || payment.amountCents <= 0) {
          throw new BadRequestException('充值退款缺少成功支付记录')
        }
        await this.reverseRechargeBalance(tx, refund, payment.amountCents)
      }
      if (fullyRefunded) {
        await tx.courtBooking.updateMany({ where: { orderId: refund.orderId }, data: { status: BookingStatus.CANCELLED } })
        if (refund.order.membership) {
          await tx.memberSubscription.update({ where: { id: refund.order.membership.id }, data: { status: MembershipStatus.CANCELLED } })
          const latest = await tx.memberSubscription.findFirst({
            where: { memberId: refund.order.membership.memberId, status: MembershipStatus.ACTIVE, id: { not: refund.order.membership.id } },
            include: { product: true }, orderBy: { endsAt: 'desc' },
          })
          await tx.memberProfile.update({
            where: { id: refund.order.membership.memberId },
            data: { level: latest?.product.level ?? 'EXPERIENCE', membershipExpiresAt: latest?.endsAt },
          })
        }
        if (refund.order.businessType === BusinessType.GOODS) {
          for (const item of refund.order.items) {
            if (!item.itemId) continue
            const inventory = await tx.inventoryItem.findUniqueOrThrow({ where: { id: item.itemId } })
            const { stockAfter } = await applyInventoryDelta(tx, inventory, item.quantity)
            await tx.inventoryTransaction.create({ data: {
              itemId: inventory.id, type: InventoryTxnType.ADJUSTMENT, quantity: item.quantity,
              stockBefore: inventory.stock, stockAfter,
              unitCostCents: inventory.purchasePriceCents, orderItemId: item.id,
              operatorId: refund.approvedById || refund.requestedById,
              reason: `微信退款 ${refund.refundNo} 退货入库`, idempotencyKey: `GOODS-REFUND:${refund.id}:${item.id}`,
            } })
          }
        }
        if (refund.order.businessType === BusinessType.GAME && refund.order.gameRegistration) {
          await tx.gameRegistration.update({
            where: { id: refund.order.gameRegistration.id },
            data: { status: 'REFUNDED' },
          })
          await promoteNextGameWaitlist(
            tx,
            refund.order.gameRegistration.gameId,
            refund.approvedById || refund.requestedById,
            AppRole.FINANCE,
          )
        }
      }
      await tx.referralReward.updateMany({
        where: { triggerOrderId: refund.orderId, status: { in: [RewardStatus.PENDING_OBSERVATION, RewardStatus.AVAILABLE] } },
        data: { status: RewardStatus.REVERSED, reversedAt: now },
      })
      await tx.auditLog.create({ data: {
        actorId: refund.approvedById || refund.requestedById,
        actorRole: AppRole.FINANCE,
        action: 'WECHAT_REFUND_SUCCEEDED', objectType: 'Refund', objectId: refund.id,
        reason: refund.reason, newValue: { refundId: notice.refund_id, amountCents: refund.amountCents, fullyRefunded } as never,
      } })
      return { accepted: true }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  }

  /**
   * Reverses the principal/gift split only after the provider has confirmed
   * the refund.  Each account transaction has a refund-scoped idempotency key
   * so a duplicated WeChat notification cannot double-debit a balance.
   */
  private async reverseRechargeBalance(
    tx: Prisma.TransactionClient,
    refund: {
      id: string
      refundNo: string
      amountCents: number
      orderId: string
      approvedById: string | null
      requestedById: string
      order: { memberId: string; parameterSnapshot: Prisma.JsonValue }
    },
    paidCents: number,
  ) {
    const snapshot = refund.order.parameterSnapshot as { principalCents?: number; giftCents?: number }
    const debits: Array<[AccountType, number]> = [
      [AccountType.CASH_PRINCIPAL, Math.round((Math.max(0, Number(snapshot.principalCents) || 0) * refund.amountCents) / paidCents)],
      [AccountType.GIFT_BALANCE, Math.round((Math.max(0, Number(snapshot.giftCents) || 0) * refund.amountCents) / paidCents)],
    ]
    for (const [type, amount] of debits) {
      if (!amount) continue
      const account = await tx.account.findUniqueOrThrow({
        where: { userId_type: { userId: refund.order.memberId, type } },
      })
      if (account.balance < amount) {
        await tx.riskEvent.create({
          data: {
            ruleCode: 'RECHARGE_REFUND_BALANCE_SHORTFALL',
            severity: 'HIGH',
            userId: refund.order.memberId,
            objectType: 'Refund',
            objectId: refund.id,
            summary: `${type} 余额不足，充值退款需要人工调整`,
            evidence: { requestedAmount: amount, currentBalance: account.balance, refundNo: refund.refundNo } as never,
          },
        })
        throw new ConflictException(`${type} 余额不足，充值款已消费，需人工审核处理`)
      }
      const changed = await tx.account.updateMany({
        where: { id: account.id, version: account.version, balance: { gte: amount } },
        data: { balance: { decrement: amount }, version: { increment: 1 } },
      })
      if (changed.count !== 1) throw new ConflictException('账户余额已变化，请稍后重试退款处理')
      await tx.accountTransaction.create({
        data: {
          accountId: account.id,
          kind: AccountTxnKind.REVERSAL,
          amount: -amount,
          balanceBefore: account.balance,
          balanceAfter: account.balance - amount,
          reasonCode: 'RECHARGE_REFUND',
          reason: refund.refundNo,
          orderId: refund.orderId,
          operatorId: refund.approvedById || refund.requestedById,
          idempotencyKey: `RECHARGE-REFUND:${refund.id}:${type}`,
        },
      })
    }
  }

  private decrypt<T>(resource: NotificationResource): T {
    const key = Buffer.from(this.required('WECHAT_PAY_API_V3_KEY'), 'utf8')
    if (key.length !== 32) throw new BadRequestException('WECHAT_PAY_API_V3_KEY 必须为32字节')
    const encrypted = Buffer.from(resource.ciphertext, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'))
    decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'))
    decipher.setAuthTag(encrypted.subarray(encrypted.length - 16))
    const clear = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()])
    return JSON.parse(clear.toString('utf8')) as T
  }

  private async signedRequest(method: string, path: string, body: string) {
    const mchId = this.required('WECHAT_PAY_MCH_ID')
    const serialNo = this.required('WECHAT_PAY_SERIAL_NO')
    const privateKey = this.required('WECHAT_PAY_PRIVATE_KEY').replace(/\\n/g, '\n')
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonce = randomBytes(16).toString('hex')
    const signature = this.rsaSign(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`, privateKey)
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`
    return fetch(`https://api.mch.weixin.qq.com${path}`, {
      method, headers: { authorization, accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'yanqing-badminton/1.0' }, body,
    })
  }

  private rsaSign(message: string, privateKey: string) {
    const signer = createSign('RSA-SHA256'); signer.update(message); return signer.sign(privateKey, 'base64')
  }

  private header(headers: Record<string, string | string[] | undefined>, name: string) {
    const value = headers[name]; const normalized = Array.isArray(value) ? value[0] : value
    if (!normalized) throw new UnauthorizedException(`缺少 ${name}`)
    return normalized
  }

  private required(key: string) {
    const value = this.config.get<string>(key)
    if (!value) throw new BadGatewayException(`${key} 尚未配置`)
    return value
  }
}
