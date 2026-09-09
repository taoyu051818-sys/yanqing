import { releaseRefundedResources } from '../refund-resources.js';
import {
  transitionOrder,
  requireOrderTransition,
} from '../order-transition.js';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AccountTxnKind,
  AccountType,
  AppRole,
  BusinessType,
  OrderStatus,
  PaymentChannel,
  PaymentStatus,
  Prisma,
  RefundStatus,
  RegistrationStatus,
} from '../../generated/prisma/client.js';
import type { ReviewRefundDto } from '../orders.dto.js';
import { OrderFinalizerService } from '../../payments/order-finalizer.service.js';
import { WechatPayService } from '../../payments/wechat-pay.service.js';
import { eventTeamCancellationRefundKey } from '../../events/registration/event-registration-policy.js';
import {
  isPrismaErrorCode,
  ACCOUNT_CHANNELS,
  NON_REJECTABLE_SYSTEM_REFUND_PREFIXES,
  refundCommandResponse,
} from '../shared/orders-support.js';
import { assertRefundOriginIsConsistent } from '../shared/orders-refund-policy.js';

export async function rejectRefund(
  prisma: PrismaService,
  refundId: string,
  dto: ReviewRefundDto,
  actor: AuthUser,
) {
  if (!isRefundApprover(actor))
    throw new ForbiddenException('仅财务或管理员可驳回退款');
  const result = await prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      include: { order: { include: { eventTeam: true } } },
    });
    if (!refund) throw new NotFoundException('退款申请不存在');
    if (refund.status === RefundStatus.REJECTED) return refund;
    if (refund.status !== RefundStatus.REQUESTED)
      throw new ConflictException('退款申请已处理');
    if (
      refund.compensationOnly ||
      NON_REJECTABLE_SYSTEM_REFUND_PREFIXES.some((prefix) =>
        refund.idempotencyKey?.startsWith(prefix),
      )
    ) {
      throw new ConflictException('系统强制退款不可驳回，请完成审批并原路退回');
    }
    if (refund.requestedById === actor.sub)
      throw new ForbiddenException('退款申请人与审批人不能是同一账号');

    const rejected = await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: RefundStatus.REJECTED,
        approvedById: actor.sub,
        approvedAt: new Date(),
      },
    });
    const otherPending = await tx.refund.aggregate({
      where: {
        orderId: refund.orderId,
        id: { not: refund.id },
        status: {
          in: [
            RefundStatus.REQUESTED,
            RefundStatus.APPROVED,
            RefundStatus.PROCESSING,
          ],
        },
      },
      _sum: { amountCents: true },
    });
    if (!otherPending._sum.amountCents) {
      const restoredStatus =
        refund.order.refundedCents > 0
          ? OrderStatus.PARTIALLY_REFUNDED
          : refund.originalOrderStatus;
      assertRefundOriginIsConsistent(
        restoredStatus,
        refund.order.completedAt,
        refund.order.refundedCents,
      );
      if (refund.order.status !== restoredStatus) {
        const restored = await transitionOrder(tx, 'REJECT_REFUND', {
          where: { id: refund.orderId, status: refund.order.status },
          data: { status: restoredStatus },
        });
        if (restored.count !== 1)
          throw new ConflictException('订单状态已变化，请刷新后重试退款驳回');
      }
    }
    const eventTeam = refund.order.eventTeam;
    if (
      eventTeam?.cancellationPending &&
      eventTeam.cancelIdempotencyKey &&
      refund.idempotencyKey ===
        eventTeamCancellationRefundKey(
          eventTeam.id,
          eventTeam.cancelIdempotencyKey,
        )
    ) {
      await tx.eventTeam.updateMany({
        where: {
          id: eventTeam.id,
          status: RegistrationStatus.PAID,
          cancellationPending: true,
        },
        data: {
          cancellationPending: false,
          cancellationResolvedAt: new Date(),
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action: 'REFUND_REJECTED',
        objectType: 'Refund',
        objectId: refund.id,
        reason: dto.reason,
        oldValue: { status: RefundStatus.REQUESTED } as never,
        newValue: {
          status: RefundStatus.REJECTED,
          originalOrderStatus: refund.originalOrderStatus,
        } as never,
      },
    });
    return rejected;
  });
  return refundCommandResponse(result);
}

export async function approveRefund(
  prisma: PrismaService,
  config: ConfigService,
  finalizer: OrderFinalizerService,
  wechatPay: WechatPayService,
  refundId: string,
  dto: ReviewRefundDto,
  actor: AuthUser,
) {
  if (!isRefundApprover(actor))
    throw new ForbiddenException('仅财务或管理员可审批退款');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const refund = await tx.refund.findUnique({
            where: { id: refundId },
            include: {
              order: {
                include: {
                  payments: { where: { status: PaymentStatus.SUCCEEDED } },
                  trainingEnrollment: true,
                  membership: { include: { product: true } },
                  items: true,
                  gameRegistration: true,
                  eventTeam: true,
                },
              },
            },
          });
          if (!refund) throw new NotFoundException('退款申请不存在');
          if (refund.status !== RefundStatus.REQUESTED) {
            if (
              refund.approvedById === actor.sub &&
              (refund.status === RefundStatus.PROCESSING ||
                refund.status === RefundStatus.SUCCEEDED)
            ) {
              return refund;
            }
            throw new ConflictException('退款申请已处理');
          }
          // Enforce maker/checker separation at the domain boundary.  A finance
          // or admin account may initiate a refund on behalf of a member, but it
          // must not approve its own request; otherwise a single compromised
          // account can both create and release a money movement.
          if (refund.requestedById === actor.sub) {
            throw new ForbiddenException('退款申请人与审批人不能是同一账号');
          }
          const payment = refund.order.payments[0];
          if (!payment) throw new ConflictException('未找到成功支付记录');
          if (
            refund.compensationOnly &&
            (payment.channel !== PaymentChannel.WECHAT ||
              config.get<string>('PAYMENT_PROVIDER', 'mock') !== 'wechat')
          ) {
            throw new ConflictException(
              '迟到付款补偿必须通过原微信支付渠道退款',
            );
          }
          if (
            !refund.compensationOnly &&
            refund.order.businessType === BusinessType.TRAINING
          ) {
            const enrollment = refund.order.trainingEnrollment;
            if (!enrollment)
              throw new ConflictException('培训订单缺少报名与预收账本');
            if (refund.amountCents > enrollment.prepaidBalanceCents) {
              throw new ConflictException(
                '当前未消课预收余额不足；请先驳回本申请或完成消课冲正后重提',
              );
            }
          }

          const accountType = ACCOUNT_CHANNELS[payment.channel];
          if (accountType) {
            const account = await tx.account.findUniqueOrThrow({
              where: {
                userId_type: {
                  userId: refund.order.memberId,
                  type: accountType,
                },
              },
            });
            let restoreAmount = refund.amountCents;
            if (payment.channel === PaymentChannel.BADMINTON_COIN) {
              const originalTxn = await tx.accountTransaction.findFirst({
                where: {
                  orderId: refund.orderId,
                  accountId: account.id,
                  kind: AccountTxnKind.DEBIT,
                  reasonCode: 'ORDER_PAYMENT',
                },
                orderBy: { createdAt: 'asc' },
              });
              if (
                !originalTxn ||
                originalTxn.amount >= 0 ||
                payment.amountCents <= 0
              ) {
                throw new ConflictException(
                  '缺少有效的原支付扣币流水，请核对账务后退款',
                );
              }
              const returned = await tx.accountTransaction.aggregate({
                where: {
                  orderId: refund.orderId,
                  accountId: account.id,
                  kind: AccountTxnKind.REVERSAL,
                  reasonCode: 'ORDER_REFUND',
                },
                _sum: { amount: true },
              });
              // Round the cumulative entitlement, then subtract coins actually
              // returned, including legacy rounding. Never take coins back
              // during a refund if older installments already returned more.
              const cumulativeCents = Math.min(
                payment.amountCents,
                refund.order.refundedCents + refund.amountCents,
              );
              const numerator =
                BigInt(-originalTxn.amount) * BigInt(cumulativeCents);
              const denominator = BigInt(payment.amountCents);
              const target = Number(
                (2n * numerator + denominator) / (2n * denominator),
              );
              restoreAmount = Math.max(0, target - (returned._sum.amount ?? 0));
            }
            await tx.account.update({
              where: { id: account.id },
              data: {
                balance: { increment: restoreAmount },
                version: { increment: 1 },
              },
            });
            await tx.accountTransaction.create({
              data: {
                accountId: account.id,
                kind: AccountTxnKind.REVERSAL,
                amount: restoreAmount,
                balanceBefore: account.balance,
                balanceAfter: account.balance + restoreAmount,
                reasonCode: 'ORDER_REFUND',
                reason: dto.reason,
                orderId: refund.orderId,
                operatorId: actor.sub,
                idempotencyKey: `REFUND:${refund.refundNo}`,
              },
            });
          }

          // A real WeChat refund is asynchronous.  Do not reverse a recharge
          // balance (or any other business side effect) until the signed
          // REFUND.SUCCESS notification arrives; otherwise a PROCESSING refund
          // would make the member's balance spendable before money is actually
          // returned by the provider.
          const isWechatProviderRefund =
            payment.channel === PaymentChannel.WECHAT &&
            config.get<string>('PAYMENT_PROVIDER', 'mock') === 'wechat';

          if (
            refund.order.businessType === BusinessType.RECHARGE &&
            !isWechatProviderRefund
          ) {
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
                    payment.amountCents,
                ),
              ],
              [
                AccountType.GIFT_BALANCE,
                Math.round(
                  (Math.max(0, Number(snapshot.giftCents) || 0) *
                    refund.amountCents) /
                    payment.amountCents,
                ),
              ],
            ];
            for (const [type, amount] of debits) {
              if (!amount) continue;
              const account = await tx.account.findUniqueOrThrow({
                where: {
                  userId_type: { userId: refund.order.memberId, type },
                },
              });
              if (account.balance < amount)
                throw new ConflictException(
                  `${type} 余额不足，充值款已消费，需人工审核处理`,
                );
              await tx.account.update({
                where: { id: account.id },
                data: {
                  balance: { decrement: amount },
                  version: { increment: 1 },
                },
              });
              await tx.accountTransaction.create({
                data: {
                  accountId: account.id,
                  kind: AccountTxnKind.REVERSAL,
                  amount: -amount,
                  balanceBefore: account.balance,
                  balanceAfter: account.balance - amount,
                  reasonCode: 'RECHARGE_REFUND',
                  reason: dto.reason,
                  orderId: refund.order.id,
                  operatorId: actor.sub,
                  idempotencyKey: `RECHARGE-REFUND:${refund.id}:${type}`,
                },
              });
            }
          }

          if (isWechatProviderRefund) {
            const provider = await wechatPay.createRefund({
              orderNo: refund.order.orderNo,
              refundNo: refund.refundNo,
              refundCents: refund.amountCents,
              totalCents: refund.order.paidCents,
              reason: dto.reason,
            });
            const processing = await tx.refund.update({
              where: { id: refund.id },
              data: {
                status: RefundStatus.PROCESSING,
                approvedById: actor.sub,
                approvedAt: new Date(),
                providerRefundNo: provider.refundId,
              },
            });
            await tx.auditLog.create({
              data: {
                actorId: actor.sub,
                actorRole: actor.roles[0],
                action: 'WECHAT_REFUND_REQUESTED',
                objectType: 'Refund',
                objectId: refund.id,
                reason: dto.reason,
                newValue: {
                  amountCents: refund.amountCents,
                  providerRefundId: provider.refundId,
                  providerStatus: provider.status,
                } as never,
              },
            });
            return processing;
          }

          const refundedCents = refund.order.refundedCents + refund.amountCents;
          const fullyRefunded = refundedCents >= refund.order.paidCents;
          const completedAt = new Date();
          await tx.refund.update({
            where: { id: refund.id },
            data: {
              status: RefundStatus.SUCCEEDED,
              approvedById: actor.sub,
              approvedAt: completedAt,
              completedAt,
            },
          });
          await requireOrderTransition(tx, 'REFUND_SUCCEEDED', {
            where: { id: refund.orderId, status: refund.order.status },
            data: {
              refundedCents,
              status: fullyRefunded
                ? OrderStatus.REFUNDED
                : OrderStatus.PARTIALLY_REFUNDED,
            },
          });
          await releaseRefundedResources(
            tx,
            refund,
            fullyRefunded,
            actor,
            (...args) => finalizer.recordSucceededGoodsRefund(...args),
            completedAt,
            dto.reason,
          );
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'REFUND_APPROVED',
              objectType: 'Refund',
              objectId: refund.id,
              reason: dto.reason,
              oldValue: { orderStatus: refund.order.status } as never,
              newValue: {
                amountCents: refund.amountCents,
                fullyRefunded,
                ...(payment.channel === PaymentChannel.OFFLINE_CASH
                  ? {
                      cashDisbursement: {
                        paymentId: payment.id,
                        operatorId: actor.sub,
                        completedAt: completedAt.toISOString(),
                        amountCents: refund.amountCents,
                      },
                    }
                  : {}),
              } as never,
            },
          });
          return tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return refundCommandResponse(result);
    } catch (error) {
      if (
        isPrismaErrorCode(error, 'P2002') ||
        isPrismaErrorCode(error, 'P2034')
      ) {
        const completed = await prisma.refund.findUnique({
          where: { id: refundId },
        });
        if (
          completed?.approvedById === actor.sub &&
          (completed.status === RefundStatus.PROCESSING ||
            completed.status === RefundStatus.SUCCEEDED)
        ) {
          return refundCommandResponse(completed);
        }
        if (attempt < 3) continue;
        throw new ConflictException('退款审批发生并发冲突，请刷新后重试');
      }
      throw error;
    }
  }
  throw new ConflictException('退款审批发生并发冲突，请刷新后重试');
}

export function isRefundApprover(actor: AuthUser): boolean {
  return actor.roles.some((role) =>
    [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
      role as never,
    ),
  );
}
