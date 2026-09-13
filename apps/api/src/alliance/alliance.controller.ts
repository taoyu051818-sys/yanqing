import { Inject } from '@nestjs/common';
import { AllianceMerchantsService } from './merchants/alliance-merchants.service.js';
import { AllianceTemplatesService } from './templates/alliance-templates.service.js';
import { AllianceCouponsService } from './coupons/alliance-coupons.service.js';
import { AllianceSettlementsService } from './settlements/alliance-settlements.service.js';
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import {
  AllianceSettlementDto,
  ReviseAllianceSettlementDto,
  CreateCouponTemplateDto,
  CreateMerchantDto,
  GenerateCouponCodesDto,
  RedeemCouponDto,
  SetCouponTemplateStatusDto,
  SetMerchantStatusDto,
  SettlementActionDto,
} from './alliance.dto.js';

@ApiTags('联盟商户与唯一券')
@ApiBearerAuth()
@Controller('alliance')
export class AllianceController {
  constructor(
    @Inject(AllianceMerchantsService)
    private readonly allianceAllianceMerchants: AllianceMerchantsService,
    @Inject(AllianceTemplatesService)
    private readonly allianceAllianceTemplates: AllianceTemplatesService,
    @Inject(AllianceCouponsService)
    private readonly allianceAllianceCoupons: AllianceCouponsService,
    @Inject(AllianceSettlementsService)
    private readonly allianceAllianceSettlements: AllianceSettlementsService,
  ) {}

  @Get('merchants')
  merchants(@CurrentUser() actor: AuthUser) {
    return this.allianceAllianceMerchants.listMerchants(actor);
  }

  @Post('merchants')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createMerchant(
    @Body() dto: CreateMerchantDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.allianceAllianceMerchants.createMerchant(dto, actor);
  }

  @Post('merchants/:id/status')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  setMerchantStatus(
    @Param('id') id: string,
    @Body() dto: SetMerchantStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.allianceAllianceMerchants.setMerchantStatus(id, dto, actor);
  }

  @Get('coupon-templates')
  @Roles(AppRole.MERCHANT, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  templates(@CurrentUser() actor: AuthUser) {
    return this.allianceAllianceTemplates.listTemplates(actor);
  }

  @Post('coupon-templates')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createTemplate(
    @Body() dto: CreateCouponTemplateDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.allianceAllianceTemplates.createTemplate(dto, actor);
  }

  @Post('coupon-templates/:id/status')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  setTemplateStatus(
    @Param('id') id: string,
    @Body() dto: SetCouponTemplateStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.allianceAllianceTemplates.setTemplateStatus(id, dto, actor);
  }

  @Post('coupon-templates/:id/codes')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN, AppRole.MERCHANT)
  generate(
    @Param('id') id: string,
    @Body() dto: GenerateCouponCodesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.allianceAllianceCoupons.generateCodes(id, dto, actor);
  }

  @Post('coupons/:code/claim')
  claim(@Param('code') code: string, @CurrentUser() actor: AuthUser) {
    return this.allianceAllianceCoupons.claim(code, actor);
  }

  @Get('coupons/me')
  myCoupons(@CurrentUser() actor: AuthUser) {
    return this.allianceAllianceCoupons.listMyCoupons(actor);
  }

  @Post('coupons/redeem')
  @Roles(
    AppRole.MERCHANT,
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  redeem(@Body() dto: RedeemCouponDto, @CurrentUser() actor: AuthUser) {
    return this.allianceAllianceCoupons.redeem(dto, actor);
  }

  @Get('coupons/:code/qr')
  qr(@Param('code') code: string, @CurrentUser() actor: AuthUser) {
    return this.allianceAllianceCoupons.qr(code, actor);
  }

  @Post('settlements')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  settlement(
    @Body() dto: AllianceSettlementDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.allianceAllianceSettlements.createSettlement(dto, actor);
  }

  @Get('settlements')
  @Roles(AppRole.MERCHANT, AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  settlements(@CurrentUser() actor: AuthUser) {
    return this.allianceAllianceSettlements.listSettlements(actor);
  }

  @Post('settlements/:id/submit')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  submitSettlement(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.allianceAllianceSettlements.submitSettlement(id, actor);
  }

  @Post('settlements/:id/confirm')
  @Roles(AppRole.MERCHANT, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  confirmSettlement(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.allianceAllianceSettlements.confirmSettlement(id, actor);
  }

  @Post('settlements/:id/dispute')
  @Roles(AppRole.MERCHANT, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  disputeSettlement(
    @Param('id') id: string,
    @Body() dto: SettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.allianceAllianceSettlements.disputeSettlement(id, dto, actor);
  }

  @Post('settlements/:id/revise')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  reviseSettlement(
    @Param('id') id: string,
    @Body() dto: ReviseAllianceSettlementDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.allianceAllianceSettlements.reviseSettlement(id, dto, actor);
  }

  @Post('settlements/:id/settle')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  settleSettlement(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.allianceAllianceSettlements.settleSettlement(id, actor);
  }
}
