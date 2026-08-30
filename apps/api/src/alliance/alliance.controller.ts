import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import {
  AllianceSettlementDto,
  CreateCouponTemplateDto,
  CreateMerchantDto,
  GenerateCouponCodesDto,
  RedeemCouponDto,
  SettlementActionDto,
} from './alliance.dto.js'
import { AllianceService } from './alliance.service.js'

@ApiTags('联盟商户与唯一券')
@ApiBearerAuth()
@Controller('alliance')
export class AllianceController {
  constructor(private readonly alliance: AllianceService) {}

  @Get('merchants')
  merchants(@CurrentUser() actor: AuthUser) {
    return this.alliance.listMerchants(actor)
  }

  @Post('merchants')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createMerchant(@Body() dto: CreateMerchantDto) {
    return this.alliance.createMerchant(dto)
  }

  @Post('coupon-templates')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createTemplate(@Body() dto: CreateCouponTemplateDto) {
    return this.alliance.createTemplate(dto)
  }

  @Post('coupon-templates/:id/codes')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN, AppRole.MERCHANT)
  generate(
    @Param('id') id: string,
    @Body() dto: GenerateCouponCodesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.alliance.generateCodes(id, dto, actor)
  }

  @Post('coupons/:code/claim')
  claim(@Param('code') code: string, @CurrentUser() actor: AuthUser) {
    return this.alliance.claim(code, actor)
  }

  @Get('coupons/me')
  myCoupons(@CurrentUser() actor: AuthUser) {
    return this.alliance.listMyCoupons(actor)
  }

  @Post('coupons/redeem')
  @Roles(AppRole.MERCHANT, AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  redeem(@Body() dto: RedeemCouponDto, @CurrentUser() actor: AuthUser) {
    return this.alliance.redeem(dto, actor)
  }

  @Get('coupons/:code/qr')
  qr(@Param('code') code: string, @CurrentUser() actor: AuthUser) {
    return this.alliance.qr(code, actor)
  }

  @Post('settlements')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  settlement(@Body() dto: AllianceSettlementDto, @CurrentUser() actor: AuthUser) {
    return this.alliance.createSettlement(dto, actor)
  }

  @Get('settlements')
  @Roles(AppRole.MERCHANT, AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  settlements(@CurrentUser() actor: AuthUser) {
    return this.alliance.listSettlements(actor)
  }

  @Post('settlements/:id/submit')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  submitSettlement(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.alliance.submitSettlement(id, actor)
  }

  @Post('settlements/:id/confirm')
  @Roles(AppRole.MERCHANT, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  confirmSettlement(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.alliance.confirmSettlement(id, actor)
  }

  @Post('settlements/:id/dispute')
  @Roles(AppRole.MERCHANT, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  disputeSettlement(
    @Param('id') id: string,
    @Body() dto: SettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.alliance.disputeSettlement(id, dto, actor)
  }

  @Post('settlements/:id/settle')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  settleSettlement(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.alliance.settleSettlement(id, actor)
  }
}
