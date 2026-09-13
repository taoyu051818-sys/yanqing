import { releaseRefundedResources } from '../../orders/refund-resources.js';
import { requireOrderTransition } from '../../orders/order-transition.js';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  BusinessType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from '../../generated/prisma/client.js';
import { OrderFinalizerService } from '../order-finalizer.service.js';
import {
  RefundNotice,
  RechargeRefundRecovery,
  isPrismaErrorCode,
} from './wechat-notice-types.js';
import { reverseRechargeBalance } from './recharge-refund-reversal.js';

async function resolveDispatchRisk(
  db: Pick<Prisma.TransactionClient, 'riskEvent'>,
  refundId: string,
  now = new Date(),
) {
  await db.riskEvent.updateMany({
    where: {
      ruleCode: 'WECHAT_REFUND_DISPATCH_DEFERRED',
      objectType: 'Refund',
      objectId: refundId,
      status: { in: ['OPEN', 'REVIEWING'] },
    },
    data: { status: 'RESOLVED', resolvedAt: now },
  });
}

export async function finalizeRefund(
  prisma: PrismaService,
  finalizer: OrderFinalizerService,
  notice: RefundNotice,
) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(
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
          if (refund.status === RefundStatus.SUCCEEDED) {
            await resolveDispatchRisk(tx, refund.id);
            return { accepted: true, idempotent: true };
          }
          const refundedCents = refund.order.refundedCents + refund.amountCents;
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
          await resolveDispatchRisk(tx, refund.id, now);
          await requireOrderTransition(tx, 'REFUND_SUCCEEDED', {
            where: { id: refund.orderId, status: refund.order.status },
            data: {
              refundedCents,
              status: fullyRefunded
                ? OrderStatus.REFUNDED
                : OrderStatus.PARTIALLY_REFUNDED,
            },
          });
          if (refund.compensationOnly) {
            // No fulfilment happened: do not debit a recharge balance, restore
            // unsold stock, change membership, or release an unrelated seat.
            await tx.auditLog.create({
              data: {
                actorId: refund.approvedById || refund.requestedById,
                actorRole: AppRole.FINANCE,
                action: 'WECHAT_COMPENSATION_REFUND_SUCCEEDED',
                objectType: 'Refund',
                objectId: refund.id,
                reason: refund.reason,
                newValue: {
                  refundId: notice.refund_id,
                  amountCents: refund.amountCents,
                  compensationOnly: true,
                },
              },
            });
            return { accepted: true, outstandingRecoveryCents: 0 };
          }
          if (refund.order.businessType === BusinessType.RECHARGE) {
            const payment = refund.order.payments[0];
            // The provider SUCCESS notice is the external money boundary.
            // Even a damaged local payment relation must not turn that
            // external success back into a retrying/non-terminal refund.
            rechargeRecovery = await reverseRechargeBalance(
              tx,
              refund,
              payment?.amountCents || notice.amount.total,
              refundedCents,
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
                    summary: '微信退款已成功，充值账户余额不足，差额待追缴',
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
          await releaseRefundedResources(
            tx,
            refund,
            fullyRefunded,
            {
              sub: refund.approvedById || refund.requestedById,
              roles: [AppRole.FINANCE],
            },
            (...args) => finalizer.recordSucceededGoodsRefund(...args),
            now,
          );
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
        const completed = await prisma.refund.findUnique({
          where: { refundNo: notice.out_refund_no },
        });
        if (completed?.status === RefundStatus.SUCCEEDED) {
          await resolveDispatchRisk(prisma, completed.id);
          return { accepted: true, idempotent: true };
        }
        if (attempt < 3) continue;
        throw new ConflictException('微信退款终态发生并发冲突，请等待通知重试');
      }
      throw error;
    }
  }
  throw new ConflictException('微信退款终态发生并发冲突，请等待通知重试');
}
