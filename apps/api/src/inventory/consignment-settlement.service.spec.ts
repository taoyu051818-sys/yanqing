import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AppRole,
  BusinessType,
  ConsignmentPayableEntryType,
  ConsignmentSettlementAction,
  InventoryMode,
  InventoryTxnType,
  OrderStatus,
  RefundStatus,
  SettlementStatus,
  SupplierType,
} from '../generated/prisma/client.js';
import { ConsignmentSettlementService } from './consignment-settlement.service.js';

const admin: AuthUser = {
  sub: 'admin-1',
  displayName: '管理员',
  roles: [AppRole.ADMIN],
};
const finance: AuthUser = {
  sub: 'finance-1',
  displayName: '财务复核',
  roles: [AppRole.FINANCE],
};
const member: AuthUser = {
  sub: 'member-1',
  displayName: '会员',
  roles: [AppRole.MEMBER],
};
const completedAt = new Date('2026-08-30T08:00:00.000Z');
const consignmentOrderSnapshot = {
  inventorySnapshotVersion: 1,
  sku: 'GRIP-1',
  mode: InventoryMode.CONSIGNMENT,
  supplier: '品牌寄售',
  supplierId: 'supplier-consign',
  supplierCode: 'CONSIGN-1',
  supplierName: '品牌寄售',
  settlementRule: {
    settlementCycle: 'MONTHLY',
    commissionRateBps: 2_500,
  },
};

const transactionRunner = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (client: Record<string, unknown>) => unknown) => work(tx));

describe('consignment payable ledger hooks', () => {
  it('uses the immutable order snapshot after the SKU mode and supplier rule change', async () => {
    const order = {
      id: 'order-1',
      orderNo: 'GD20260830001',
      businessType: BusinessType.GOODS,
      status: OrderStatus.COMPLETED,
      completedAt,
      items: [
        {
          id: 'line-consign',
          itemId: 'item-consign',
          name: '寄售手胶',
          quantity: 2,
          unitPriceCents: 1_500,
          amountCents: 3_000,
          metadata: consignmentOrderSnapshot,
          inventoryTransactions: [
            { type: InventoryTxnType.SALE_OUT, quantity: -2 },
          ],
        },
        {
          id: 'line-owned',
          itemId: 'item-owned',
          name: '自营球',
          quantity: 1,
          unitPriceCents: 8_800,
          amountCents: 8_800,
          metadata: {
            inventorySnapshotVersion: 1,
            sku: 'BALL-1',
            mode: InventoryMode.PURCHASE,
            supplier: '自营采购',
            supplierId: 'supplier-owned',
            supplierCode: 'OWNED-1',
            supplierName: '自营采购',
          },
          inventoryTransactions: [
            { type: InventoryTxnType.SALE_OUT, quantity: -1 },
          ],
        },
      ],
    };
    const supplier = {
      id: 'supplier-consign',
      code: 'CONSIGN-1',
      name: '品牌寄售',
      type: SupplierType.CONSIGNMENT,
      settlementRule: {
        settlementCycle: 'MONTHLY',
        commissionRateBps: 2_500,
      },
    };
    const create = vi.fn(async ({ data }) => ({ id: 'payable-1', ...data }));
    const tx = {
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      inventoryItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'item-consign',
            sku: 'GRIP-1',
            name: '寄售手胶',
            mode: InventoryMode.PURCHASE,
            supplierRecord: {
              id: 'supplier-new',
              code: 'NEW-1',
              name: '新供应商',
              type: SupplierType.CONSIGNMENT,
              settlementRule: {
                settlementCycle: 'WEEKLY',
                commissionRateBps: 8_000,
              },
            },
          },
          {
            id: 'item-owned',
            sku: 'BALL-1',
            name: '自营球',
            mode: InventoryMode.PURCHASE,
            supplierRecord: {
              id: 'supplier-owned',
              type: SupplierType.OWNED,
            },
          },
        ]),
      },
      consignmentPayableEntry: {
        findUnique: vi.fn().mockResolvedValue(null),
        create,
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new ConsignmentSettlementService({} as never);

    const entries = await service.recordCompletedGoodsSale(
      tx as never,
      order.id,
      admin.sub,
      AppRole.ADMIN,
    );

    expect(entries).toHaveLength(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: ConsignmentPayableEntryType.SALE,
        supplierId: supplier.id,
        orderItemId: 'line-consign',
        quantity: 2,
        grossSaleCents: 3_000,
        commissionRateBps: 2_500,
        commissionCents: 750,
        payableCents: 2_250,
        occurredAt: completedAt,
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    expect(tx.inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it('rejects payable creation before the consignment line has a matching SALE_OUT', async () => {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'order-1',
          orderNo: 'GD1',
          businessType: BusinessType.GOODS,
          completedAt,
          items: [
            {
              id: 'line-1',
              itemId: 'item-1',
              name: '寄售手胶',
              quantity: 1,
              unitPriceCents: 1_500,
              amountCents: 1_500,
              metadata: consignmentOrderSnapshot,
              inventoryTransactions: [],
            },
          ],
        }),
      },
      inventoryItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'item-1',
            mode: InventoryMode.CONSIGNMENT,
            supplierRecord: {
              id: 'supplier-1',
              type: SupplierType.CONSIGNMENT,
              settlementRule: {
                settlementCycle: 'MONTHLY',
                commissionRateBps: 2_500,
              },
            },
          },
        ]),
      },
      consignmentPayableEntry: { findUnique: vi.fn(), create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const service = new ConsignmentSettlementService({} as never);

    await expect(
      service.recordCompletedGoodsSale(
        tx as never,
        'order-1',
        admin.sub,
        AppRole.ADMIN,
      ),
    ).rejects.toThrow('尚未完成销售出库');
    expect(tx.consignmentPayableEntry.create).not.toHaveBeenCalled();
    expect(tx.inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it('fails closed for a cutover-era consignment order without a rule snapshot', async () => {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'legacy-order',
          orderNo: 'GD-LEGACY',
          businessType: BusinessType.GOODS,
          completedAt,
          items: [
            {
              id: 'legacy-line',
              itemId: 'item-consign',
              name: '历史寄售手胶',
              quantity: 1,
              unitPriceCents: 1_500,
              amountCents: 1_500,
              metadata: {
                sku: 'GRIP-1',
                mode: InventoryMode.CONSIGNMENT,
                supplier: '历史供应商名称',
              },
              inventoryTransactions: [
                { type: InventoryTxnType.SALE_OUT, quantity: -1 },
              ],
            },
          ],
        }),
      },
      consignmentPayableEntry: { findUnique: vi.fn(), create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const service = new ConsignmentSettlementService({} as never);

    await expect(
      service.recordCompletedGoodsSale(
        tx as never,
        'legacy-order',
        admin.sub,
        AppRole.ADMIN,
      ),
    ).rejects.toThrow('cutover前交易');
    expect(tx.consignmentPayableEntry.create).not.toHaveBeenCalled();
  });

  it('appends an exact negative reversal only after a whole goods refund succeeds', async () => {
    const sale = {
      id: 'sale-entry-1',
      type: ConsignmentPayableEntryType.SALE,
      supplierId: 'supplier-1',
      itemId: 'item-1',
      orderId: 'order-1',
      orderItemId: 'line-1',
      quantity: 2,
      unitSalePriceCents: 1_500,
      grossSaleCents: 3_000,
      commissionRateBps: 2_500,
      commissionCents: 750,
      payableCents: 2_250,
      ruleSnapshot: { settlementCycle: 'MONTHLY' },
      reversedBy: null,
    };
    const create = vi.fn(async ({ data }) => ({ id: 'reversal-1', ...data }));
    const tx = {
      refund: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'refund-1',
          refundNo: 'RF1',
          reason: '整单退货',
          status: RefundStatus.SUCCEEDED,
          completedAt,
          orderId: 'order-1',
          order: {
            businessType: BusinessType.GOODS,
            paidCents: 3_000,
            refundedCents: 3_000,
          },
        }),
      },
      consignmentPayableEntry: {
        findMany: vi.fn().mockResolvedValue([sale]),
        create,
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new ConsignmentSettlementService({} as never);

    const reversals = await service.recordSucceededGoodsRefund(
      tx as never,
      'refund-1',
      finance.sub,
      AppRole.FINANCE,
    );

    expect(reversals).toHaveLength(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: ConsignmentPayableEntryType.REFUND_REVERSAL,
        reversalOfId: sale.id,
        refundId: 'refund-1',
        quantity: -2,
        grossSaleCents: -3_000,
        commissionCents: -750,
        payableCents: -2_250,
      }),
    });
  });
});

describe('consignment settlement creation and workflow', () => {
  it('aggregates locked source-day entries into an immutable draft and safely replays the create command', async () => {
    const entries = [
      {
        id: 'entry-sale',
        quantity: 2,
        grossSaleCents: 3_000,
        commissionCents: 750,
        payableCents: 2_250,
      },
      {
        id: 'entry-refund',
        quantity: -1,
        grossSaleCents: -1_500,
        commissionCents: -375,
        payableCents: -1_125,
      },
    ];
    let created: Record<string, unknown> | null = null;
    const tx = {
      reconciliationPeriod: {
        findFirst: vi.fn().mockResolvedValue({
          businessDate: new Date('2026-08-15T16:00:00.000Z'),
        }),
      },
      supplier: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'supplier-1',
          code: 'CONSIGN-1',
          name: '寄售伙伴',
          type: SupplierType.CONSIGNMENT,
          settlementRule: {
            settlementCycle: 'MONTHLY',
            commissionRateBps: 2_500,
          },
        }),
      },
      consignmentPayableEntry: { findMany: vi.fn().mockResolvedValue(entries) },
      consignmentSettlement: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }) => {
          created = {
            id: 'settlement-1',
            statementNo: data.statementNo,
            ...data,
          };
          return created;
        }),
        findUnique: vi.fn(async () => created),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const topLevelFind = vi.fn(async () => created);
    const prisma = {
      consignmentSettlement: { findUnique: topLevelFind },
      $transaction: transactionRunner(tx),
    };
    const service = new ConsignmentSettlementService(prisma as never);
    const command = {
      supplierId: 'supplier-1',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-09-01T00:00:00.000Z',
      reason: '生成八月寄售账单',
      idempotencyKey: 'consignment-create-august-1',
    };

    const first = await service.createSettlement(command, admin);
    expect(first).toMatchObject({
      entryCount: 2,
      netQuantity: 1,
      grossSaleCents: 1_500,
      commissionCents: 375,
      payableCents: 1_125,
      status: SettlementStatus.DRAFT,
    });
    expect(tx.consignmentSettlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        creationIdempotencyKey: command.idempotencyKey,
        createdById: admin.sub,
        lines: {
          create: [
            expect.objectContaining({ payableEntryId: 'entry-sale' }),
            expect.objectContaining({ payableEntryId: 'entry-refund' }),
          ],
        },
      }),
    });
    expect(tx.reconciliationPeriod.findFirst).not.toHaveBeenCalled();

    await expect(service.createSettlement(command, admin)).resolves.toEqual(
      first,
    );
    expect(tx.consignmentSettlement.create).toHaveBeenCalledOnce();
    await expect(service.createSettlement(command, finance)).rejects.toThrow(
      '其他操作人或命令',
    );
  });

  it('enforces maker-checker, exact transition idempotency and the full return/settle lifecycle', async () => {
    const current: Record<string, unknown> = {
      id: 'settlement-1',
      supplierId: 'supplier-1',
      status: SettlementStatus.DRAFT,
      createdById: admin.sub,
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
      entryCount: 1,
      netQuantity: 2,
      grossSaleCents: 3_000,
      commissionCents: 750,
      payableCents: 2_250,
    };
    const transitions = new Map<string, Record<string, unknown>>();
    const tx = {
      reconciliationPeriod: {
        findFirst: vi.fn().mockResolvedValue({
          businessDate: new Date('2026-08-15T16:00:00.000Z'),
        }),
      },
      consignmentSettlement: {
        findUnique: vi.fn().mockImplementation(async () => current),
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
          if (current.status !== where.status) return { count: 0 };
          Object.assign(current, data);
          return { count: 1 };
        }),
      },
      consignmentSettlementTransition: {
        findUnique: vi
          .fn()
          .mockImplementation(
            async ({ where }) => transitions.get(where.idempotencyKey) ?? null,
          ),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const transition = {
            id: `transition-${transitions.size + 1}`,
            ...data,
          };
          transitions.set(data.idempotencyKey, transition);
          return transition;
        }),
      },
      consignmentSettlementLine: {
        aggregate: vi.fn().mockResolvedValue({
          _count: { _all: 1 },
          _sum: {
            quantity: 2,
            grossSaleCents: 3_000,
            commissionCents: 750,
            payableCents: 2_250,
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      consignmentPayableEntry: { count: vi.fn().mockResolvedValue(0) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      consignmentSettlementTransition: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: transactionRunner(tx),
    };
    const service = new ConsignmentSettlementService(prisma as never);
    const action = (key: string, reason: string) => ({
      idempotencyKey: key,
      reason,
    });

    const submit = action('consignment-submit-1', '提交供应商确认');
    await service.submitSettlement('settlement-1', submit, admin);
    expect(current.status).toBe(SettlementStatus.PENDING_CONFIRMATION);
    await service.submitSettlement('settlement-1', submit, admin);
    expect(tx.consignmentSettlement.updateMany).toHaveBeenCalledTimes(1);

    await expect(
      service.confirmSettlement(
        'settlement-1',
        action('consignment-confirm-maker', '制单人尝试确认'),
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await service.confirmSettlement(
      'settlement-1',
      action('consignment-confirm-1', '供应商账单复核一致'),
      finance,
    );
    expect(current.status).toBe(SettlementStatus.CONFIRMED);

    await service.returnSettlement(
      'settlement-1',
      action('consignment-return-1', '付款资料不完整退回'),
      finance,
    );
    expect(current).toMatchObject({
      status: SettlementStatus.DRAFT,
      submittedById: null,
      confirmedById: null,
    });

    await service.submitSettlement(
      'settlement-1',
      action('consignment-submit-2', '补齐资料重新提交'),
      admin,
    );
    await service.confirmSettlement(
      'settlement-1',
      action('consignment-confirm-2', '复核确认无误'),
      finance,
    );
    await service.settleSettlement(
      'settlement-1',
      {
        ...action('consignment-settle-1', '银行付款完成'),
        paymentReference: 'BANK-20260830-001',
      },
      finance,
    );
    expect(current).toMatchObject({
      status: SettlementStatus.SETTLED,
      settledById: finance.sub,
      paymentReference: 'BANK-20260830-001',
    });
    expect(transitions.get('consignment-settle-1')).toMatchObject({
      action: ConsignmentSettlementAction.SETTLED,
      fromStatus: SettlementStatus.CONFIRMED,
      toStatus: SettlementStatus.SETTLED,
    });
    expect(tx.reconciliationPeriod.findFirst).not.toHaveBeenCalled();
  });

  it('blocks members at the service boundary before starting a transaction', async () => {
    const transaction = vi.fn();
    const service = new ConsignmentSettlementService({
      consignmentSettlement: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: transaction,
    } as never);
    const command = {
      supplierId: 'supplier-1',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-09-01T00:00:00.000Z',
      reason: '生成八月寄售账单',
      idempotencyKey: 'consignment-create-locked-1',
    };

    await expect(
      service.createSettlement(command, member),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
