import { BusinessType } from '../../generated/prisma/enums.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  EXPORT_ROW_LIMIT,
  ExportScope,
  DatasetName,
  ExportRow,
} from '../report-definitions.js';
import { financeData } from './finance-data.js';

export async function data(
  client: Prisma.TransactionClient,
  dataset: DatasetName,
  scope: ExportScope,
  isAdministrator: boolean,
): Promise<ExportRow[]> {
  if (!isAdministrator) return financeData(client, dataset);

  const scopedBusinessType =
    scope === 'training'
      ? BusinessType.TRAINING
      : scope === 'events'
        ? BusinessType.EVENT
        : scope === 'inventory'
          ? BusinessType.GOODS
          : undefined;
  if (dataset === 'Orders') {
    return client.order.findMany({
      where: scopedBusinessType
        ? { businessType: scopedBusinessType }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'OrderItems') {
    return client.orderItem.findMany({
      where: scopedBusinessType
        ? { order: { businessType: scopedBusinessType } }
        : undefined,
      orderBy: { id: 'asc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'Payments') {
    return client.payment.findMany({
      where: scopedBusinessType
        ? { order: { businessType: scopedBusinessType } }
        : undefined,
      select: {
        id: true,
        paymentNo: true,
        orderId: true,
        userId: true,
        channel: true,
        amountCents: true,
        status: true,
        providerTradeNo: true,
        idempotencyKey: true,
        paidAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'Refunds') {
    return client.refund.findMany({
      where: scopedBusinessType
        ? { order: { businessType: scopedBusinessType } }
        : undefined,
      orderBy: { requestedAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'Members') {
    return client.user.findMany({
      where: { memberProfile: { isNot: null } },
      select: {
        id: true,
        displayName: true,
        phone: true,
        primaryRole: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'Accounts') {
    return client.account.findMany({
      orderBy: [{ userId: 'asc' }, { type: 'asc' }],
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'AccountTransactions') {
    return client.accountTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'Students') {
    return client.student.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'TrainingProducts') {
    return client.trainingProduct.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'TrainingClasses') {
    return client.trainingClass.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'TrainingEnrollments') {
    return client.trainingEnrollment.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'TrainingSessions') {
    return client.trainingSession.findMany({
      orderBy: { startsAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'TrainingAttendances') {
    return client.trainingAttendance.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'TrainingRevenue') {
    return client.trainingRevenueRecognition.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'TrainingConsumeCorrections') {
    return client.trainingConsumeCorrection.findMany({
      orderBy: { requestedAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'TrainingSettlements') {
    return client.trainingSettlement.findMany({
      orderBy: { periodEnd: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'Events') {
    return client.event.findMany({
      orderBy: { startsAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'EventTeams') {
    return client.eventTeam.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'EventMatches') {
    return client.eventMatch.findMany({
      orderBy: [{ eventId: 'asc' }, { round: 'asc' }, { createdAt: 'asc' }],
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'EventPrizeAwards') {
    return client.eventPrizeAward.findMany({
      orderBy: { issuedAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'Merchants') {
    return client.merchant.findMany({
      orderBy: { code: 'asc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'CouponTemplates') {
    return client.couponTemplate.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'CouponCodes') {
    return client.couponCode.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'AllianceSettlements') {
    return client.allianceSettlement.findMany({
      orderBy: { periodEnd: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'Suppliers') {
    return client.supplier.findMany({
      orderBy: { code: 'asc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'ConsignmentPayableEntries') {
    return client.consignmentPayableEntry.findMany({
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'ConsignmentSettlements') {
    return client.consignmentSettlement.findMany({
      orderBy: [{ periodEnd: 'desc' }, { version: 'desc' }],
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'ConsignmentSettlementLines') {
    return client.consignmentSettlementLine.findMany({
      orderBy: [{ settlementId: 'asc' }, { createdAt: 'asc' }],
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'ConsignmentTransitions') {
    return client.consignmentSettlementTransition.findMany({
      orderBy: [{ settlementId: 'asc' }, { createdAt: 'asc' }],
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'InventoryLocations') {
    return client.inventoryLocation.findMany({
      orderBy: { code: 'asc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'InventoryItems') {
    return client.inventoryItem.findMany({
      orderBy: { sku: 'asc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'InventoryStockBalances') {
    return client.inventoryStockBalance.findMany({
      orderBy: [{ itemId: 'asc' }, { locationId: 'asc' }, { batchCode: 'asc' }],
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'InventoryTransactions') {
    return client.inventoryTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'PurchaseOrders') {
    return client.purchaseOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'PurchaseOrderLines') {
    return client.purchaseOrderLine.findMany({
      orderBy: { id: 'asc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'PurchaseReceipts') {
    return client.purchaseReceipt.findMany({
      orderBy: { receivedAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'PurchaseReceiptLines') {
    return client.purchaseReceiptLine.findMany({
      orderBy: { id: 'asc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'Stocktakes') {
    return client.stocktake.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'StocktakeLines') {
    return client.stocktakeLine.findMany({
      orderBy: { id: 'asc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'InventoryOperations') {
    return client.inventoryOperation.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  if (dataset === 'AuditLogs') {
    return client.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
  return client.reconciliationPeriod.findMany({
    orderBy: { businessDate: 'desc' },
    take: EXPORT_ROW_LIMIT,
  }) as never;
}
