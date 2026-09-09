import {
  getConsignmentPayableEntries,
  getConsignmentSettlements,
  getInventorySuppliers,
} from "./state";
import {
  type JsonRecord,
  type MockConsignmentRouteResult,
  text,
  requireSettlementRole,
  optionalPeriod,
} from "./consignment-settlement/command-policy.js";
import {
  payableView,
  settlementView,
} from "./consignment-settlement/queries.js";
import { createSettlement } from "./consignment-settlement/statement-creation.js";
import { transitionSettlement } from "./consignment-settlement/statement-workflow.js";

export function routeMockConsignmentSettlement(
  method: string,
  url: string,
  data: JsonRecord = {},
): MockConsignmentRouteResult {
  if (url === "/inventory/consignment/supplier-options" && method === "GET") {
    requireSettlementRole();
    return {
      handled: true,
      value: getInventorySuppliers()
        .filter(
          (supplier) =>
            supplier.type === "CONSIGNMENT" && supplier.enabled !== false,
        )
        .map((supplier) => ({
          id: supplier.id,
          code: supplier.code,
          name: supplier.name,
          type: supplier.type,
          enabled: supplier.enabled !== false,
          settlementCycle: text(supplier.settlementRule?.settlementCycle),
          commissionRateBps: Number(
            supplier.settlementRule?.commissionRateBps || 0,
          ),
        })),
    };
  }
  if (url === "/inventory/consignment/payables" && method === "GET") {
    requireSettlementRole();
    const period = optionalPeriod(data.periodStart, data.periodEnd);
    const settlements = getConsignmentSettlements();
    const filtered = getConsignmentPayableEntries()
      .filter(
        (entry) =>
          (!data.supplierId || entry.supplierId === text(data.supplierId)) &&
          (!data.type || entry.type === text(data.type)) &&
          (!period ||
            (entry.occurredAt >= period.periodStart &&
              entry.occurredAt < period.periodEnd)),
      )
      .sort(
        (left, right) =>
          String(right.occurredAt).localeCompare(String(left.occurredAt)) ||
          String(right.createdAt).localeCompare(String(left.createdAt)),
      );
    const page = Math.max(1, Number(data.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(data.pageSize) || 50));
    const start = (page - 1) * pageSize;
    return {
      handled: true,
      value: {
        items: filtered
          .slice(start, start + pageSize)
          .map((entry) => payableView(entry, settlements)),
        total: filtered.length,
        page,
        pageSize,
      },
    };
  }
  if (url === "/inventory/consignment/settlements" && method === "GET") {
    requireSettlementRole();
    const period = optionalPeriod(data.periodStart, data.periodEnd);
    const filtered = getConsignmentSettlements()
      .filter(
        (settlement) =>
          (!data.supplierId ||
            settlement.supplierId === text(data.supplierId)) &&
          (!data.status || settlement.status === text(data.status)) &&
          (!period ||
            (settlement.periodStart >= period.periodStart &&
              settlement.periodEnd <= period.periodEnd)),
      )
      .sort(
        (left, right) =>
          String(right.periodEnd).localeCompare(String(left.periodEnd)) ||
          Number(right.version) - Number(left.version),
      );
    const page = Math.max(1, Number(data.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(data.pageSize) || 30));
    const start = (page - 1) * pageSize;
    return {
      handled: true,
      value: {
        items: filtered
          .slice(start, start + pageSize)
          .map((settlement) => settlementView(settlement)),
        total: filtered.length,
        page,
        pageSize,
      },
    };
  }
  if (url === "/inventory/consignment/settlements" && method === "POST") {
    return { handled: true, value: createSettlement(data) };
  }
  const detailMatch = url.match(
    /^\/inventory\/consignment\/settlements\/([^/]+)$/,
  );
  if (detailMatch && method === "GET") {
    requireSettlementRole();
    const settlement = getConsignmentSettlements().find(
      (candidate) => candidate.id === detailMatch[1],
    );
    if (!settlement) throw new Error("寄售结算单不存在");
    return { handled: true, value: settlementView(settlement, true) };
  }
  const actionMatch = url.match(
    /^\/inventory\/consignment\/settlements\/([^/]+)\/(submit|confirm|dispute|return|settle|void)$/,
  );
  if (actionMatch && method === "POST") {
    return {
      handled: true,
      value: transitionSettlement(actionMatch[1], actionMatch[2], data),
    };
  }
  return { handled: false };
}
export type { MockConsignmentRouteResult } from "./consignment-settlement/command-policy.js";
export { buildMockGoodsOrderItemSnapshot } from "./consignment-settlement/sales-ledger.js";
export { recordMockConsignmentSale } from "./consignment-settlement/sales-ledger.js";
export { recordMockConsignmentRefund } from "./consignment-settlement/sales-ledger.js";
export { mockConsignmentSettlementWorkItems } from "./consignment-settlement/queries.js";
export { mockConsignmentReconciliationTotals } from "./consignment-settlement/queries.js";
