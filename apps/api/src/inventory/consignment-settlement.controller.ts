import { Inject } from '@nestjs/common';
import { ConsignmentQueriesService } from './consignment/queries/consignment-settlement-queries.service.js';
import { ConsignmentStatementsService } from './consignment/statements/consignment-settlement-statements.service.js';
import { ConsignmentWorkflowService } from './consignment/workflow/consignment-settlement-workflow.service.js';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import {
  ConsignmentPayableQueryDto,
  ConsignmentSettlementActionDto,
  ConsignmentSettlementQueryDto,
  CreateConsignmentSettlementDto,
  SettleConsignmentSettlementDto,
} from './consignment-settlement.dto.js';

@ApiTags('寄售应付与供应商结算')
@ApiBearerAuth()
@Controller('inventory/consignment')
@Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
export class ConsignmentSettlementController {
  constructor(
    @Inject(ConsignmentQueriesService)
    private readonly settlementsConsignmentQueries: ConsignmentQueriesService,
    @Inject(ConsignmentStatementsService)
    private readonly settlementsConsignmentStatements: ConsignmentStatementsService,
    @Inject(ConsignmentWorkflowService)
    private readonly settlementsConsignmentWorkflow: ConsignmentWorkflowService,
  ) {}

  @Get('supplier-options')
  supplierOptions(@CurrentUser() actor: AuthUser) {
    return this.settlementsConsignmentQueries.supplierOptions(actor);
  }

  @Get('payables')
  payables(
    @Query() query: ConsignmentPayableQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsConsignmentQueries.listPayables(query, actor);
  }

  @Get('settlements')
  list(
    @Query() query: ConsignmentSettlementQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsConsignmentQueries.listSettlements(query, actor);
  }

  @Get('settlements/:id')
  detail(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.settlementsConsignmentQueries.detail(id, actor);
  }

  @Post('settlements')
  create(
    @Body() dto: CreateConsignmentSettlementDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsConsignmentStatements.createSettlement(dto, actor);
  }

  @Post('settlements/:id/submit')
  submit(
    @Param('id') id: string,
    @Body() dto: ConsignmentSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsConsignmentWorkflow.submitSettlement(id, dto, actor);
  }

  @Post('settlements/:id/confirm')
  confirm(
    @Param('id') id: string,
    @Body() dto: ConsignmentSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsConsignmentWorkflow.confirmSettlement(
      id,
      dto,
      actor,
    );
  }

  @Post('settlements/:id/dispute')
  dispute(
    @Param('id') id: string,
    @Body() dto: ConsignmentSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsConsignmentWorkflow.disputeSettlement(
      id,
      dto,
      actor,
    );
  }

  @Post('settlements/:id/return')
  returnToDraft(
    @Param('id') id: string,
    @Body() dto: ConsignmentSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsConsignmentWorkflow.returnSettlement(id, dto, actor);
  }

  @Post('settlements/:id/settle')
  settle(
    @Param('id') id: string,
    @Body() dto: SettleConsignmentSettlementDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsConsignmentWorkflow.settleSettlement(id, dto, actor);
  }

  @Post('settlements/:id/void')
  void(
    @Param('id') id: string,
    @Body() dto: ConsignmentSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsConsignmentWorkflow.voidSettlement(id, dto, actor);
  }
}
