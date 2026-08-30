import {
  createDecipheriv,
  createSign,
  createVerify,
  randomBytes,
} from 'node:crypto';

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import {
  AccountTxnKind,
  AccountType,
  AppRole,
  BookingStatus,
  BusinessType,
  EventStatus,
  InventoryTxnType,
  MembershipStatus,
  OrderStatus,
  PaymentChannel,
  PaymentStatus,
  Prisma,
  RefundStatus,
  RegistrationStatus,
  RewardStatus,
} from '../generated/prisma/client.js';
import { applyInventoryDelta } from '../inventory/inventory-balance.js';
import { OrderFinalizerService } from './order-finalizer.service.js';
import { promoteNextGameWaitlist } from '../games/games.service.js';
import { promoteNextEventWaitlist } from '../events/events.service.js';

interface NotificationResource {
  ciphertext: string;
  nonce: string;
  associated_data?: string;
}
interface WechatNotification {
  event_type: string;
  resource: NotificationResource;
}
interface TransactionNotice {
  out_trade_no: string;
  transaction_id: string;
  trade_state: string;
  amount: { total: number };
}
interface RefundNotice {
  out_refund_no: string;
  refund_id: string;
  refund_status: string;
  amount: { refund: number; total: number };
}

interface RechargeRefundRecovery {
  accountType: AccountType;
  requestedCents: number;
  recoveredCents: number;
  shortfallCents: number;
  reason?: 'INSUFFICIENT_AVAILABLE_BALANCE' | 'CONCURRENT_ACCOUNT_CHANGE';
}

const businessSerial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

const isPrismaErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === code;

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
  }) {
    const appId = this.required('WECHAT_APP_ID');
    const mchId = this.required('WECHAT_PAY_MCH_ID');
    const serialNo = this.required('WECHAT_PAY_SERIAL_NO');
    const privateKey = this.required('WECHAT_PAY_PRIVATE_KEY').replace(
      /\\n/g,
      '\n',
    );
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
        'content-type': 'application/json',
        'user-agent': 'yanqing-badminton/1.0',
      },
      body,
    });
    const result = (await response.json()) as {
      prepay_id?: string;
      message?: string;
    };
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
    const result = (await response.json()) as {
      refund_id?: string;
      status?: string;
      message?: string;
    };
    if (!response.ok || !result.refund_id)
      throw new BadGatewayException(result.message || '微信退款申请失败');
    return {
      refundId: result.refund_id,
      status: result.status || 'PROCESSING',
    };
  }

  async handleNotification(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const timestamp = this.header(headers, 'wechatpay-timestamp');
    const nonce = this.header(headers, 'wechatpay-nonce');
    const signature = this.header(headers, 'wechatpay-signature');
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
      throw new UnauthorizedException('微信支付通知已过期');
    const publicCert = this.required('WECHAT_PAY_PLATFORM_CERT').replace(
      /\\n/g,
      '\n',
    );
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${timestamp}\n${nonce}\n${rawBody.toString('utf8')}\n`);
    if (!verifier.verify(publicCert, signature, 'base64'))
      throw new UnauthorizedException('微信支付通知验签失败');
    const notification = JSON.parse(
      rawBody.toString('utf8'),
    ) as WechatNotification;
    if (notification.event_type === 'REFUND.SUCCESS') {
      const notice = this.decrypt<RefundNotice>(notification.resource);
      if (notice.refund_status !== 'SUCCESS')
        return { accepted: true, ignored: true };
      return this.finalizeRefund(notice);
    }
    const notice = this.decrypt<TransactionNotice>(notification.resource);
    if (
      notification.event_type !== 'TRANSACTION.SUCCESS' ||
      notice.trade_state !== 'SUCCESS'
    )
      return { accepted: true, ignored: true };
    return this.prisma.$transaction(
      async (tx) => {
        const order = await tx.order.findUnique({
          where: { orderNo: notice.out_trade_no },
          include: {
            items: true,
            membership: { include: { product: true } },
            member: { select: { openId: true } },
            eventTeam: { include: { event: true } },
            payments: {
              where: { channel: PaymentChannel.WECHAT },
              orderBy: { createdAt: 'desc' },
            },
          },
        });
        if (!order) throw new BadRequestException('微信支付订单不存在');
        if (notice.amount.total !== order.payableCents)
          throw new BadRequestException('微信支付通知金额不一致');
        const payment = order.payments[0];
        if (!payment) throw new BadRequestException('微信支付记录不存在');
        if (
          payment.status === PaymentStatus.SUCCEEDED &&
          order.status !== OrderStatus.PENDING
        )
          return { accepted: true, idempotent: true };
        const now = new Date();
        const invalidEventReservation =
          order.businessType === BusinessType.EVENT &&
          order.eventTeam &&
          (order.eventTeam.status !== RegistrationStatus.REGISTERED ||
            !order.eventTeam.paymentDueAt ||
            order.eventTeam.paymentDueAt <= now ||
            (order.eventTeam.event.status !== EventStatus.OPEN &&
              order.eventTeam.event.status !== EventStatus.FULL) ||
            order.eventTeam.event.startsAt <= now);
        if (invalidEventReservation && order.eventTeam) {
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.SUCCEEDED,
              providerTradeNo: notice.transaction_id,
              paidAt: now,
              providerPayload: {
                provider: 'wechat',
                transactionId: notice.transaction_id,
                lateEventPayment: true,
              },
            },
          });
          await tx.order.update({
            where: { id: order.id },
            data: {
              status:
                order.payableCents > 0
                  ? OrderStatus.REFUND_PENDING
                  : OrderStatus.CANCELLED,
              paymentChannel: PaymentChannel.WECHAT,
              paidCents: order.payableCents,
              paidAt: now,
              cancelledAt: order.payableCents > 0 ? undefined : now,
            },
          });
          await tx.eventTeam.updateMany({
            where: {
              id: order.eventTeam.id,
              status: { not: RegistrationStatus.REFUNDED },
            },
            data: {
              status: RegistrationStatus.CANCELLED,
              paymentDueAt: null,
              cancelledAt: now,
            },
          });
          let refund = null;
          if (order.payableCents > 0) {
            refund = await tx.refund.upsert({
              where: { idempotencyKey: `EVENT_LATE_PAYMENT:${order.id}` },
              update: {},
              create: {
                refundNo: businessSerial('RF'),
                idempotencyKey: `EVENT_LATE_PAYMENT:${order.id}`,
                orderId: order.id,
                requestedById: order.memberId,
                amountCents: order.payableCents,
                reason: '赛事报名支付回调晚于席位保留截止，原路退款待财务审批',
                status: RefundStatus.REQUESTED,
                originalOrderStatus: OrderStatus.PAID,
              },
            });
          }
          await promoteNextEventWaitlist(
            tx,
            order.eventTeam.eventId,
            order.memberId,
            AppRole.MEMBER,
            now,
          );
          await tx.auditLog.create({
            data: {
              actorId: order.memberId,
              actorRole: AppRole.MEMBER,
              action: 'EVENT_LATE_PAYMENT_REFUND_REQUESTED',
              objectType: 'Order',
              objectId: order.id,
              reason: '支付成功回调到达时赛事席位保留已失效',
              newValue: {
                paymentId: payment.id,
                providerTradeNo: notice.transaction_id,
                amountCents: order.payableCents,
                refundId: refund?.id ?? null,
                financeApprovalRequired: order.payableCents > 0,
              } as never,
            },
          });
          return {
            accepted: true,
            latePayment: true,
            refundReviewRequired: order.payableCents > 0,
          };
        }
        const succeeded = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUCCEEDED,
            providerTradeNo: notice.transaction_id,
            paidAt: now,
            providerPayload: {
              provider: 'wechat',
              transactionId: notice.transaction_id,
            },
          },
        });
        await this.finalizer.finalize(
          tx,
          order,
          { ...succeeded, amountCents: succeeded.amountCents },
          succeeded.operatorId,
          AppRole.MEMBER,
          now,
        );
        return { accepted: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async finalizeRefund(notice: RefundNotice) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const refund = await tx.refund.findUnique({
              where: { refundNo: notice.out_refund_no },
              include: {
                order: {
                  include: {
                    trainingEnrollment: true,
                    membership: { include: { product: true } },
                    items: true,
                    gameRegistration: true,
                    eventTeam: true,
                    payments: {
                      where: { status: PaymentStatus.SUCCEEDED },
                      orderBy: { createdAt: 'asc' },
                    },
                  },
                },
              },
            });
            if (!refund) throw new BadRequestException('微信退款记录不存在');
            if (
              refund.amountCents !== notice.amount.refund ||
              refund.order.paidCents !== notice.amount.total
            ) {
              throw new BadRequestException('微信退款通知金额不一致');
            }
            if (refund.status === RefundStatus.SUCCEEDED)
              return { accepted: true, idempotent: true };
            const refundedCents =
              refund.order.refundedCents + refund.amountCents;
            const fullyRefunded = refundedCents >= refund.order.paidCents;
            const now = new Date();
            let rechargeRecovery: RechargeRefundRecovery[] = [];
            await tx.refund.update({
              where: { id: refund.id },
              data: {
                status: RefundStatus.SUCCEEDED,
                providerRefundNo: notice.refund_id,
                completedAt: now,
              },
            });
            await tx.order.update({
              where: { id: refund.orderId },
              data: {
                refundedCents,
                status: fullyRefunded
                  ? OrderStatus.REFUNDED
                  : OrderStatus.PARTIALLY_REFUNDED,
              },
            });
            if (refund.order.trainingEnrollment) {
              const enrollment = refund.order.trainingEnrollment;
              const enrollmentRefunded = Math.min(
                enrollment.totalAmountCents,
                enrollment.refundedCents + refund.amountCents,
              );
              await tx.trainingEnrollment.update({
                where: { id: enrollment.id },
                data: {
                  refundedCents: enrollmentRefunded,
                  prepaidBalanceCents: Math.max(
                    0,
                    enrollment.totalAmountCents -
                      enrollment.confirmedRevenueCents -
                      enrollmentRefunded,
                  ),
                  status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
                },
              });
            }
            if (refund.order.businessType === BusinessType.RECHARGE) {
              const payment = refund.order.payments[0];
              // The provider SUCCESS notice is the external money boundary.
              // Even a damaged local payment relation must not turn that
              // external success back into a retrying/non-terminal refund.
              rechargeRecovery = await this.reverseRechargeBalance(
                tx,
                refund,
                payment?.amountCents || notice.amount.total,
              );
              const outstandingRecoveryCents = rechargeRecovery.reduce(
                (sum, item) => sum + item.shortfallCents,
                0,
              );
              if (outstandingRecoveryCents > 0) {
                const existingRisk = await tx.riskEvent.findFirst({
                  where: {
                    ruleCode: 'RECHARGE_REFUND_BALANCE_SHORTFALL',
                    objectType: 'Refund',
                    objectId: refund.id,
                  },
                });
                if (!existingRisk) {
                  await tx.riskEvent.create({
                    data: {
                      ruleCode: 'RECHARGE_REFUND_BALANCE_SHORTFALL',
                      severity: 'HIGH',
                      userId: refund.order.memberId,
                      orderId: refund.orderId,
                      objectType: 'Refund',
                      objectId: refund.id,
                      summary:
                        '微信退款已成功，充值账户余额不足，差额待追缴',
                      evidence: {
                        recoveryKey: `RECHARGE-REFUND-RECOVERY:${refund.id}`,
                        externalRefundTerminal: true,
                        providerRefundNo: notice.refund_id,
                        refundNo: refund.refundNo,
                        refundAmountCents: refund.amountCents,
                        outstandingRecoveryCents,
                        recovery: rechargeRecovery,
                        recoveryStatus: 'OUTSTANDING',
                      } as never,
                    },
                  });
                }
              }
            }
            if (fullyRefunded) {
              await tx.courtBooking.updateMany({
                where: { orderId: refund.orderId },
                data: { status: BookingStatus.CANCELLED },
              });
              if (refund.order.membership) {
                await tx.memberSubscription.update({
                  where: { id: refund.order.membership.id },
                  data: { status: MembershipStatus.CANCELLED },
                });
                const latest = await tx.memberSubscription.findFirst({
                  where: {
                    memberId: refund.order.membership.memberId,
                    status: MembershipStatus.ACTIVE,
                    id: { not: refund.order.membership.id },
                  },
                  include: { product: true },
                  orderBy: { endsAt: 'desc' },
                });
                await tx.memberProfile.update({
                  where: { id: refund.order.membership.memberId },
                  data: {
                    level: latest?.product.level ?? 'EXPERIENCE',
                    membershipExpiresAt: latest?.endsAt,
                  },
                });
              }
              if (refund.order.businessType === BusinessType.GOODS) {
                for (const item of refund.order.items) {
                  if (!item.itemId) continue;
                  const inventory = await tx.inventoryItem.findUniqueOrThrow({
                    where: { id: item.itemId },
                  });
                  const { stockAfter } = await applyInventoryDelta(
                    tx,
                    inventory,
                    item.quantity,
                  );
                  await tx.inventoryTransaction.create({
                    data: {
                      itemId: inventory.id,
                      type: InventoryTxnType.ADJUSTMENT,
                      quantity: item.quantity,
                      stockBefore: inventory.stock,
                      stockAfter,
                      unitCostCents: inventory.purchasePriceCents,
                      orderItemId: item.id,
                      operatorId: refund.approvedById || refund.requestedById,
                      reason: `微信退款 ${refund.refundNo} 退货入库`,
                      idempotencyKey: `GOODS-REFUND:${refund.id}:${item.id}`,
                    },
                  });
                }
                await this.finalizer.recordSucceededGoodsRefund(
                  tx,
                  refund.id,
                  refund.approvedById || refund.requestedById,
                  AppRole.FINANCE,
                );
              }
              if (
                refund.order.businessType === BusinessType.GAME &&
                refund.order.gameRegistration
              ) {
                await tx.gameRegistration.update({
                  where: { id: refund.order.gameRegistration.id },
                  data: { status: 'REFUNDED' },
                });
                await promoteNextGameWaitlist(
                  tx,
                  refund.order.gameRegistration.gameId,
                  refund.approvedById || refund.requestedById,
                  AppRole.FINANCE,
                );
              }
              if (
                refund.order.businessType === BusinessType.EVENT &&
                refund.order.eventTeam
              ) {
                await tx.eventTeam.update({
                  where: { id: refund.order.eventTeam.id },
                  data: {
                    status: RegistrationStatus.REFUNDED,
                    paymentDueAt: null,
                    cancellationPending: false,
                    cancellationResolvedAt: refund.order.eventTeam
                      .cancelRequestedAt
                      ? (refund.order.eventTeam.cancellationResolvedAt ?? now)
                      : undefined,
                  },
                });
                await promoteNextEventWaitlist(
                  tx,
                  refund.order.eventTeam.eventId,
                  refund.approvedById || refund.requestedById,
                  AppRole.FINANCE,
                );
              }
            }
            await tx.referralReward.updateMany({
              where: {
                triggerOrderId: refund.orderId,
                status: {
                  in: [
                    RewardStatus.PENDING_OBSERVATION,
                    RewardStatus.AVAILABLE,
                  ],
                },
              },
              data: { status: RewardStatus.REVERSED, reversedAt: now },
            });
            await tx.auditLog.create({
              data: {
                actorId: refund.approvedById || refund.requestedById,
                actorRole: AppRole.FINANCE,
                action: 'WECHAT_REFUND_SUCCEEDED',
                objectType: 'Refund',
                objectId: refund.id,
                reason: refund.reason,
                newValue: {
                  refundId: notice.refund_id,
                  amountCents: refund.amountCents,
                  fullyRefunded,
                  rechargeRecovery,
                  outstandingRecoveryCents: rechargeRecovery.reduce(
                    (sum, item) => sum + item.shortfallCents,
                    0,
                  ),
                } as never,
              },
            });
            return {
              accepted: true,
              outstandingRecoveryCents: rechargeRecovery.reduce(
                (sum, item) => sum + item.shortfallCents,
                0,
              ),
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          isPrismaErrorCode(error, 'P2002') ||
          isPrismaErrorCode(error, 'P2034')
        ) {
          const completed = await this.prisma.refund.findUnique({
            where: { refundNo: notice.out_refund_no },
          });
          if (completed?.status === RefundStatus.SUCCEEDED) {
            return { accepted: true, idempotent: true };
          }
          if (attempt < 3) continue;
          throw new ConflictException(
            '微信退款终态发生并发冲突，请等待通知重试',
          );
        }
        throw error;
      }
    }
    throw new ConflictException('微信退款终态发生并发冲突，请等待通知重试');
  }

  /**
   * Reverses as much of the principal/gift split as is currently available
   * after the provider has confirmed the refund. Account balances have a DB
   * non-negative constraint, so spent or frozen value becomes an explicit
   * recovery shortfall instead of rolling the external refund terminal state
   * back. Each actual debit has a refund-scoped idempotency key.
   */
  private async reverseRechargeBalance(
    tx: Prisma.TransactionClient,
    refund: {
      id: string;
      refundNo: string;
      amountCents: number;
      orderId: string;
      approvedById: string | null;
      requestedById: string;
      order: { memberId: string; parameterSnapshot: Prisma.JsonValue };
    },
    paidCents: number,
  ): Promise<RechargeRefundRecovery[]> {
    const snapshot = refund.order.parameterSnapshot as {
      principalCents?: number;
      giftCents?: number;
    };
    const debits: Array<[AccountType, number]> = [
      [
        AccountType.CASH_PRINCIPAL,
        Math.round(
          (Math.max(0, Number(snapshot.principalCents) || 0) *
            refund.amountCents) /
            paidCents,
        ),
      ],
      [
        AccountType.GIFT_BALANCE,
        Math.round(
          (Math.max(0, Number(snapshot.giftCents) || 0) * refund.amountCents) /
            paidCents,
        ),
      ],
    ];
    const recovery: RechargeRefundRecovery[] = [];
    for (const [type, amount] of debits) {
      if (!amount) continue;
      const idempotencyKey = `RECHARGE-REFUND:${refund.id}:${type}`;
      const existing = await tx.accountTransaction.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        const recoveredCents = Math.min(
          amount,
          Math.max(0, -existing.amount),
        );
        recovery.push({
          accountType: type,
          requestedCents: amount,
          recoveredCents,
          shortfallCents: amount - recoveredCents,
          reason:
            recoveredCents < amount
              ? 'INSUFFICIENT_AVAILABLE_BALANCE'
              : undefined,
        });
        continue;
      }

      let account =
        (await tx.account.findUnique({
          where: { userId_type: { userId: refund.order.memberId, type } },
        })) ??
        (await tx.account.upsert({
          where: { userId_type: { userId: refund.order.memberId, type } },
          update: {},
          create: { userId: refund.order.memberId, type },
        }));
      let recoveredCents = 0;
      let concurrentFailure = false;
      for (let accountAttempt = 1; accountAttempt <= 3; accountAttempt += 1) {
        const frozenBalance = Math.max(0, Number(account.frozenBalance) || 0);
        const availableBalance = Math.max(0, account.balance - frozenBalance);
        recoveredCents = Math.min(amount, availableBalance);
        if (recoveredCents <= 0) break;
        const balanceBefore = account.balance;
        const balanceAfter = balanceBefore - recoveredCents;
        const changed = await tx.account.updateMany({
          where: {
            id: account.id,
            version: account.version,
            balance: balanceBefore,
            frozenBalance: { lte: balanceAfter },
          },
          data: {
            balance: { decrement: recoveredCents },
            version: { increment: 1 },
          },
        });
        if (changed.count === 1) {
          await tx.accountTransaction.create({
            data: {
              accountId: account.id,
              kind: AccountTxnKind.REVERSAL,
              amount: -recoveredCents,
              balanceBefore,
              balanceAfter,
              reasonCode: 'RECHARGE_REFUND',
              reason: refund.refundNo,
              orderId: refund.orderId,
              operatorId: refund.approvedById || refund.requestedById,
              idempotencyKey,
              metadata: {
                requestedRecoveryCents: amount,
                recoveredCents,
                shortfallCents: amount - recoveredCents,
                externalRefundTerminal: true,
              },
            },
          });
          concurrentFailure = false;
          break;
        }
        concurrentFailure = true;
        const latest = await tx.account.findUnique({
          where: { userId_type: { userId: refund.order.memberId, type } },
        });
        if (!latest) break;
        account = latest;
        recoveredCents = 0;
      }
      if (concurrentFailure) recoveredCents = 0;
      recovery.push({
        accountType: type,
        requestedCents: amount,
        recoveredCents,
        shortfallCents: amount - recoveredCents,
        reason:
          recoveredCents < amount
            ? concurrentFailure
              ? 'CONCURRENT_ACCOUNT_CHANGE'
              : 'INSUFFICIENT_AVAILABLE_BALANCE'
            : undefined,
      });
    }
    return recovery;
  }

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
    const privateKey = this.required('WECHAT_PAY_PRIVATE_KEY').replace(
      /\\n/g,
      '\n',
    );
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
        'content-type': 'application/json',
        'user-agent': 'yanqing-badminton/1.0',
      },
      body,
    });
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

  private required(key: string) {
    const value = this.config.get<string>(key);
    if (!value) throw new BadGatewayException(`${key} 尚未配置`);
    return value;
  }
}
