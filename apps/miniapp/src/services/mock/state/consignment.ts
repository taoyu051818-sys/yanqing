import { type JsonRecord, KEYS, read, write } from "./storage.js";

export const initialConsignmentPayableEntries = (): JsonRecord[] => {
  const occurredAt = `${new Date(Date.now() - 86_400_000)
    .toISOString()
    .slice(0, 10)}T04:00:00.000Z`;
  return [
    {
      id: "consignment-payable-mock-1",
      type: "SALE",
      supplierId: "supplier-consignment",
      supplier: {
        id: "supplier-consignment",
        code: "CONSIGN-01",
        name: "合作品牌寄售",
      },
      itemId: "goods-grip",
      item: {
        id: "goods-grip",
        sku: "GRIP-001",
        name: "专业吸汗手胶",
      },
      orderId: "order-consignment-seed",
      orderItemId: "order-item-consignment-seed",
      order: {
        id: "order-consignment-seed",
        orderNo: "GD-MOCK-CONSIGN-001",
        completedAt: occurredAt,
      },
      refundId: null,
      refund: null,
      reversalOfId: null,
      quantity: 2,
      unitSalePriceCents: 1_500,
      grossSaleCents: 3_000,
      commissionRateBps: 2_500,
      commissionCents: 750,
      payableCents: 2_250,
      ruleSnapshot: {
        supplierCode: "CONSIGN-01",
        supplierName: "合作品牌寄售",
        sku: "GRIP-001",
        itemName: "专业吸汗手胶",
        settlementCycle: "MONTHLY",
        commissionRateBps: 2_500,
        commissionMeaning: "VENUE_COMMISSION",
      },
      occurredAt,
      idempotencyKey: "CONSIGNMENT-SALE:order-item-consignment-seed",
      createdAt: occurredAt,
    },
  ];
};

export function getConsignmentPayableEntries(): JsonRecord[] {
  return read<JsonRecord[]>(
    KEYS.consignmentPayableEntries,
    initialConsignmentPayableEntries(),
  );
}

export function saveConsignmentPayableEntries(value: JsonRecord[]) {
  return write(KEYS.consignmentPayableEntries, value);
}

export function getConsignmentSettlements(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.consignmentSettlements, []);
}

export function saveConsignmentSettlements(value: JsonRecord[]) {
  return write(KEYS.consignmentSettlements, value);
}
