import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import {
  EXPORT_ROW_LIMIT,
  DatasetName,
  ExportRow,
  financeRows,
} from '../report-definitions.js';

export async function financeData(
  client: Prisma.TransactionClient,
  dataset: DatasetName,
): Promise<ExportRow[]> {
  let rows: ExportRow[];

  if (dataset === 'Orders') {
    rows = (await client.order.findMany({
      select: {
        id: true,
        orderNo: true,
        memberId: true,
        createdById: true,
        businessType: true,
        subjectAccount: true,
        paymentChannel: true,
        sourceChannel: true,
        status: true,
        title: true,
        listAmountCents: true,
        discountCents: true,
        payableCents: true,
        paidCents: true,
        refundedCents: true,
        externalOrderNo: true,
        consumedCouponCode: true,
        paidAt: true,
        completedAt: true,
        cancelledAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    })) as unknown as ExportRow[];
  } else if (dataset === 'OrderItems') {
    rows = (await client.orderItem.findMany({
      select: {
        id: true,
        orderId: true,
        itemType: true,
        itemId: true,
        name: true,
        quantity: true,
        unitPriceCents: true,
        amountCents: true,
      },
      orderBy: { id: 'asc' },
      take: EXPORT_ROW_LIMIT,
    })) as unknown as ExportRow[];
  } else if (dataset === 'Payments') {
    rows = (await client.payment.findMany({
      select: {
        id: true,
        paymentNo: true,
        orderId: true,
        userId: true,
        operatorId: true,
        channel: true,
        amountCents: true,
        status: true,
        providerTradeNo: true,
        paidAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    })) as unknown as ExportRow[];
  } else if (dataset === 'Refunds') {
    rows = (await client.refund.findMany({
      select: {
        id: true,
        refundNo: true,
        orderId: true,
        requestedById: true,
        approvedById: true,
        amountCents: true,
        reason: true,
        originalOrderStatus: true,
        status: true,
        providerRefundNo: true,
        requestedAt: true,
        approvedAt: true,
        completedAt: true,
      },
      orderBy: { requestedAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    })) as unknown as ExportRow[];
  } else if (dataset === 'Accounts') {
    rows = (await client.account.findMany({
      select: {
        id: true,
        userId: true,
        type: true,
        balance: true,
        frozenBalance: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ userId: 'asc' }, { type: 'asc' }],
      take: EXPORT_ROW_LIMIT,
    })) as unknown as ExportRow[];
  } else if (dataset === 'AccountTransactions') {
    rows = (await client.accountTransaction.findMany({
      select: {
        id: true,
        accountId: true,
        kind: true,
        amount: true,
        balanceBefore: true,
        balanceAfter: true,
        reasonCode: true,
        reason: true,
        orderId: true,
        operatorId: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    })) as unknown as ExportRow[];
  } else if (dataset === 'TrainingRevenue') {
    rows = (await client.trainingRevenueRecognition.findMany({
      select: {
        id: true,
        attendanceId: true,
        enrollmentId: true,
        settlementId: true,
        type: true,
        sequence: true,
        reversalOfId: true,
        effectiveRevenueCents: true,
        contractRateBps: true,
        venueContributionCents: true,
        venueFeeCents: true,
        trainingPayableVenueCents: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
    })) as unknown as ExportRow[];
  } else if (dataset === 'TrainingSettlements') {
    rows = (await client.trainingSettlement.findMany({
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        effectiveRevenueCents: true,
        contractRateBps: true,
        venueContributionCents: true,
        venueFeeCents: true,
        trainingPayableVenueCents: true,
        coachCostCents: true,
        assistantCostCents: true,
        materialCostCents: true,
        acquisitionCostCents: true,
        marketingCostCents: true,
        occupiedCourtHours: true,
        cashContributionMarginCents: true,
        status: true,
        confirmedById: true,
        confirmedAt: true,
        settledAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { periodEnd: 'desc' },
      take: EXPORT_ROW_LIMIT,
    })) as unknown as ExportRow[];
  } else if (dataset === 'AllianceSettlements') {
    rows = (await client.allianceSettlement.findMany({
      select: {
        id: true,
        merchantId: true,
        periodStart: true,
        periodEnd: true,
        issuedCount: true,
        claimedCount: true,
        redeemedCount: true,
        effectiveNewCustomers: true,
        attributedGmvCents: true,
        attributedGrossProfitCents: true,
        cooperationFeeCents: true,
        roi: true,
        status: true,
        confirmedAt: true,
        settledAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { periodEnd: 'desc' },
      take: EXPORT_ROW_LIMIT,
    })) as unknown as ExportRow[];
  } else if (dataset === 'ConsignmentPayableEntries') {
    rows = (await client.consignmentPayableEntry.findMany({
      select: {
        id: true,
        type: true,
        supplierId: true,
        itemId: true,
        orderId: true,
        orderItemId: true,
        refundId: true,
        reversalOfId: true,
        quantity: true,
        unitSalePriceCents: true,
        grossSaleCents: true,
        commissionCents: true,
        payableCents: true,
        occurredAt: true,
        createdAt: true,
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: EXPORT_ROW_LIMIT,
    })) as unknown as ExportRow[];
  } else if (dataset === 'ConsignmentSettlements') {
    rows = (await client.consignmentSettlement.findMany({
      select: {
        id: true,
        statementNo: true,
        supplierId: true,
        periodStart: true,
        periodEnd: true,
        version: true,
        status: true,
        entryCount: true,
        netQuantity: true,
        grossSaleCents: true,
        commissionCents: true,
        payableCents: true,
        creationReason: true,
        createdById: true,
        submittedById: true,
        confirmedById: true,
        settledById: true,
        voidedById: true,
        submittedAt: true,
        confirmedAt: true,
        settledAt: true,
        voidedAt: true,
        paymentReference: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ periodEnd: 'desc' }, { version: 'desc' }],
      take: EXPORT_ROW_LIMIT,
    })) as unknown as ExportRow[];
  } else if (dataset === 'ConsignmentSettlementLines') {
    rows = (await client.consignmentSettlementLine.findMany({
      select: {
        id: true,
        settlementId: true,
        payableEntryId: true,
        quantity: true,
        grossSaleCents: true,
        commissionCents: true,
        payableCents: true,
        releasedAt: true,
        createdAt: true,
      },
      orderBy: [{ settlementId: 'asc' }, { createdAt: 'asc' }],
      take: EXPORT_ROW_LIMIT,
    })) as unknown as ExportRow[];
  } else if (dataset === 'ConsignmentTransitions') {
    rows = (await client.consignmentSettlementTransition.findMany({
      select: {
        id: true,
        settlementId: true,
        action: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        actorId: true,
        createdAt: true,
      },
      orderBy: [{ settlementId: 'asc' }, { createdAt: 'asc' }],
      take: EXPORT_ROW_LIMIT,
    })) as unknown as ExportRow[];
  } else if (dataset === 'ReconciliationPeriods') {
    rows = (await client.reconciliationPeriod.findMany({
      select: {
        id: true,
        businessDate: true,
        status: true,
        totals: true,
        exceptionCount: true,
        closedById: true,
        closedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { businessDate: 'desc' },
      take: EXPORT_ROW_LIMIT,
    })) as unknown as ExportRow[];
  } else {
    throw new ForbiddenException('财务角色无权导出该数据集');
  }

  // Defense in depth for mocked/custom Prisma adapters that may ignore select.
  return financeRows(rows);
}
