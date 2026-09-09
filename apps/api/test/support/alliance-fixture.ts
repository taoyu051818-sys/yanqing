import type { PrismaService } from '../../src/database/prisma.service.js';
import { AllianceMerchantsService } from '../../src/alliance/merchants/alliance-merchants.service.js';
import { AllianceTemplatesService } from '../../src/alliance/templates/alliance-templates.service.js';
import { AllianceCouponsService } from '../../src/alliance/coupons/alliance-coupons.service.js';
import { AllianceSettlementsService } from '../../src/alliance/settlements/alliance-settlements.service.js';
/** Test-only composition of domain services; never loaded in production. */
export class AllianceService {
  private readonly domain0: AllianceMerchantsService;
  private readonly domain1: AllianceTemplatesService;
  private readonly domain2: AllianceCouponsService;
  private readonly domain3: AllianceSettlementsService;
  constructor(prisma: PrismaService) {
    this.domain0 = new AllianceMerchantsService(prisma);
    this.domain1 = new AllianceTemplatesService(prisma);
    this.domain2 = new AllianceCouponsService(prisma);
    this.domain3 = new AllianceSettlementsService(prisma);
  }
  listMerchants(
    ...args: Parameters<AllianceMerchantsService['listMerchants']>
  ) {
    return this.domain0.listMerchants(...args);
  }
  createMerchant(
    ...args: Parameters<AllianceMerchantsService['createMerchant']>
  ) {
    return this.domain0.createMerchant(...args);
  }
  setMerchantStatus(
    ...args: Parameters<AllianceMerchantsService['setMerchantStatus']>
  ) {
    return this.domain0.setMerchantStatus(...args);
  }
  listTemplates(
    ...args: Parameters<AllianceTemplatesService['listTemplates']>
  ) {
    return this.domain1.listTemplates(...args);
  }
  createTemplate(
    ...args: Parameters<AllianceTemplatesService['createTemplate']>
  ) {
    return this.domain1.createTemplate(...args);
  }
  setTemplateStatus(
    ...args: Parameters<AllianceTemplatesService['setTemplateStatus']>
  ) {
    return this.domain1.setTemplateStatus(...args);
  }
  listMyCoupons(...args: Parameters<AllianceCouponsService['listMyCoupons']>) {
    return this.domain2.listMyCoupons(...args);
  }
  generateCodes(...args: Parameters<AllianceCouponsService['generateCodes']>) {
    return this.domain2.generateCodes(...args);
  }
  claim(...args: Parameters<AllianceCouponsService['claim']>) {
    return this.domain2.claim(...args);
  }
  redeem(...args: Parameters<AllianceCouponsService['redeem']>) {
    return this.domain2.redeem(...args);
  }
  qr(...args: Parameters<AllianceCouponsService['qr']>) {
    return this.domain2.qr(...args);
  }
  createSettlement(
    ...args: Parameters<AllianceSettlementsService['createSettlement']>
  ) {
    return this.domain3.createSettlement(...args);
  }
  listSettlements(
    ...args: Parameters<AllianceSettlementsService['listSettlements']>
  ) {
    return this.domain3.listSettlements(...args);
  }
  submitSettlement(
    ...args: Parameters<AllianceSettlementsService['submitSettlement']>
  ) {
    return this.domain3.submitSettlement(...args);
  }
  confirmSettlement(
    ...args: Parameters<AllianceSettlementsService['confirmSettlement']>
  ) {
    return this.domain3.confirmSettlement(...args);
  }
  disputeSettlement(
    ...args: Parameters<AllianceSettlementsService['disputeSettlement']>
  ) {
    return this.domain3.disputeSettlement(...args);
  }
  settleSettlement(
    ...args: Parameters<AllianceSettlementsService['settleSettlement']>
  ) {
    return this.domain3.settleSettlement(...args);
  }
}
