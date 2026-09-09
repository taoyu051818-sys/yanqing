import { createOrderFinalizerService } from './support/domain-consumer-fixtures.js';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { AllianceService } from './support/alliance-fixture.js';
import { InventoryOperationsService } from './support/inventory-operations-fixture.js';
import { ConsignmentSettlementService } from './support/consignment-settlement-fixture.js';
import { FrontDeskShiftsService } from '../src/operations/frontdesk-shifts.service.js';
import { GoodsService } from '../src/goods/goods.service.js';
import { OrdersService } from './support/orders-fixture.js';

import type { AuthUser } from '../src/common/auth/auth-user.js';
import type { AppRole } from '../src/generated/prisma/enums.js';

const url = process.env.TEST_DATABASE_URL;
const key = () => 'ledger-' + randomUUID();
describe.skipIf(!url)('ledger boundaries on PostgreSQL', () => {
  let db: PrismaService,
    ops: InventoryOperationsService,
    alliance: AllianceService;
  let admin: AuthUser, maker: AuthUser;
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    )
      throw new Error('Only an isolated local test database is allowed');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    ops = new InventoryOperationsService(db);
    alliance = new AllianceService(db);
    admin = await person('ADMIN');
    maker = await person('ADMIN');
  });
  afterAll(async () => {
    if (db) await db.$disconnect();
  });
  async function person(role: AppRole = 'MEMBER'): Promise<AuthUser> {
    const user = await db.user.create({
      data: {
        displayName: '账本边界测试',
        primaryRole: role,
        memberProfile: { create: { tags: [] } },
      },
    });
    return { sub: user.id, displayName: user.displayName, roles: [role] };
  }
  async function inventory() {
    const supplier = await db.supplier.create({
      data: {
        code: key(),
        name: '隔离供应商',
        type: 'OWNED',
      },
    });
    const main = await db.inventoryLocation.create({
      data: { code: key(), name: '默认库位' },
    });
    const other = await db.inventoryLocation.create({
      data: { code: key(), name: '另一库位' },
    });
    const item = await db.inventoryItem.create({
      data: {
        sku: key(),
        name: '隔离羽球',
        category: '球类',
        mode: 'PURCHASE',
        supplier: supplier.name,
        supplierId: supplier.id,
        stock: 20,
        purchasePriceCents: 100,
        salePriceCents: 10000,
        defaultLocationId: main.id,
        batchCode: 'DEFAULT',
      },
    });
    await db.inventoryStockBalance.createMany({
      data: [
        {
          itemId: item.id,
          locationId: main.id,
          batchCode: 'DEFAULT',
          quantity: 10,
        },
        {
          itemId: item.id,
          locationId: other.id,
          batchCode: 'DEFAULT',
          quantity: 10,
        },
      ],
    });
    return { item, supplier, main, other };
  }
  async function purchase(
    f: Awaited<ReturnType<typeof inventory>>,
    both = false,
  ) {
    const lines = [
      {
        itemId: f.item.id,
        locationId: f.main.id,
        batchCode: 'DEFAULT',
        orderedQuantity: 2,
        unitCostCents: 100,
      },
      ...(both
        ? [
            {
              itemId: f.item.id,
              locationId: f.main.id,
              batchCode: 'BATCH-B',
              orderedQuantity: 3,
              unitCostCents: 100,
            },
          ]
        : []),
    ];
    const po = await ops.createPurchaseOrder(
      { supplierId: f.supplier.id, lines },
      maker,
    );
    await ops.submitPurchaseOrder(po.id, maker);
    await ops.approvePurchaseOrder(po.id, admin);
    return po;
  }
  async function captured<T>(work: Promise<T>) {
    try {
      return { value: await work, error: undefined };
    } catch (error) {
      return { value: undefined, error };
    }
  }

  it.each([true, false])(
    'multi-batch receipt succeeds independent of default-first=%s',
    async (defaultFirst) => {
      const f = await inventory(),
        po = await purchase(f, true);
      const lines = po.lines.map((line) => ({
        lineId: line.id,
        quantity: line.orderedQuantity,
        default: line.batchCode === 'DEFAULT',
      }));
      lines.sort((a, b) =>
        defaultFirst
          ? Number(b.default) - Number(a.default)
          : Number(a.default) - Number(b.default),
      );
      const result = await captured(
        ops.receivePurchaseOrder(
          po.id,
          {
            idempotencyKey: key(),
            lines: lines.map(({ lineId, quantity }) => ({ lineId, quantity })),
          },
          maker,
        ),
      );
      const stock = await db.inventoryItem.findUniqueOrThrow({
        where: { id: f.item.id },
      });
      expect(result.error).toBeUndefined();
      expect(stock.stock).toBe(25);
    },
  );

  it.each([false, true])(
    'transfer posts in either direction, into-default=%s',
    async (intoDefault) => {
      const f = await inventory();
      const source = intoDefault ? f.other : f.main,
        target = intoDefault ? f.main : f.other;
      const operation = await ops.createOperation(
        {
          type: 'TRANSFER',
          itemId: f.item.id,
          quantity: 3,
          sourceLocationId: source.id,
          targetLocationId: target.id,
          batchCode: 'DEFAULT',
          reason: '隔离正常调拨',
        },
        maker,
      );
      await ops.submitOperation(operation.id, maker);
      await ops.approveOperation(operation.id, admin);
      const result = await captured(
        ops.postOperation(operation.id, { idempotencyKey: key() }, maker),
      );
      const balances = await db.inventoryStockBalance.findMany({
        where: { itemId: f.item.id },
      });
      expect(result.error).toBeUndefined();
      expect(balances.find((b) => b.locationId === source.id)?.quantity).toBe(
        7,
      );
      expect(balances.find((b) => b.locationId === target.id)?.quantity).toBe(
        13,
      );
    },
  );

  it('concurrent cancellation cannot cancel a purchase order whose goods were received', async () => {
    const f = await inventory(),
      po = await purchase(f);
    let reached!: () => void, resume!: () => void;
    const read = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let paused = false;
    const instrumented = db.$extends({
      query: {
        purchaseOrder: {
          async findUnique({ args, query }) {
            const row = await query(args);
            if (!paused && args.where.id === po.id) {
              paused = true;
              reached();
              await gate;
            }
            return row;
          },
        },
      },
    });
    const cancelling = captured(
      new InventoryOperationsService(instrumented as never).cancelPurchaseOrder(
        po.id,
        { reason: '隔离并发取消' },
        admin,
      ),
    );
    await read;
    try {
      await ops.receivePurchaseOrder(
        po.id,
        {
          idempotencyKey: key(),
          lines: [{ lineId: po.lines[0].id, quantity: 2 }],
        },
        maker,
      );
    } finally {
      resume();
    }
    const cancellation = await cancelling;
    const after = await db.purchaseOrder.findUniqueOrThrow({
      where: { id: po.id },
      include: { lines: true },
    });
    expect(cancellation.error).toMatchObject({ status: 409 });
    expect(after.status).toBe('RECEIVED');
    expect(after.lines[0].receivedQuantity).toBe(2);
  }, 15000);

  async function redeemedCoupon() {
    const merchant = await alliance.createMerchant(
      {
        code: key(),
        name: '隔离联盟商户',
        category: '餐饮',
        level: 'TRAFFIC_PARTNER',
        settlementRule: { mode: 'PER_REDEMPTION', amountCents: 1000 },
      },
      admin,
    );
    const start = new Date(Date.now() - 86400000),
      end = new Date(Date.now() + 86400000);
    const template = await alliance.createTemplate(
      {
        code: key(),
        merchantId: merchant.id,
        name: '隔离联盟券',
        activityName: '隔离活动',
        benefitDescription: '隔离核销权益',
        faceValueCents: 0,
        allowVenueBooking: false,
        validFrom: start.toISOString(),
        validTo: end.toISOString(),
        claimLimitPerUser: 1,
        issueLimit: 10,
      },
      admin,
    );
    const batch = await alliance.generateCodes(
      template.id,
      { count: 1, idempotencyKey: key() },
      admin,
    );
    const holder = await person();
    await alliance.claim(batch.codes[0], holder);
    await alliance.redeem(
      {
        code: batch.codes[0],
        merchantId: merchant.id,
        attributedAmountCents: 10000,
        idempotencyKey: key(),
      },
      admin,
    );
    return { merchant, start, end };
  }
  async function finishAlliance(id: string) {
    await alliance.submitSettlement(id, admin);
    await alliance.confirmSettlement(id, admin);
    return alliance.settleSettlement(id, admin);
  }
  it('control: exact same alliance period replays without a duplicate statement', async () => {
    const f = await redeemedCoupon();
    const dto = {
      merchantId: f.merchant.id,
      periodStart: f.start.toISOString(),
      periodEnd: new Date().toISOString(),
      attributedGrossProfitCents: 2000,
    };
    const first = await alliance.createSettlement(dto, admin);
    await finishAlliance(first.id);
    const again = await alliance.createSettlement(dto, admin);
    expect(again.id).toBe(first.id);
    expect(
      await db.allianceSettlement.count({
        where: { merchantId: f.merchant.id },
      }),
    ).toBe(1);
  });
  it('overlapping alliance periods cannot settle the same redemption twice', async () => {
    const f = await redeemedCoupon();
    const dto = {
      merchantId: f.merchant.id,
      periodStart: f.start.toISOString(),
      periodEnd: new Date().toISOString(),
      attributedGrossProfitCents: 2000,
    };
    const first = await alliance.createSettlement(dto, admin);
    await finishAlliance(first.id);
    const second = await captured(
      alliance.createSettlement(
        {
          ...dto,
          periodStart: new Date(f.start.getTime() - 86400000).toISOString(),
        },
        admin,
      ),
    );
    expect(second.error).toMatchObject({ status: 409 });
    expect(second.value).toBeUndefined();
    const rows = await db.allianceSettlement.findMany({
      where: { merchantId: f.merchant.id, status: 'SETTLED' },
    });
    const fee = rows.reduce((sum, row) => sum + row.cooperationFeeCents, 0);
    expect(fee).toBe(1000);
  });

  it.each([false, true])(
    'member-created goods cash sale closes with zero variance, refunded=%s',
    async (refunded) => {
      const f = await inventory(),
        buyer = await person(),
        cashier = await person('ADMIN');
      const shifts = new FrontDeskShiftsService(db);
      const orders = new OrdersService(
        db,
        new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
        createOrderFinalizerService(new ConsignmentSettlementService(db)),
        {} as never,
      );
      const shift = await shifts.open({ openingCashCents: 0 }, cashier);
      const order = await new GoodsService(db).createOrder(
        {
          items: [{ itemId: f.item.id, quantity: 1 }],
          creationIdempotencyKey: key(),
        },
        buyer,
      );
      await orders.pay(
        order.id,
        { channel: 'OFFLINE_CASH', idempotencyKey: key() },
        cashier,
      );
      if (refunded) {
        const request = await orders.requestRefund(
          order.id,
          { amountCents: 10000, reason: '隔离整单退货', idempotencyKey: key() },
          buyer,
        );
        await orders.approveRefund(
          request.id,
          { reason: '隔离核对退款' },
          cashier,
        );
      }
      const closed = await shifts.close(
        shift.id,
        {
          closingCashCents: refunded ? 0 : 10000,
          handoverNote: '隔离现金清点',
        },
        cashier,
      );
      expect(closed.cashVarianceCents).toBe(0);
    },
  );

  it.each([false, true])(
    'concurrent alliance creation is safe for identical-period=%s',
    async (identical) => {
      const f = await redeemedCoupon();
      let arrived = 0,
        release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const instrumented = db.$extends({
        query: {
          allianceSettlement: {
            async findFirst({ args, query }) {
              const row = await query(args);
              if (args.where?.merchantId === f.merchant.id && arrived < 2) {
                arrived += 1;
                if (arrived === 2) release();
                await gate;
              }
              return row;
            },
          },
        },
      });
      const service = new AllianceService(instrumented as never);
      const dto = {
        merchantId: f.merchant.id,
        periodStart: f.start.toISOString(),
        periodEnd: new Date().toISOString(),
        attributedGrossProfitCents: 2000,
      };
      const results = await Promise.all([
        captured(service.createSettlement(dto, admin)),
        captured(
          service.createSettlement(
            {
              ...dto,
              periodStart: identical
                ? dto.periodStart
                : new Date(f.start.getTime() - 1000).toISOString(),
            },
            admin,
          ),
        ),
      ]);
      expect(
        await db.allianceSettlement.count({
          where: { merchantId: f.merchant.id },
        }),
      ).toBe(1);
      expect(results.filter((r) => r.value)).toHaveLength(identical ? 2 : 1);
      if (identical) expect(results[0].value?.id).toBe(results[1].value?.id);
      else
        expect(results.find((r) => r.error)?.error).toMatchObject({
          status: 409,
        });
    },
    15000,
  );

  it('accepts adjacent periods and prevents direct database overlap or void reactivation', async () => {
    const f = await redeemedCoupon();
    const end = new Date();
    const first = await alliance.createSettlement(
      {
        merchantId: f.merchant.id,
        periodStart: f.start.toISOString(),
        periodEnd: end.toISOString(),
        attributedGrossProfitCents: 2000,
      },
      admin,
    );
    await alliance.createSettlement(
      {
        merchantId: f.merchant.id,
        periodStart: end.toISOString(),
        periodEnd: new Date(end.getTime() + 1000).toISOString(),
        attributedGrossProfitCents: 0,
      },
      admin,
    );
    const row = await db.allianceSettlement.findUniqueOrThrow({
      where: { id: first.id },
    });
    const overlapping = {
      ...row,
      id: key(),
      detail: { verification: 'database overlap constraint' },
      periodStart: new Date(f.start.getTime() - 1000),
    };
    await expect(
      db.allianceSettlement.create({ data: overlapping }),
    ).rejects.toThrow();
    const voided = await db.allianceSettlement.create({
      data: { ...overlapping, status: 'VOID' },
    });
    await expect(
      db.allianceSettlement.update({
        where: { id: voided.id },
        data: { status: 'DRAFT' },
      }),
    ).rejects.toThrow();
    await expect(
      alliance.createSettlement(
        {
          merchantId: f.merchant.id,
          periodStart: f.start.toISOString(),
          periodEnd: end.toISOString(),
          attributedGrossProfitCents: 1,
        },
        admin,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each(['submit', 'approve', 'receive'] as const)(
    'purchase %s cannot revive a concurrently cancelled document',
    async (action) => {
      const f = await inventory();
      const po = await ops.createPurchaseOrder(
        {
          supplierId: f.supplier.id,
          lines: [
            {
              itemId: f.item.id,
              locationId: f.main.id,
              orderedQuantity: 2,
              unitCostCents: 100,
              batchCode: 'DEFAULT',
            },
          ],
        },
        maker,
      );
      if (action !== 'submit') await ops.submitPurchaseOrder(po.id, maker);
      if (action === 'receive') await ops.approvePurchaseOrder(po.id, admin);
      let reached!: () => void, resume!: () => void;
      const read = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      let paused = false;
      const instrumented = db.$extends({
        query: {
          purchaseOrder: {
            async findUnique({ args, query }) {
              const row = await query(args);
              if (!paused && args.where.id === po.id) {
                paused = true;
                reached();
                await gate;
              }
              return row;
            },
          },
        },
      });
      const service = new InventoryOperationsService(instrumented as never);
      const pending = captured(
        action === 'submit'
          ? service.submitPurchaseOrder(po.id, maker)
          : action === 'approve'
            ? service.approvePurchaseOrder(po.id, admin)
            : service.receivePurchaseOrder(
                po.id,
                {
                  idempotencyKey: key(),
                  lines: [{ lineId: po.lines[0].id, quantity: 2 }],
                },
                maker,
              ),
      );
      await read;
      try {
        await ops.cancelPurchaseOrder(po.id, { reason: '撤销采购计划' }, admin);
      } finally {
        resume();
      }
      expect((await pending).error).toMatchObject({ status: 409 });
      expect(
        await db.purchaseOrder.findUnique({ where: { id: po.id } }),
      ).toMatchObject({ status: 'CANCELLED' });
      expect(
        await db.inventoryItem.findUnique({ where: { id: f.item.id } }),
      ).toMatchObject({ stock: 20 });
      expect(
        await db.purchaseReceipt.count({ where: { purchaseOrderId: po.id } }),
      ).toBe(0);
    },
    15000,
  );

  async function transfer(f: Awaited<ReturnType<typeof inventory>>) {
    const op = await ops.createOperation(
      {
        type: 'TRANSFER',
        itemId: f.item.id,
        quantity: 3,
        sourceLocationId: f.other.id,
        targetLocationId: f.main.id,
        batchCode: 'DEFAULT',
        reason: '正常补货调拨',
      },
      maker,
    );
    await ops.submitOperation(op.id, maker);
    await ops.approveOperation(op.id, admin);
    return op;
  }
  it.each([true, false])(
    'transfer cancellation and posting cannot both commit, cancel-first=%s',
    async (cancelFirst) => {
      const f = await inventory(),
        op = await transfer(f);
      let reached!: () => void, resume!: () => void;
      const read = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      let paused = false;
      const instrumented = db.$extends({
        query: {
          inventoryOperation: {
            async findUnique({ args, query }) {
              const row = await query(args);
              if (!paused && args.where.id === op.id) {
                paused = true;
                reached();
                await gate;
              }
              return row;
            },
          },
        },
      });
      const service = new InventoryOperationsService(instrumented as never);
      const posting = { idempotencyKey: key() },
        cancelling = { reason: '调拨计划取消' };
      const pending = captured(
        cancelFirst
          ? service.postOperation(op.id, posting, maker)
          : service.cancelOperation(op.id, cancelling, admin),
      );
      await read;
      try {
        if (cancelFirst) await ops.cancelOperation(op.id, cancelling, admin);
        else await ops.postOperation(op.id, posting, maker);
      } finally {
        resume();
      }
      expect((await pending).error).toMatchObject({ status: 409 });
      expect(
        await db.inventoryOperation.findUnique({ where: { id: op.id } }),
      ).toMatchObject({ status: cancelFirst ? 'CANCELLED' : 'POSTED' });
      expect(
        await db.inventoryTransaction.count({ where: { itemId: f.item.id } }),
      ).toBe(cancelFirst ? 0 : 2);
    },
    15000,
  );

  it('receipt and transfer retries do not duplicate inventory movements', async () => {
    const f = await inventory(),
      po = await purchase(f);
    const dto = {
      idempotencyKey: key(),
      lines: [{ lineId: po.lines[0].id, quantity: 2 }],
    };
    await ops.receivePurchaseOrder(po.id, dto, maker);
    await ops.receivePurchaseOrder(po.id, dto, maker);
    const op = await transfer(f),
      post = { idempotencyKey: key() };
    await ops.postOperation(op.id, post, maker);
    await ops.postOperation(op.id, post, maker);
    expect(
      await db.inventoryItem.findUnique({ where: { id: f.item.id } }),
    ).toMatchObject({ stock: 22 });
    expect(
      await db.inventoryTransaction.count({ where: { itemId: f.item.id } }),
    ).toBe(3);
  });

  it('still rejects a genuine stock ledger discrepancy before either transfer leg', async () => {
    const f = await inventory(),
      op = await transfer(f);
    await db.inventoryItem.update({
      where: { id: f.item.id },
      data: { stock: 21 },
    });
    await expect(
      ops.postOperation(op.id, { idempotencyKey: key() }, maker),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await db.inventoryStockBalance.findMany({
        where: { itemId: f.item.id },
        select: { quantity: true },
      }),
    ).toEqual([{ quantity: 10 }, { quantity: 10 }]);
    expect(
      await db.inventoryTransaction.count({ where: { itemId: f.item.id } }),
    ).toBe(0);
  });

  it.each(['other-cashier', 'next-day', 'account-refund'] as const)(
    'cash refund attribution handles %s',
    async (scenario) => {
      const f = await inventory(),
        buyer = await person(),
        cashier = await person('ADMIN');
      const payer =
        scenario === 'other-cashier' ? await person('ADMIN') : cashier;
      const shifts = new FrontDeskShiftsService(db);
      const orders = new OrdersService(
        db,
        new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
        createOrderFinalizerService(new ConsignmentSettlementService(db)),
        {} as never,
      );
      if (scenario === 'account-refund')
        await db.account.create({
          data: { userId: buyer.sub, type: 'CASH_PRINCIPAL', balance: 10000 },
        });
      const first = await shifts.open(
        { openingCashCents: scenario === 'account-refund' ? 10000 : 0 },
        cashier,
      );
      const order = await new GoodsService(db).createOrder(
        {
          items: [{ itemId: f.item.id, quantity: 1 }],
          creationIdempotencyKey: key(),
        },
        buyer,
      );
      await orders.pay(
        order.id,
        {
          channel:
            scenario === 'account-refund' ? 'CASH_PRINCIPAL' : 'OFFLINE_CASH',
          idempotencyKey: key(),
        },
        scenario === 'account-refund' ? buyer : cashier,
      );
      let closing = first;
      try {
        if (scenario === 'next-day') {
          await shifts.close(
            first.id,
            { closingCashCents: 10000, handoverNote: '当日现金收款交接' },
            cashier,
          );
          vi.useFakeTimers({ toFake: ['Date'] });
          vi.setSystemTime(new Date(Date.now() + 86400000));
        }
        if (scenario !== 'account-refund')
          closing = await shifts.open({ openingCashCents: 10000 }, payer);
        const request = await orders.requestRefund(
          order.id,
          { amountCents: 10000, reason: '整单退货核对', idempotencyKey: key() },
          buyer,
        );
        await orders.approveRefund(
          request.id,
          { reason: '实际执行退款' },
          payer,
        );
        await orders.approveRefund(
          request.id,
          { reason: '实际执行退款' },
          payer,
        );
        const result = await shifts.close(
          closing.id,
          {
            closingCashCents: scenario === 'account-refund' ? 10000 : 0,
            handoverNote: '按实际现金出入核对',
          },
          payer,
        );
        expect(result.cashVarianceCents).toBe(0);
        if (scenario === 'other-cashier') {
          const original = await shifts.close(
            first.id,
            { closingCashCents: 10000, handoverNote: '收款班次现金未出款' },
            cashier,
          );
          expect(original.cashVarianceCents).toBe(0);
        }
        if (scenario === 'next-day') {
          expect(
            await db.frontDeskShift.findUnique({ where: { id: first.id } }),
          ).toMatchObject({ expectedCashCents: 10000, cashVarianceCents: 0 });
        }
        if (scenario !== 'account-refund') {
          const audit = await db.auditLog.findFirstOrThrow({
            where: { objectId: request.id, action: 'REFUND_APPROVED' },
          });
          expect(audit.newValue).toMatchObject({
            cashDisbursement: { operatorId: payer.sub, amountCents: 10000 },
          });
        }
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
