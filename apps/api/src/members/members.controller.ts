import { Inject } from '@nestjs/common';
import { MemberDirectoryService } from './directory/members-directory.service.js';
import { MemberLeadsService } from './leads/members-leads.service.js';
import { MemberLeadReportingService } from './lead-reporting/members-lead-reporting.service.js';
import { MemberAccountsService } from './accounts/members-accounts.service.js';
import { MemberReferralsService } from './referrals/members-referrals.service.js';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import {
  AddLeadFollowUpDto,
  AccountAdjustmentQueryDto,
  AdjustAccountDto,
  ArchiveLeadDto,
  AssignLeadDto,
  BindReferralDto,
  ConvertLeadDto,
  CreateLeadDto,
  LeadFunnelQueryDto,
  LeadQueryDto,
  LeadOwnerQueryDto,
  LoseLeadDto,
  MemberQueryDto,
  ReviewAccountAdjustmentDto,
} from './members.dto.js';

@ApiTags('会员与账户')
@ApiBearerAuth()
@Controller('members')
export class MembersController {
  constructor(
    @Inject(MemberDirectoryService)
    private readonly membersMemberDirectory: MemberDirectoryService,
    @Inject(MemberLeadsService)
    private readonly membersMemberLeads: MemberLeadsService,
    @Inject(MemberLeadReportingService)
    private readonly membersMemberLeadReporting: MemberLeadReportingService,
    @Inject(MemberAccountsService)
    private readonly membersMemberAccounts: MemberAccountsService,
    @Inject(MemberReferralsService)
    private readonly membersMemberReferrals: MemberReferralsService,
  ) {}

  @Get()
  @Roles(
    AppRole.FRONT_DESK,
    AppRole.COACH,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  list(@Query() query: MemberQueryDto, @CurrentUser() actor: AuthUser) {
    return this.membersMemberDirectory.list(query, actor);
  }

  @Get('me/accounts/transactions')
  myTransactions(@CurrentUser() actor: AuthUser) {
    return this.membersMemberAccounts.accountTransactions(actor.sub);
  }

  @Get('leads')
  @Roles(AppRole.FRONT_DESK, AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  leads(@Query() query: LeadQueryDto, @CurrentUser() actor: AuthUser) {
    return this.membersMemberLeads.listLeads(query, actor);
  }

  @Get('leads/owners')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  leadOwners(
    @Query() query: LeadOwnerQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membersMemberLeads.leadOwners(query, actor);
  }

  @Get('leads/funnel')
  @Roles(
    AppRole.FRONT_DESK,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  leadFunnel(@Query() query: LeadFunnelQueryDto) {
    return this.membersMemberLeadReporting.leadFunnel(query);
  }

  @Get('account-adjustments')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  accountAdjustments(
    @Query() query: AccountAdjustmentQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membersMemberAccounts.accountAdjustmentRequests(query, actor);
  }

  @Post('account-adjustments/:requestId/approve')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  approveAccountAdjustment(
    @Param('requestId') requestId: string,
    @Body() dto: ReviewAccountAdjustmentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membersMemberAccounts.approveAccountAdjustment(
      requestId,
      dto,
      actor,
    );
  }

  @Post('account-adjustments/:requestId/reject')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  rejectAccountAdjustment(
    @Param('requestId') requestId: string,
    @Body() dto: ReviewAccountAdjustmentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membersMemberAccounts.rejectAccountAdjustment(
      requestId,
      dto,
      actor,
    );
  }

  @Post('leads')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createLead(@Body() dto: CreateLeadDto, @CurrentUser() actor: AuthUser) {
    return this.membersMemberLeads.createLead(dto, actor);
  }

  @Post('leads/:id/claim')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  claimLead(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.membersMemberLeads.claimLead(id, actor);
  }

  @Post('leads/:id/assign')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  assignLead(
    @Param('id') id: string,
    @Body() dto: AssignLeadDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membersMemberLeads.assignLead(id, dto, actor);
  }

  @Post('leads/:id/follow-ups')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  followUpLead(
    @Param('id') id: string,
    @Body() dto: AddLeadFollowUpDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membersMemberLeads.addLeadFollowUp(id, dto, actor);
  }

  @Post('leads/:id/convert')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  convertLead(
    @Param('id') id: string,
    @Body() dto: ConvertLeadDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membersMemberLeads.convertLead(id, dto, actor);
  }

  @Post('leads/:id/lost')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  loseLead(
    @Param('id') id: string,
    @Body() dto: LoseLeadDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membersMemberLeads.loseLead(id, dto, actor);
  }

  @Post('leads/:id/archive')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  archiveLead(
    @Param('id') id: string,
    @Body() dto: ArchiveLeadDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membersMemberLeads.archiveLead(id, dto, actor);
  }

  @Get(':id/360')
  @Roles(
    AppRole.FRONT_DESK,
    AppRole.COACH,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  customer360(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.membersMemberDirectory.customer360(id, actor);
  }

  @Get(':id')
  @Roles(
    AppRole.FRONT_DESK,
    AppRole.COACH,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  profile(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.membersMemberDirectory.profile(id, actor);
  }

  @Get(':id/accounts/transactions')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  transactions(@Param('id') id: string) {
    return this.membersMemberAccounts.accountTransactions(id);
  }

  @Post(':id/accounts/adjust')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  adjust(
    @Param('id') id: string,
    @Body() dto: AdjustAccountDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membersMemberAccounts.adjustAccount(id, dto, actor);
  }

  @Post('me/referrer')
  bindReferral(@Body() dto: BindReferralDto, @CurrentUser() actor: AuthUser) {
    return this.membersMemberReferrals.bindReferral(dto, actor);
  }
}
