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
import { ConsignmentSettlementService } from './consignment-settlement.service.js';

@ApiTags('寄售应付与供应商结算')
@ApiBearerAuth()
@Controller('inventory/consignment')
@Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
export class ConsignmentSettlementController {
  constructor(private readonly settlements: ConsignmentSettlementService) {}

  @Get('payables')
  payables(
    @Query() query: ConsignmentPayableQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlements.listPayables(query, actor);
  }

  @Get('settlements')
  list(
    @Query() query: ConsignmentSettlementQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlements.listSettlements(query, actor);
  }

  @Get('settlements/:id')
  detail(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.settlements.detail(id, actor);
  }

  @Post('settlements')
  create(
    @Body() dto: CreateConsignmentSettlementDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlements.createSettlement(dto, actor);
  }

  @Post('settlements/:id/submit')
  submit(
    @Param('id') id: string,
    @Body() dto: ConsignmentSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlements.submitSettlement(id, dto, actor);
  }

  @Post('settlements/:id/confirm')
  confirm(
    @Param('id') id: string,
    @Body() dto: ConsignmentSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlements.confirmSettlement(id, dto, actor);
  }

  @Post('settlements/:id/dispute')
  dispute(
    @Param('id') id: string,
    @Body() dto: ConsignmentSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlements.disputeSettlement(id, dto, actor);
  }

  @Post('settlements/:id/return')
  returnToDraft(
    @Param('id') id: string,
    @Body() dto: ConsignmentSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlements.returnSettlement(id, dto, actor);
  }

  @Post('settlements/:id/settle')
  settle(
    @Param('id') id: string,
    @Body() dto: SettleConsignmentSettlementDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlements.settleSettlement(id, dto, actor);
  }

  @Post('settlements/:id/void')
  void(
    @Param('id') id: string,
    @Body() dto: ConsignmentSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlements.voidSettlement(id, dto, actor);
  }
}
