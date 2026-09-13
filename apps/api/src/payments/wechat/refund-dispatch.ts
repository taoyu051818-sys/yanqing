import { BadGatewayException, Logger, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service.js';
import { AppRole, RefundStatus } from '../../generated/prisma/client.js';
import type { OrderFinalizerService } from '../order-finalizer.service.js';
import type { WechatPayService } from '../wechat-pay.service.js';
import { finalizeRefund } from './refund-notification.js';

const logger = new Logger('WechatRefundDispatch');
const active = [RefundStatus.APPROVED, RefundStatus.PROCESSING];

/** APPROVED is a committed decision. Provider retries always reuse its refundNo. */
export async function dispatchWechatRefund(
  prisma: PrismaService,
  wechatPay: WechatPayService,
  finalizer: OrderFinalizerService,
  refundId: string,
) {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    include: { order: true },
  });
  if (!refund) throw new NotFoundException('退款申请不存在');
  if (!active.includes(refund.status as never)) return refund;
  if (!refund.approvedById || !refund.approvedAt)
    throw new BadGatewayException('退款缺少审批记录，请联系财务核对');
  let providerStatus: string | undefined;
  try {
    const provider =
      refund.status === RefundStatus.APPROVED
        ? await wechatPay.createRefund({
            orderNo: refund.order.orderNo,
            refundNo: refund.refundNo,
            refundCents: refund.amountCents,
            totalCents: refund.order.paidCents,
            reason: refund.reason,
          })
        : await wechatPay.queryRefund(refund.refundNo, {
            orderNo: refund.order.orderNo,
            refundCents: refund.amountCents,
            totalCents: refund.order.paidCents,
          });
    providerStatus = provider?.status;
    if (!provider)
      throw new BadGatewayException('已受理退款暂未查询到，请等待对账');
    if (!['PROCESSING', 'SUCCESS'].includes(provider.status))
      throw new BadGatewayException(`微信退款需要人工处理：${provider.status}`);
    // A SUCCESS notification may win this race. Never overwrite a terminal row.
    await prisma.$transaction(async (tx) => {
      const changed = await tx.refund.updateMany({
        where: {
          id: refund.id,
          status: { in: active },
          approvedById: refund.approvedById,
        },
        data: {
          status: RefundStatus.PROCESSING,
          providerRefundNo: provider.refundId,
        },
      });
      if (changed.count === 1 && refund.status === RefundStatus.APPROVED) {
        await tx.auditLog.create({
          data: {
            actorId: refund.approvedById,
            actorRole: AppRole.FINANCE,
            action: 'WECHAT_REFUND_REQUESTED',
            objectType: 'Refund',
            objectId: refund.id,
            reason: refund.reason,
            newValue: {
              amountCents: refund.amountCents,
              providerRefundId: provider.refundId,
              providerStatus: provider.status,
            },
          },
        });
      }
    });
    if (provider.status === 'SUCCESS') {
      await finalizeRefund(prisma, finalizer, {
        out_refund_no: refund.refundNo,
        refund_id: provider.refundId,
        refund_status: 'SUCCESS',
        amount: { refund: refund.amountCents, total: refund.order.paidCents },
      });
    }
  } catch (error) {
    // An uncertain network response must never undo a committed money decision.
    // Persist an operator-visible event while retaining the same retry identity.
    logger.warn(`退款 ${refund.id} 同步未完成，将按原退款单号重试`);
    try {
      await prisma.$transaction(async (tx) => {
        // Lock the decision while recording the failure. A late failed request
        // must not create an OPEN event after another worker completed it.
        const pending = await tx.refund.updateMany({
          where: {
            id: refund.id,
            status: { in: active },
            approvedById: refund.approvedById,
          },
          data: { approvedById: refund.approvedById },
        });
        if (!pending.count) return;
        const manual =
          providerStatus === 'CLOSED' || providerStatus === 'ABNORMAL';
        const summary = manual
          ? '退款已审批，支付方返回异常终态，请财务核对处理'
          : '退款已审批，支付方同步尚未完成，系统将按原单号重试';
        const evidence = {
          refundNo: refund.refundNo,
          amountCents: refund.amountCents,
          ...(providerStatus ? { providerStatus } : {}),
          errorType: error instanceof Error ? error.name : 'UnknownError',
        };
        await tx.riskEvent.upsert({
          where: { dedupKey: `WECHAT-REFUND-DISPATCH:${refund.id}` },
          create: {
            dedupKey: `WECHAT-REFUND-DISPATCH:${refund.id}`,
            ruleCode: 'WECHAT_REFUND_DISPATCH_DEFERRED',
            severity: 'HIGH',
            userId: refund.order.memberId,
            orderId: refund.orderId,
            objectType: 'Refund',
            objectId: refund.id,
            summary,
            evidence,
            lastSeenAt: new Date(),
          },
          update: { summary, evidence, lastSeenAt: new Date() },
        });
      });
    } catch {
      logger.warn(
        `退款 ${refund.id} 异常事件记录暂未完成，持久审批记录仍可重试`,
      );
    }
  }
  return prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
}
