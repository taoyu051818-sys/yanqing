import { MemberDirectoryService } from './directory/members-directory.service.js';
import { MemberLeadsService } from './leads/members-leads.service.js';
import { MemberLeadReportingService } from './lead-reporting/members-lead-reporting.service.js';
import { MemberAccountsService } from './accounts/members-accounts.service.js';
import { MemberReferralsService } from './referrals/members-referrals.service.js';
import { Module } from '@nestjs/common';

import { MembersController } from './members.controller.js';

@Module({
  controllers: [MembersController],
  providers: [
    MemberDirectoryService,
    MemberLeadsService,
    MemberLeadReportingService,
    MemberAccountsService,
    MemberReferralsService,
  ],
  exports: [
    MemberDirectoryService,
    MemberLeadsService,
    MemberLeadReportingService,
    MemberAccountsService,
    MemberReferralsService,
  ],
})
export class MembersModule {}
