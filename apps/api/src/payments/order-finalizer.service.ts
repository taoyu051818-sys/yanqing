import { Inject } from '@nestjs/common';
import { ConsignmentLedgerService } from '../inventory/consignment/ledger/consignment-settlement-ledger.service.js';
import { transitionOrder } from '../orders/order-transition.js';
import { ConflictException, Injectable } from '@nestjs/common';
import {
  AppRole,
  BusinessType,
  OrderStatus,
  PaymentChannel,
  Prisma,
} from '../generated/prisma/client.js';
import { completeOrderFulfillment } from '../orders/order-fulfillment.js';
import {
  PayableOrder,
  PaidOrderContext,
} from '../orders/paid-order-context.js';
import {
  assertPaidOrderResources,
  applyPaidOrderEffects,
} from '../orders/paid-order-effects.js';

const INSTANT_FULFILLMENT_TYPES: ReadonlySet<BusinessType> = new Set([
  BusinessType.MEMBERSHIP,
  BusinessType.GOODS,
  BusinessType.RECHARGE,
]);
const REPAIRABLE_FULFILLMENT_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.PAID,
  OrderStatus.CHECKED_IN,
  OrderStatus.COMPLETED,
  OrderStatus.REFUND_PENDING,
  OrderStatus.PARTIALLY_REFUNDED,
]);
export type { PayableOrder } from '../orders/paid-order-context.js';
@Injectable()
export class OrderFinalizerService {
  constructor(
    @Inject(ConsignmentLedgerService)
    private readonly consignmentLedger: ConsignmentLedgerService,
  ) {}

  async finalize(
    tx: Prisma.TransactionClient,
    order: PayableOrder,
    payment: {
      id: string;
      paymentNo: string;
      channel: PaymentChannel;
      amountCents?: number;
      operatorId?: string;
    },
    actorId: string,
    actorRole: AppRole,
    now = new Date(),
  ): Promise<void> {
    const paymentActorId = payment.operatorId ?? actorId;
    if (payment.operatorId && payment.operatorId !== actorId) {
      throw new ConflictException('支付操作人与终结器审计主体不一致');
    }
    // Payment notifications and client retries can arrive more than once.  A
    // successful finalisation is the commit boundary for every downstream
    // side effect, so a retry must return without touching balances, stock,
    // coupons or rewards a second time.  The conditional update also closes
    // the race between two workers handling the same provider callback.
    const current = await tx.order.findUnique({
      where: { id: order.id },
      select: {
        status: true,
        paidCents: true,
        refundedCents: true,
        paymentChannel: true,
        completedAt: true,
        businessType: true,
      },
    });
    if (current && current.status !== OrderStatus.PENDING) {
      if (current.status === OrderStatus.CANCELLED) {
        throw new ConflictException('订单已取消，付款必须进入补偿退款流程');
      }
      if (
        INSTANT_FULFILLMENT_TYPES.has(order.businessType) &&
        !current.completedAt &&
        REPAIRABLE_FULFILLMENT_STATUSES.has(current.status)
      ) {
        await this.completeInstantOrder(
          tx,
          order,
          payment,
          paymentActorId,
          actorRole,
          now,
        );
      }
      return;
    }
    const context: PaidOrderContext = {
      tx,
      order,
      payment,
      paymentActorId,
      actorRole,
      now,
    };
    await assertPaidOrderResources(context);
    const changed = await transitionOrder(tx, 'PAY', {
      where: { id: order.id, status: OrderStatus.PENDING },
      data: {
        status: OrderStatus.PAID,
        paymentChannel: payment.channel,
        paidCents: order.payableCents,
        paidAt: now,
      },
    });
    if (changed.count !== 1) return;

    if (
      payment.amountCents !== undefined &&
      payment.amountCents !== order.payableCents
    ) {
      throw new ConflictException('支付金额与订单应付金额不一致');
    }
    await applyPaidOrderEffects(context);
    await tx.auditLog.create({
      data: {
        actorId: paymentActorId,
        actorRole,
        action: 'ORDER_PAID',
        objectType: 'Order',
        objectId: order.id,
        newValue: {
          paymentNo: payment.paymentNo,
          channel: payment.channel,
        } as never,
      },
    });
    if (INSTANT_FULFILLMENT_TYPES.has(order.businessType)) {
      await this.completeInstantOrder(
        tx,
        order,
        payment,
        paymentActorId,
        actorRole,
        now,
      );
    }
  }

  recordSucceededGoodsRefund(
    tx: Prisma.TransactionClient,
    refundId: string,
    actorId: string,
    actorRole: AppRole,
  ) {
    return this.consignmentLedger.recordSucceededGoodsRefund(
      tx,
      refundId,
      actorId,
      actorRole,
    );
  }

  private async completeInstantOrder(
    tx: Prisma.TransactionClient,
    order: PayableOrder,
    payment: {
      id: string;
      paymentNo: string;
      channel: PaymentChannel;
    },
    actorId: string,
    actorRole: AppRole,
    completedAt: Date,
  ): Promise<void> {
    const outcome =
      order.businessType === BusinessType.GOODS
        ? ('FULFILLED' as const)
        : ('ACTIVATED' as const);
    const reason =
      order.businessType === BusinessType.MEMBERSHIP
        ? '会员权益已激活'
        : order.businessType === BusinessType.GOODS
          ? '商品销售已完成出库'
          : '充值本金与赠送账户已入账';
    await completeOrderFulfillment(tx, {
      orderId: order.id,
      actor: {
        sub: actorId,
        displayName: '支付操作人',
        roles: [actorRole],
      },
      objectType: 'Payment',
      objectId: payment.id,
      outcome,
      completedAt,
      reason,
      metadata: {
        paymentNo: payment.paymentNo,
        channel: payment.channel,
        accountingTreatment:
          order.businessType === BusinessType.RECHARGE
            ? 'PREPAID_LIABILITY'
            : 'REALIZED_ON_FULFILLMENT',
      },
    });
    if (order.businessType === BusinessType.GOODS) {
      await this.consignmentLedger.recordCompletedGoodsSale(
        tx,
        order.id,
        actorId,
        actorRole,
      );
    }
  }
}
