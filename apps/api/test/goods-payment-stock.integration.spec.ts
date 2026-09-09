import { createOrderFinalizerService } from './support/domain-consumer-fixtures.js';
import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../src/common/auth/auth-user.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { GoodsService } from '../src/goods/goods.service.js';
import { ConsignmentSettlementService } from './support/consignment-settlement-fixture.js';
import { InventoryOperationsService } from './support/inventory-operations-fixture.js';
import { InventoryService } from './support/inventory-fixture.js';
import { OrdersService } from './support/orders-fixture.js';
import { OrderFinalizerService } from '../src/payments/order-finalizer.service.js';
import { WechatPayService } from '../src/payments/wechat-pay.service.js';
import type { AppRole } from '../src/generated/prisma/enums.js';

const url = process.env.TEST_DATABASE_URL;
const key = () => 'goods-stock-' + randomUUID();

describe.skipIf(!url)('goods payment stock boundaries', () => {
  let db: PrismaService;
  let goods: GoodsService;
  let inventory: InventoryService;
  let ops: InventoryOperationsService;
  let orders: OrdersService;
  let finalizer: OrderFinalizerService;
  let provider: {
    createJsapiPayment: ReturnType<typeof vi.fn>;
    closeOrder: ReturnType<typeof vi.fn>;
    createRefund: ReturnType<typeof vi.fn>;
  };
  let maker: AuthUser;
  let approver: AuthUser;

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    ) {
      throw new Error('Only an isolated local test database is allowed');
    }
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    goods = new GoodsService(db);
    inventory = new InventoryService(db);
    ops = new InventoryOperationsService(db);
    finalizer = createOrderFinalizerService(
      new ConsignmentSettlementService(db),
    );
    provider = {
      createJsapiPayment: vi
        .fn()
        .mockResolvedValue({ package: 'prepay_id=test' }),
      closeOrder: vi.fn().mockResolvedValue({ closed: true }),
      createRefund: vi.fn().mockImplementation(async () => ({
        refundId: key(),
        status: 'PROCESSING',
      })),
    };
    orders = new OrdersService(
      db,
      new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
      finalizer,
      provider as never,
    );
    maker = await person('ADMIN');
    approver = await person('ADMIN');
  });

  afterAll(async () => {
    if (db) await db.$disconnect();
  });

  async function person(role: AppRole = 'MEMBER'): Promise<AuthUser> {
    const user = await db.user.create({
      data: {
        displayName: '第十轮隔离用户',
        openId: key(),
        primaryRole: role,
        memberProfile: { create: { tags: [] } },
        accounts: { create: { type: 'CASH_PRINCIPAL', balance: 100000 } },
      },
    });
    return { sub: user.id, displayName: user.displayName, roles: [role] };
  }

  async function stockedItem(stock: number, batchCode = 'DEFAULT') {
    const supplier = await db.supplier.create({
      data: {
        code: key(),
        name: '隔离供应商',
        type: 'OWNED',
      },
    });
    const location = await db.inventoryLocation.create({
      data: { code: key(), name: '默认库位' },
    });
    const item = await inventory.create(
      {
        sku: key(),
        name: '隔离羽球',
        category: '球类',
        mode: 'PURCHASE',
        supplierId: supplier.id,
        defaultLocationId: location.id,
        purchasePriceCents: 100,
        salePriceCents: 2000,
        safeStock: 0,
        batchCode: 'DEFAULT',
        reason: '第十轮隔离抽查',
        idempotencyKey: key(),
      },
      maker,
    );
    if (stock > 0) {
      const po = await ops.createPurchaseOrder(
        {
          supplierId: supplier.id,
          lines: [
            {
              itemId: item.id,
              locationId: location.id,
              orderedQuantity: stock,
              unitCostCents: 100,
              batchCode,
            },
          ],
        },
        maker,
      );
      await ops.submitPurchaseOrder(po.id, maker);
      await ops.approvePurchaseOrder(po.id, approver);
      await ops.receivePurchaseOrder(
        po.id,
        {
          idempotencyKey: key(),
          lines: po.lines.map((line) => ({
            lineId: line.id,
            quantity: line.orderedQuantity,
          })),
        },
        maker,
      );
    }
    return { item, supplier, location };
  }

  async function goodsOrder(itemId: string, buyer: AuthUser) {
    return goods.createOrder(
      {
        items: [{ itemId, quantity: 1 }],
        creationIdempotencyKey: key(),
      },
      buyer,
    );
  }

  async function notify(
    orderNo: string,
    amountCents: number,
    transactionId = key(),
  ) {
    return sendNotice('TRANSACTION.SUCCESS', {
      out_trade_no: orderNo,
      transaction_id: transactionId,
      trade_state: 'SUCCESS',
      amount: { total: amountCents },
    });
  }

  async function sendNotice(
    eventType: string,
    notice: Record<string, unknown>,
  ) {
    const wechat = new WechatPayService(
      new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
      db,
      finalizer,
    );
    const notificationBoundary = wechat as unknown as {
      verifyWechatSignature: () => void;
      decrypt: () => Record<string, unknown>;
    };
    vi.spyOn(notificationBoundary, 'verifyWechatSignature').mockImplementation(
      () => {},
    );
    vi.spyOn(notificationBoundary, 'decrypt').mockReturnValue(notice);
    return wechat.handleNotification(
      Buffer.from(JSON.stringify({ event_type: eventType, resource: {} })),
      {
        'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)),
        'wechatpay-nonce': 'test',
        'wechatpay-signature': 'test',
        'wechatpay-serial': 'test',
      },
    );
  }

  async function captured<T>(work: Promise<T>) {
    try {
      return { value: await work, error: undefined };
    } catch (error) {
      return { value: undefined, error };
    }
  }

  it('reserves stock at prepay and blocks both WeChat and balance payments from consuming it', async () => {
    const buyerA = await person();
    const buyerB = await person();
    const { item } = await stockedItem(1);
    const first = await goodsOrder(item.id, buyerA);
    const second = await goodsOrder(item.id, buyerB);

    await orders.pay(
      first.id,
      { channel: 'WECHAT', idempotencyKey: key() },
      buyerA,
    );
    await expect(
      orders.pay(
        second.id,
        { channel: 'WECHAT', idempotencyKey: key() },
        buyerB,
      ),
    ).rejects.toThrow('库存不足');
    await expect(
      orders.pay(
        second.id,
        { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
        buyerB,
      ),
    ).rejects.toThrow('库存不足');
    expect(await db.payment.count({ where: { orderId: second.id } })).toBe(0);
    const account = await db.account.findUniqueOrThrow({
      where: { userId_type: { userId: buyerB.sub, type: 'CASH_PRINCIPAL' } },
    });
    expect(account.balance).toBe(100000);
    await notify(first.orderNo, first.payableCents);
    expect(
      await db.inventoryTransaction.count({
        where: { itemId: item.id, type: 'SALE_OUT' },
      }),
    ).toBe(1);
  });

  it('allows only one concurrent prepay for the last unit before contacting WeChat', async () => {
    const buyerA = await person();
    const buyerB = await person();
    const { item } = await stockedItem(1);
    const first = await goodsOrder(item.id, buyerA);
    const second = await goodsOrder(item.id, buyerB);
    const providerCalls = provider.createJsapiPayment.mock.calls.length;
    const results = await Promise.allSettled([
      orders.pay(
        first.id,
        { channel: 'WECHAT', idempotencyKey: key() },
        buyerA,
      ),
      orders.pay(
        second.id,
        { channel: 'WECHAT', idempotencyKey: key() },
        buyerB,
      ),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(provider.createJsapiPayment.mock.calls.length - providerCalls).toBe(
      1,
    );
    expect(
      await db.payment.count({
        where: { orderId: { in: [first.id, second.id] } },
      }),
    ).toBe(1);
  });

  it('releases a reservation only after cancelling the pending order', async () => {
    const buyer = await person();
    const { item } = await stockedItem(1);
    const first = await goodsOrder(item.id, buyer);
    const second = await goodsOrder(item.id, buyer);
    await orders.pay(
      first.id,
      { channel: 'WECHAT', idempotencyKey: key() },
      buyer,
    );
    await orders.cancelPending(
      first.id,
      { reason: '取消购买', idempotencyKey: key() },
      buyer,
    );
    await orders.pay(
      second.id,
      { channel: 'WECHAT', idempotencyKey: key() },
      buyer,
    );
    await notify(second.orderNo, second.payableCents);
    expect(
      await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } }),
    ).toMatchObject({ stock: 0 });
  });

  it('captures external success and creates one compensation refund when physical stock is lost', async () => {
    const buyer = await person();
    const { item } = await stockedItem(1);
    const { item: availableItem } = await stockedItem(1);
    const order = await goods.createOrder(
      {
        items: [
          { itemId: availableItem.id, quantity: 1 },
          { itemId: item.id, quantity: 1 },
        ],
        creationIdempotencyKey: key(),
      },
      buyer,
    );
    await orders.pay(
      order.id,
      { channel: 'WECHAT', idempotencyKey: key() },
      buyer,
    );
    // Simulate stock loss discovered after prepay. No sale was fulfilled.
    await db.$transaction([
      db.inventoryItem.update({ where: { id: item.id }, data: { stock: 0 } }),
      db.inventoryStockBalance.updateMany({
        where: { itemId: item.id },
        data: { quantity: 0 },
      }),
    ]);
    const tradeNo = key();
    expect(
      await notify(order.orderNo, order.payableCents, tradeNo),
    ).toMatchObject({ accepted: true, refundReviewRequired: true });
    expect(
      await notify(order.orderNo, order.payableCents, tradeNo),
    ).toMatchObject({ accepted: true, idempotent: true });
    const persisted = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: true, refunds: true },
    });
    expect(persisted).toMatchObject({
      status: 'REFUND_PENDING',
      paidCents: order.payableCents,
    });
    expect(persisted.payments[0]).toMatchObject({
      status: 'SUCCEEDED',
      providerTradeNo: tradeNo,
    });
    expect(persisted.refunds).toHaveLength(1);
    expect(persisted.refunds[0]).toMatchObject({
      compensationOnly: true,
      amountCents: order.payableCents,
      status: 'REQUESTED',
    });
    expect(await db.riskEvent.count({ where: { orderId: order.id } })).toBe(1);
    expect(
      await db.inventoryTransaction.count({
        where: { itemId: item.id, type: 'SALE_OUT' },
      }),
    ).toBe(0);
    const refund = persisted.refunds[0];
    await orders.approveRefund(
      refund.id,
      { reason: '核对未交付，原路退款' },
      approver,
    );
    const notice = {
      out_refund_no: refund.refundNo,
      refund_id: key(),
      refund_status: 'SUCCESS',
      amount: { refund: refund.amountCents, total: order.payableCents },
    };
    await sendNotice('REFUND.SUCCESS', notice);
    await sendNotice('REFUND.SUCCESS', notice);
    expect(
      await db.refund.findUniqueOrThrow({ where: { id: refund.id } }),
    ).toMatchObject({ status: 'SUCCEEDED' });
    expect(
      await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } }),
    ).toMatchObject({ stock: 0 });
    expect(
      await db.inventoryTransaction.count({
        where: {
          itemId: { in: [item.id, availableItem.id] },
          orderItemId: { not: null },
        },
      }),
    ).toBe(0);
    expect(
      await db.inventoryItem.findUniqueOrThrow({
        where: { id: availableItem.id },
      }),
    ).toMatchObject({ stock: 1 });
  });

  it('finishes both WeChat callbacks when stock is enough', async () => {
    const buyerA = await person();
    const buyerB = await person();
    const { item } = await stockedItem(2);
    const first = await goodsOrder(item.id, buyerA);
    const second = await goodsOrder(item.id, buyerB);

    await orders.pay(
      first.id,
      { channel: 'WECHAT', idempotencyKey: key() },
      buyerA,
    );
    await orders.pay(
      second.id,
      { channel: 'WECHAT', idempotencyKey: key() },
      buyerB,
    );
    await notify(first.orderNo, first.payableCents);
    await notify(second.orderNo, second.payableCents);

    expect(
      await db.order.findMany({
        where: { id: { in: [first.id, second.id] } },
        select: { status: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual([{ status: 'COMPLETED' }, { status: 'COMPLETED' }]);
    expect(
      await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } }),
    ).toMatchObject({ stock: 0 });
  });

  it('rejects the second account-balance goods payment before local money is debited', async () => {
    const buyerA = await person();
    const buyerB = await person();
    const { item } = await stockedItem(1);
    const first = await goodsOrder(item.id, buyerA);
    const second = await goodsOrder(item.id, buyerB);

    await orders.pay(
      first.id,
      { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
      buyerA,
    );
    const secondResult = await captured(
      orders.pay(
        second.id,
        { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
        buyerB,
      ),
    );

    const secondAccount = await db.account.findUniqueOrThrow({
      where: { userId_type: { userId: buyerB.sub, type: 'CASH_PRINCIPAL' } },
    });
    expect(secondResult.error).toMatchObject({ status: 400 });
    expect(secondAccount.balance).toBe(100000);
    expect(await db.payment.count({ where: { orderId: second.id } })).toBe(0);
  });

  it('fulfills stock received in a non-default batch and records its source', async () => {
    const buyer = await person();
    const { item } = await stockedItem(10, 'BATCH-A');

    expect(await goods.products()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: item.id, stock: 10 }),
      ]),
    );
    const order = await goodsOrder(item.id, buyer);
    await orders.pay(
      order.id,
      { channel: 'WECHAT', idempotencyKey: key() },
      buyer,
    );
    const failed = await captured(notify(order.orderNo, order.payableCents));

    const balances = await db.inventoryStockBalance.findMany({
      where: { itemId: item.id },
      select: { batchCode: true, quantity: true },
      orderBy: { batchCode: 'asc' },
    });
    const persisted = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: true },
    });
    expect(failed.error).toBeUndefined();
    expect(balances).toEqual([
      { batchCode: 'BATCH-A', quantity: 9 },
      { batchCode: 'DEFAULT', quantity: 0 },
    ]);
    expect(persisted).toMatchObject({
      status: 'COMPLETED',
      paidCents: order.payableCents,
    });
    expect(persisted.payments[0]).toMatchObject({ status: 'SUCCEEDED' });
    const sale = await db.inventoryTransaction.findFirstOrThrow({
      where: { itemId: item.id, type: 'SALE_OUT' },
    });
    expect(sale.metadata).toMatchObject({
      allocations: [{ batchCode: 'BATCH-A', quantity: 1 }],
    });
  });

  it('fulfills the same goods flow when the stock is in the default batch', async () => {
    const buyer = await person();
    const { item } = await stockedItem(10, 'DEFAULT');
    const order = await goodsOrder(item.id, buyer);
    await orders.pay(
      order.id,
      { channel: 'WECHAT', idempotencyKey: key() },
      buyer,
    );

    await notify(order.orderNo, order.payableCents);

    expect(
      await db.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).toMatchObject({ status: 'COMPLETED', paidCents: order.payableCents });
    expect(
      await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } }),
    ).toMatchObject({ stock: 9 });
  });

  it.each(['WECHAT', 'CASH_PRINCIPAL'] as const)(
    'restores the original split batches on a full %s refund',
    async (channel) => {
      const buyer = await person();
      const { item, location } = await stockedItem(3, 'BATCH-A');
      // Split the receipt across batches as an isolated fixture; aggregate stock stays 3.
      await db.$transaction([
        db.inventoryStockBalance.updateMany({
          where: { itemId: item.id, batchCode: 'BATCH-A' },
          data: { quantity: 1 },
        }),
        db.inventoryStockBalance.create({
          data: {
            itemId: item.id,
            locationId: location.id,
            batchCode: 'BATCH-B',
            quantity: 2,
          },
        }),
      ]);
      const order = await goods.createOrder(
        {
          items: [{ itemId: item.id, quantity: 3 }],
          creationIdempotencyKey: key(),
        },
        buyer,
      );
      await orders.pay(order.id, { channel, idempotencyKey: key() }, buyer);
      if (channel === 'WECHAT') await notify(order.orderNo, order.payableCents);
      expect(
        await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } }),
      ).toMatchObject({ stock: 0 });
      const refund = await orders.requestRefund(
        order.id,
        {
          amountCents: order.payableCents,
          reason: '整单退货',
          idempotencyKey: key(),
        },
        buyer,
      );
      await orders.approveRefund(refund.id, { reason: '确认退货' }, approver);
      if (channel === 'WECHAT') {
        const persistedRefund = await db.refund.findUniqueOrThrow({
          where: { id: refund.id },
        });
        const notice = {
          out_refund_no: persistedRefund.refundNo,
          refund_id: key(),
          refund_status: 'SUCCESS',
          amount: { refund: refund.amountCents, total: order.payableCents },
        };
        await sendNotice('REFUND.SUCCESS', notice);
        await sendNotice('REFUND.SUCCESS', notice);
      }
      expect(
        await db.inventoryStockBalance.findMany({
          where: { itemId: item.id },
          select: { batchCode: true, quantity: true },
          orderBy: { batchCode: 'asc' },
        }),
      ).toEqual([
        { batchCode: 'BATCH-A', quantity: 1 },
        { batchCode: 'BATCH-B', quantity: 2 },
        { batchCode: 'DEFAULT', quantity: 0 },
      ]);
      expect(
        await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } }),
      ).toMatchObject({ stock: 3 });
    },
  );
});
