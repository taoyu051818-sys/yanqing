import type { PrismaService } from '../../src/database/prisma.service.js';
import { ConsignmentLedgerService } from '../../src/inventory/consignment/ledger/consignment-settlement-ledger.service.js';
import { ConsignmentQueriesService } from '../../src/inventory/consignment/queries/consignment-settlement-queries.service.js';
import { ConsignmentStatementsService } from '../../src/inventory/consignment/statements/consignment-settlement-statements.service.js';
import { ConsignmentWorkflowService } from '../../src/inventory/consignment/workflow/consignment-settlement-workflow.service.js';
/** Test-only composition of domain services; never loaded in production. */
export class ConsignmentSettlementService {
  private readonly domain0: ConsignmentLedgerService;
  private readonly domain1: ConsignmentQueriesService;
  private readonly domain2: ConsignmentStatementsService;
  private readonly domain3: ConsignmentWorkflowService;
  constructor(prisma: PrismaService) {
    this.domain0 = new ConsignmentLedgerService();
    this.domain1 = new ConsignmentQueriesService(prisma);
    this.domain2 = new ConsignmentStatementsService(prisma);
    this.domain3 = new ConsignmentWorkflowService(prisma);
  }
  recordCompletedGoodsSale(
    ...args: Parameters<ConsignmentLedgerService['recordCompletedGoodsSale']>
  ) {
    return this.domain0.recordCompletedGoodsSale(...args);
  }
  recordSucceededGoodsRefund(
    ...args: Parameters<ConsignmentLedgerService['recordSucceededGoodsRefund']>
  ) {
    return this.domain0.recordSucceededGoodsRefund(...args);
  }
  supplierOptions(
    ...args: Parameters<ConsignmentQueriesService['supplierOptions']>
  ) {
    return this.domain1.supplierOptions(...args);
  }
  listPayables(...args: Parameters<ConsignmentQueriesService['listPayables']>) {
    return this.domain1.listPayables(...args);
  }
  listSettlements(
    ...args: Parameters<ConsignmentQueriesService['listSettlements']>
  ) {
    return this.domain1.listSettlements(...args);
  }
  detail(...args: Parameters<ConsignmentQueriesService['detail']>) {
    return this.domain1.detail(...args);
  }
  createSettlement(
    ...args: Parameters<ConsignmentStatementsService['createSettlement']>
  ) {
    return this.domain2.createSettlement(...args);
  }
  submitSettlement(
    ...args: Parameters<ConsignmentWorkflowService['submitSettlement']>
  ) {
    return this.domain3.submitSettlement(...args);
  }
  confirmSettlement(
    ...args: Parameters<ConsignmentWorkflowService['confirmSettlement']>
  ) {
    return this.domain3.confirmSettlement(...args);
  }
  disputeSettlement(
    ...args: Parameters<ConsignmentWorkflowService['disputeSettlement']>
  ) {
    return this.domain3.disputeSettlement(...args);
  }
  returnSettlement(
    ...args: Parameters<ConsignmentWorkflowService['returnSettlement']>
  ) {
    return this.domain3.returnSettlement(...args);
  }
  settleSettlement(
    ...args: Parameters<ConsignmentWorkflowService['settleSettlement']>
  ) {
    return this.domain3.settleSettlement(...args);
  }
  voidSettlement(
    ...args: Parameters<ConsignmentWorkflowService['voidSettlement']>
  ) {
    return this.domain3.voidSettlement(...args);
  }
}
