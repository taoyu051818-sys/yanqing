import { describe, expect, it, vi } from 'vitest';

import {
  AccountType,
  AppRole,
  BusinessType,
  OrderStatus,
  PaymentChannel,
  SourceChannel,
  SubjectAccount,
} from '../generated/prisma/client.js';
import { OrderFinalizerService } from './order-finalizer.service.js';

const now = new Date('2026-08-30T08:00:00.000Z');
const payment = {
  id: 'payment-1',
  paymentNo: 'PAY-1',
  channel: PaymentChannel.WECHAT,
  amountCents: 4_800,
  operatorId: 'member-1',
};

const baseOrder = (
  businessType: BusinessType,
  overrides: Record<string, unknown> = {},
) => ({
  id: 'order-1',
  orderNo: 'ORDER-1',
  creationIdempotencyKey: null,
  creationCommandHash: null,
  memberId: 'member-1',
  createdById: 'member-1',
  businessType,
  subjectAccount: SubjectAccount.VENUE,
  paymentChannel: null,
  sourceChannel: SourceChannel.MINI_PROGRAM,
  status: OrderStatus.PENDING,
  title: '即时履约订单',
  listAmountCents: 4_800,
  discountCents: 0,
  payableCents: 4_800,
  paidCents: 0,
  refundedCents: 0,
  externalOrderNo: null,
  consumedCouponCode: null,
  parameterSnapshot: {},
  paidAt: null,
  completedAt: null,
  cancelledAt: null,
  createdAt: now,
  updatedAt: now,
  items: [],
  membership: null,
  member: { openId: 'openid-1' },
  ...overrides,
});

function harness(order: ReturnType<typeof baseOrder>) {
  const consignment = {
    recordCompletedGoodsSale: vi.fn().mockResolvedValue([]),
    recordSucceededGoodsRefund: vi.fn().mockResolvedValue([]),
  };
  const tx = {
    order: {
      findUnique: vi
        .fn()
        .mockResolvedValueOnce({
          status: OrderStatus.PENDING,
          paidCents: 0,
          refundedCents: 0,
          paymentChannel: null,
          completedAt: null,
          businessType: order.businessType,
        })
        .mockResolvedValue({
          id: order.id,
          businessType: order.businessType,
          status: OrderStatus.PAID,
          completedAt: null,
          paidCents: order.payableCents,
          refundedCents: 0,
        }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
    courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    trainingEnrollment: { findUnique: vi.fn().mockResolvedValue(null) },
    gameRegistration: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    eventTeam: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    memberSubscription: { update: vi.fn().mockResolvedValue({}) },
    memberProfile: { update: vi.fn().mockResolvedValue({}) },
    account: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'account-1',
        userId: order.memberId,
        type: AccountType.CASH_PRINCIPAL,
        balance: 0,
        version: 0,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    accountTransaction: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'account-txn-1' }),
    },
    inventoryItem: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'item-1',
        stock: 10,
        defaultLocationId: 'location-1',
        batchCode: null,
        expiresAt: null,
        purchasePriceCents: 300,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryStockBalance: {
      findUnique: vi.fn().mockResolvedValue({ id: 'balance-1', quantity: 10 }),
      findMany: vi.fn().mockResolvedValue([{ quantity: 10 }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryTransaction: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'inventory-txn-1' }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  return {
    tx,
    consignment,
    service: new OrderFinalizerService(consignment as never),
  };
}

describe('instant order fulfillment after successful payment', () => {
  it.each([
    [
      BusinessType.MEMBERSHIP,
      baseOrder(BusinessType.MEMBERSHIP, {
        membership: {
          id: 'subscription-1',
          memberId: 'member-1',
          endsAt: new Date('2027-08-30T00:00:00.000Z'),
          product: { level: 'REGULAR' },
        },
      }),
    ],
    [
      BusinessType.GOODS,
      baseOrder(BusinessType.GOODS, {
        items: [
          {
            id: 'order-item-1',
            itemId: 'item-1',
            name: '比赛用球',
            quantity: 2,
            unitPriceCents: 2_400,
            amountCents: 4_800,
          },
        ],
      }),
    ],
    [
      BusinessType.RECHARGE,
      baseOrder(BusinessType.RECHARGE, {
        parameterSnapshot: { principalCents: 4_800, giftCents: 0 },
      }),
    ],
  ])(
    'marks %s completed only after its side effects',
    async (businessType, order) => {
      const { tx, service, consignment } = harness(order);

      await service.finalize(
        tx as never,
        order as never,
        payment,
        payment.operatorId,
        AppRole.MEMBER,
        now,
      );

      expect(tx.order.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: order.id, status: OrderStatus.PENDING },
        data: expect.objectContaining({
          status: OrderStatus.PAID,
          paidAt: now,
        }),
      });
      expect(tx.order.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: order.id, status: OrderStatus.PAID, completedAt: null },
        data: { status: OrderStatus.COMPLETED, completedAt: now },
      });
      expect(tx.auditLog.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          actorId: payment.operatorId,
          action: 'ORDER_PAID',
        }),
      });
      expect(tx.auditLog.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          actorId: payment.operatorId,
          action: 'ORDER_COMPLETED',
          newValue: expect.objectContaining({
            accountingTreatment:
              businessType === BusinessType.RECHARGE
                ? 'PREPAID_LIABILITY'
                : 'REALIZED_ON_FULFILLMENT',
          }),
        }),
      });
      expect(consignment.recordCompletedGoodsSale).toHaveBeenCalledTimes(
        businessType === BusinessType.GOODS ? 1 : 0,
      );
      if (businessType === BusinessType.GOODS) {
        expect(consignment.recordCompletedGoodsSale).toHaveBeenCalledWith(
          tx,
          order.id,
          payment.operatorId,
          AppRole.MEMBER,
        );
      }
    },
  );

  it('does not write completedAt when goods stock side effects fail', async () => {
    const order = baseOrder(BusinessType.GOODS, {
      items: [
        {
          id: 'order-item-1',
          itemId: 'missing-item',
          name: '不存在商品',
          quantity: 1,
          unitPriceCents: 4_800,
          amountCents: 4_800,
        },
      ],
    });
    const { tx, service, consignment } = harness(order);
    tx.inventoryItem.findUnique.mockResolvedValue(null);

    await expect(
      service.finalize(
        tx as never,
        order as never,
        payment,
        payment.operatorId,
        AppRole.MEMBER,
        now,
      ),
    ).rejects.toThrow('不存在');

    expect(tx.order.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(consignment.recordCompletedGoodsSale).not.toHaveBeenCalled();
  });

  it('rejects a zero-stock goods payment before stock or completion writes', async () => {
    const order = baseOrder(BusinessType.GOODS, {
      items: [
        {
          id: 'order-item-empty',
          itemId: 'item-empty',
          name: '售罄羽毛球',
          quantity: 1,
          unitPriceCents: 4_800,
          amountCents: 4_800,
        },
      ],
    });
    const { tx, service, consignment } = harness(order);
    tx.inventoryItem.findUnique.mockResolvedValue({
      id: 'item-empty',
      stock: 0,
      defaultLocationId: 'location-1',
      batchCode: null,
      expiresAt: null,
      purchasePriceCents: 300,
    });
    tx.inventoryStockBalance.findUnique.mockResolvedValue({
      id: 'balance-empty',
      quantity: 0,
    });
    tx.inventoryStockBalance.findMany.mockResolvedValue([{ quantity: 0 }]);

    await expect(
      service.finalize(
        tx as never,
        order as never,
        payment,
        payment.operatorId,
        AppRole.MEMBER,
        now,
      ),
    ).rejects.toThrow('库存不足');

    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryStockBalance.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(consignment.recordCompletedGoodsSale).not.toHaveBeenCalled();
  });

  it('rejects an audit actor that differs from the persisted payment operator', async () => {
    const order = baseOrder(BusinessType.MEMBERSHIP);
    const { tx, service } = harness(order);

    await expect(
      service.finalize(
        tx as never,
        order as never,
        payment,
        'another-user',
        AppRole.ADMIN,
        now,
      ),
    ).rejects.toThrow('支付操作人与终结器审计主体不一致');
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });
});
