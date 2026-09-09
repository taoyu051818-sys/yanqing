import type { PrismaService } from '../../src/database/prisma.service.js';
import { MemberDirectoryService } from '../../src/members/directory/members-directory.service.js';
import { MemberLeadsService } from '../../src/members/leads/members-leads.service.js';
import { MemberLeadReportingService } from '../../src/members/lead-reporting/members-lead-reporting.service.js';
import { MemberAccountsService } from '../../src/members/accounts/members-accounts.service.js';
import { MemberReferralsService } from '../../src/members/referrals/members-referrals.service.js';
/** Test-only composition of domain services; never loaded in production. */
export class MembersService {
  private readonly domain0: MemberDirectoryService;
  private readonly domain1: MemberLeadsService;
  private readonly domain2: MemberLeadReportingService;
  private readonly domain3: MemberAccountsService;
  private readonly domain4: MemberReferralsService;
  constructor(prisma: PrismaService) {
    this.domain0 = new MemberDirectoryService(prisma);
    this.domain1 = new MemberLeadsService(prisma);
    this.domain2 = new MemberLeadReportingService(prisma);
    this.domain3 = new MemberAccountsService(prisma);
    this.domain4 = new MemberReferralsService(prisma);
  }
  list(...args: Parameters<MemberDirectoryService['list']>) {
    return this.domain0.list(...args);
  }
  profile(...args: Parameters<MemberDirectoryService['profile']>) {
    return this.domain0.profile(...args);
  }
  customer360(...args: Parameters<MemberDirectoryService['customer360']>) {
    return this.domain0.customer360(...args);
  }
  listLeads(...args: Parameters<MemberLeadsService['listLeads']>) {
    return this.domain1.listLeads(...args);
  }
  createLead(...args: Parameters<MemberLeadsService['createLead']>) {
    return this.domain1.createLead(...args);
  }
  claimLead(...args: Parameters<MemberLeadsService['claimLead']>) {
    return this.domain1.claimLead(...args);
  }
  assignLead(...args: Parameters<MemberLeadsService['assignLead']>) {
    return this.domain1.assignLead(...args);
  }
  addLeadFollowUp(...args: Parameters<MemberLeadsService['addLeadFollowUp']>) {
    return this.domain1.addLeadFollowUp(...args);
  }
  convertLead(...args: Parameters<MemberLeadsService['convertLead']>) {
    return this.domain1.convertLead(...args);
  }
  loseLead(...args: Parameters<MemberLeadsService['loseLead']>) {
    return this.domain1.loseLead(...args);
  }
  archiveLead(...args: Parameters<MemberLeadsService['archiveLead']>) {
    return this.domain1.archiveLead(...args);
  }
  leadOwners(...args: Parameters<MemberLeadsService['leadOwners']>) {
    return this.domain1.leadOwners(...args);
  }
  leadFunnel(...args: Parameters<MemberLeadReportingService['leadFunnel']>) {
    return this.domain2.leadFunnel(...args);
  }
  accountTransactions(
    ...args: Parameters<MemberAccountsService['accountTransactions']>
  ) {
    return this.domain3.accountTransactions(...args);
  }
  accountAdjustmentRequests(
    ...args: Parameters<MemberAccountsService['accountAdjustmentRequests']>
  ) {
    return this.domain3.accountAdjustmentRequests(...args);
  }
  adjustAccount(...args: Parameters<MemberAccountsService['adjustAccount']>) {
    return this.domain3.adjustAccount(...args);
  }
  approveAccountAdjustment(
    ...args: Parameters<MemberAccountsService['approveAccountAdjustment']>
  ) {
    return this.domain3.approveAccountAdjustment(...args);
  }
  rejectAccountAdjustment(
    ...args: Parameters<MemberAccountsService['rejectAccountAdjustment']>
  ) {
    return this.domain3.rejectAccountAdjustment(...args);
  }
  bindReferral(...args: Parameters<MemberReferralsService['bindReferral']>) {
    return this.domain4.bindReferral(...args);
  }
}
