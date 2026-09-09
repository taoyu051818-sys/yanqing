import {
  Inject,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import {
  CreateTrainingSettlementDto,
  ListTrainingSettlementsDto,
  TrainingSettlementActionDto,
} from '../training.dto.js';
import { TrainingSettlementsService } from './training-settlements.service.js';

@ApiTags('培训')
@ApiBearerAuth()
@Controller('training')
export class TrainingSettlementsController {
  constructor(
    @Inject(TrainingSettlementsService)
    private readonly settlementsService: TrainingSettlementsService,
  ) {}

  @Get('financial-summary')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  summary(
    @Query('periodStart') start: string,
    @Query('periodEnd') end: string,
  ) {
    return this.settlementsService.financialSummary(
      new Date(start),
      new Date(end),
    );
  }

  @Post('settlements')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  settlement(
    @Body() dto: CreateTrainingSettlementDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsService.createSettlement(dto, actor);
  }

  @Get('settlements')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  settlements(
    @Query() query: ListTrainingSettlementsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsService.listSettlements(query, actor);
  }

  @Post('settlements/:id/submit')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  submitSettlement(
    @Param('id') id: string,
    @Body() dto: TrainingSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsService.submitSettlement(id, dto, actor);
  }

  @Post('settlements/:id/confirm')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  confirmSettlement(
    @Param('id') id: string,
    @Body() dto: TrainingSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsService.confirmSettlement(id, dto, actor);
  }

  @Post('settlements/:id/settle')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  settleSettlement(
    @Param('id') id: string,
    @Body() dto: TrainingSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsService.settleSettlement(id, dto, actor);
  }

  @Post('settlements/:id/return')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  returnSettlement(
    @Param('id') id: string,
    @Body() dto: TrainingSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsService.returnSettlement(id, dto, actor);
  }

  @Post('settlements/:id/void')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  voidSettlement(
    @Param('id') id: string,
    @Body() dto: TrainingSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlementsService.voidSettlement(id, dto, actor);
  }
}
